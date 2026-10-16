import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyzeFace, faceDistance, matchThreshold, parseDescriptor } from "@/lib/server/face";

// Rostos sintéticos (StyleGAN2, thispersondoesnotexist.com): nenhuma pessoa real.
const foto = (nome: string) => readFileSync(`tests/fixtures/${nome}.jpg`);

async function descritor(nome: string) {
  const r = await analyzeFace(foto(nome));
  if (!r.ok) throw new Error(`${nome}: ${r.code}`);
  return r.descriptor;
}

describe("reconhecimento facial (servidor)", { timeout: 60_000 }, () => {
  it("recusa foto sem rosto", async () => {
    expect(await analyzeFace(foto("sem-rosto"))).toMatchObject({ ok: false, code: "SEM_ROSTO" });
  });

  it("recusa foto com duas pessoas", async () => {
    expect(await analyzeFace(foto("duas-pessoas"))).toMatchObject({ ok: false, code: "VARIOS_ROSTOS" });
  });

  it("recusa arquivo que não é JPEG válido", async () => {
    expect(await analyzeFace(Buffer.from("não é uma imagem"))).toMatchObject({ ok: false, code: "IMAGEM_INVALIDA" });
  });

  it("aceita um rosto e gera descritor de 128 dimensões", async () => {
    const r = await analyzeFace(foto("pessoa-a-cadastro"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.descriptor).toHaveLength(128);
      expect(r.score).toBeGreaterThan(0.9);
    }
  });

  it("mesma pessoa (espelhada, girada, mais escura) fica abaixo do limite", async () => {
    const d = faceDistance(await descritor("pessoa-a-cadastro"), await descritor("pessoa-a-selfie"));
    expect(d).toBeLessThan(matchThreshold());
  });

  it("pessoas diferentes ficam acima do limite", async () => {
    const d = faceDistance(await descritor("pessoa-a-cadastro"), await descritor("pessoa-b"));
    expect(d).toBeGreaterThan(matchThreshold());
  });
});

describe("descritores", () => {
  it("distância euclidiana", () => {
    expect(faceDistance([0, 0], [3, 4])).toBe(5);
    expect(() => faceDistance([1], [1, 2])).toThrow();
  });
  it("parseDescriptor só aceita 128 números", () => {
    expect(parseDescriptor(Array(128).fill(0.1))).toHaveLength(128);
    expect(parseDescriptor(Array(127).fill(0.1))).toBeNull();
    expect(parseDescriptor(null)).toBeNull();
  });
  it("limite padrão 0,55 e configurável por FACE_MATCH_THRESHOLD", () => {
    expect(matchThreshold()).toBe(0.55);
    process.env.FACE_MATCH_THRESHOLD = "0.5";
    expect(matchThreshold()).toBe(0.5);
    delete process.env.FACE_MATCH_THRESHOLD;
  });
});
