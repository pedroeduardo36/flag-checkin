import "server-only";
import path from "node:path";
import * as tf from "@tensorflow/tfjs";
import * as faceapi from "@vladmandic/face-api/dist/face-api.node-wasm.js";
import { setWasmPaths } from "@tensorflow/tfjs-backend-wasm";
import jpeg from "jpeg-js";

/**
 * Reconhecimento facial no servidor (TensorFlow.js + WebAssembly, sem GPU nem binário nativo).
 * - SSD MobileNet v1 encontra os rostos.
 * - 68 landmarks alinham o rosto.
 * - FaceRecognitionNet (ResNet-34) gera um descritor de 128 números por rosto.
 * Duas fotos são da mesma pessoa quando a distância euclidiana entre os descritores é pequena.
 */

const NODE_MODULES = path.join(process.cwd(), "node_modules");
const MODEL_DIR = path.join(NODE_MODULES, "@vladmandic/face-api/model");
const WASM_DIR = path.join(NODE_MODULES, "@tensorflow/tfjs-backend-wasm/dist") + path.sep;

/** Rosto mínimo: 15% da largura da foto (evita rosto distante demais para comparar). */
const MIN_FACE_RATIO = 0.15;
/** Um segundo rosto com pelo menos 50% da área do principal conta como "outra pessoa na foto". */
const SECOND_FACE_AREA_RATIO = 0.5;

/** Na foto criativa (em grupo, de longe) um rosto pequeno ainda serve para comparar. */
const MIN_CREATIVE_FACE_RATIO = 0.06;

/**
 * Distância máxima entre um rosto da foto criativa e o rosto de referência do cadastro.
 * 0,65 é mais tolerante que o padrão do face-api (0,6): a foto criativa tem pose, careta,
 * luz do culto e outras pessoas. Pessoas diferentes ficam tipicamente acima de 0,75.
 */
export function matchThreshold(): number {
  const v = Number(process.env.FACE_MATCH_THRESHOLD);
  return Number.isFinite(v) && v > 0 && v < 1.5 ? v : 0.65;
}

let ready: Promise<void> | null = null;

function init(): Promise<void> {
  ready ??= (async () => {
    setWasmPaths(WASM_DIR);
    await tf.setBackend("wasm");
    await tf.ready();
    await Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromDisk(MODEL_DIR),
      faceapi.nets.faceLandmark68Net.loadFromDisk(MODEL_DIR),
      faceapi.nets.faceRecognitionNet.loadFromDisk(MODEL_DIR),
    ]);
  })().catch((err) => {
    ready = null; // permite tentar de novo na próxima requisição
    throw err;
  });
  return ready;
}

export type FaceAnalysis =
  | { ok: true; descriptor: number[]; score: number }
  | { ok: false; code: "SEM_ROSTO" | "VARIOS_ROSTOS" | "ROSTO_PEQUENO" | "IMAGEM_INVALIDA"; message: string };

const fail = (code: Exclude<FaceAnalysis, { ok: true }>["code"], message: string): FaceAnalysis => ({ ok: false, code, message });

type DetectedFace = { descriptor: number[]; width: number; area: number; score: number };

/** Detecta todos os rostos da foto (JPEG), do maior para o menor. */
async function detectFaces(photo: Buffer): Promise<{ width: number; faces: DetectedFace[] } | null> {
  await init();
  let img: { width: number; height: number; data: Uint8Array };
  try {
    img = jpeg.decode(photo, { useTArray: true, formatAsRGBA: false, maxMemoryUsageInMB: 256 });
  } catch {
    return null;
  }
  const tensor = tf.tensor3d(img.data, [img.height, img.width, 3], "int32");
  try {
    const found = await faceapi
      .detectAllFaces(tensor as any, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
      .withFaceLandmarks()
      .withFaceDescriptors();
    const faces = found
      .map((f) => ({ descriptor: Array.from(f.descriptor), width: f.detection.box.width, area: f.detection.box.area, score: f.detection.score }))
      .sort((a, b) => b.area - a.area);
    return { width: img.width, faces };
  } finally {
    tensor.dispose();
  }
}

/**
 * Foto de REGISTRO (primeiro check-in): exige um rosto só, de perto.
 * Devolve o descritor de 128 dimensões que vira a referência do cadastro.
 */
export async function analyzeFace(photo: Buffer): Promise<FaceAnalysis> {
  const r = await detectFaces(photo);
  if (!r) return fail("IMAGEM_INVALIDA", "Não conseguimos ler a foto. Tire outra.");
  const { faces } = r;
  {
    if (!faces.length)
      return fail("SEM_ROSTO", "Não encontramos um rosto na foto. Olhe para a câmera, com o rosto inteiro e bem iluminado.");

    const [main, second] = faces;

    if (second && second.area >= main.area * SECOND_FACE_AREA_RATIO)
      return fail("VARIOS_ROSTOS", "Apareceu mais de uma pessoa na foto. Tire a foto sozinho(a).");

    if (main.width < r.width * MIN_FACE_RATIO)
      return fail("ROSTO_PEQUENO", "O rosto ficou muito longe. Aproxime o celular e tire outra foto.");

    return { ok: true, descriptor: main.descriptor, score: main.score };
  }
}

export type CreativeMatch =
  | { ok: true; distance: number; faces: number }
  | { ok: false; code: "SEM_ROSTO" | "IMAGEM_INVALIDA" | "ROSTO_NAO_CONFERE"; message: string; distance?: number };

/**
 * Foto CRIATIVA (check-ins seguintes): pode ter amigos, pose e careta.
 * Basta UM rosto da foto ser parecido o suficiente com a referência do cadastro.
 */
export async function matchCreativePhoto(photo: Buffer, reference: ArrayLike<number>): Promise<CreativeMatch> {
  const r = await detectFaces(photo);
  if (!r) return { ok: false, code: "IMAGEM_INVALIDA", message: "Não conseguimos ler a foto. Tire outra." };
  const usable = r.faces.filter((f) => f.width >= r.width * MIN_CREATIVE_FACE_RATIO);
  if (!usable.length)
    return { ok: false, code: "SEM_ROSTO", message: "Seu rosto precisa aparecer na foto criativa. Pode ter amigos junto, mas apareça!" };
  const distance = Math.min(...usable.map((f) => faceDistance(f.descriptor, reference)));
  if (distance > matchThreshold())
    return {
      ok: false,
      code: "ROSTO_NAO_CONFERE",
      distance,
      message: "Não reconhecemos você nessa foto. Tire outra com o rosto bem visível.",
    };
  return { ok: true, distance, faces: usable.length };
}

export function faceDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) throw new Error("Descritores de tamanhos diferentes");
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

/** Descritor salvo no banco (array JSON) → número[] com validação. */
export function parseDescriptor(value: unknown): number[] | null {
  return Array.isArray(value) && value.length === 128 && value.every((n) => typeof n === "number") ? value : null;
}
