import "server-only";
import path from "node:path";
import * as tf from "@tensorflow/tfjs";
import * as faceapi from "@vladmandic/face-api/dist/face-api.node-wasm.js";
import { setWasmPaths } from "@tensorflow/tfjs-backend-wasm";
import jpeg from "jpeg-js";

/**
 * Server-side face recognition (TensorFlow.js + WebAssembly, no GPU or native binary).
 * - SSD MobileNet v1 finds the faces.
 * - 68 landmarks align each face.
 * - FaceRecognitionNet (ResNet-34) produces a 128-number descriptor per face.
 * Two photos show the same person when the Euclidean distance between their descriptors is small.
 *
 * Error codes (SEM_ROSTO, …) are part of the API contract and the audit log, so they stay in
 * Portuguese; the messages are shown to the teen.
 */

const NODE_MODULES = path.join(process.cwd(), "node_modules");
const MODEL_DIR = path.join(NODE_MODULES, "@vladmandic/face-api/model");
const WASM_DIR = path.join(NODE_MODULES, "@tensorflow/tfjs-backend-wasm/dist") + path.sep;

/** Minimum face size: 15% of the photo width (rejects faces too far away to compare). */
const MIN_FACE_RATIO = 0.15;
/** A second face with at least 50% of the main face's area counts as "someone else in the photo". */
const SECOND_FACE_AREA_RATIO = 0.5;

/** In the creative photo (group shot, from afar) a small face is still good enough to compare. */
const MIN_CREATIVE_FACE_RATIO = 0.06;

/**
 * Maximum distance between a face in the creative photo and the registration's reference face.
 * 0.65 is more lenient than face-api's default (0.6): creative photos have poses, funny faces,
 * stage lighting and other people. Different people typically land above 0.75.
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
    ready = null; // lets the next request try again
    throw err;
  });
  return ready;
}

export type FaceAnalysis =
  | { ok: true; descriptor: number[]; score: number }
  | { ok: false; code: "SEM_ROSTO" | "VARIOS_ROSTOS" | "ROSTO_PEQUENO" | "IMAGEM_INVALIDA"; message: string };

const fail = (code: Exclude<FaceAnalysis, { ok: true }>["code"], message: string): FaceAnalysis => ({ ok: false, code, message });

type DetectedFace = { descriptor: number[]; width: number; area: number; score: number };

/** Detects every face in the (JPEG) photo, largest first. */
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
 * REGISTRATION photo (first check-in): requires a single face, close up.
 * Returns the 128-dimension descriptor that becomes the registration's reference.
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
 * CREATIVE photo (later check-ins): friends, poses and funny faces are fine.
 * It's enough for ONE face in the photo to be close enough to the registration's reference.
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
  if (a.length !== b.length) throw new Error("Descriptors have different lengths");
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

/** Descriptor stored in the database (JSON array) → number[], validated. */
export function parseDescriptor(value: unknown): number[] | null {
  return Array.isArray(value) && value.length === 128 && value.every((n) => typeof n === "number") ? value : null;
}
