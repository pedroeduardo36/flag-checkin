import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyzeFace, faceDistance, matchCreativePhoto, matchThreshold, parseDescriptor } from "@/lib/server/face";

// Synthetic faces (StyleGAN2, thispersondoesnotexist.com): no real people.
const photo = (name: string) => readFileSync(`tests/fixtures/${name}.jpg`);

async function descriptorOf(name: string) {
  const r = await analyzeFace(photo(name));
  if (!r.ok) throw new Error(`${name}: ${r.code}`);
  return r.descriptor;
}

describe("face recognition (server)", { timeout: 60_000 }, () => {
  it("rejects a photo without a face", async () => {
    expect(await analyzeFace(photo("no-face"))).toMatchObject({ ok: false, code: "SEM_ROSTO" });
  });

  it("rejects a photo with two people", async () => {
    expect(await analyzeFace(photo("two-people"))).toMatchObject({ ok: false, code: "VARIOS_ROSTOS" });
  });

  it("rejects a file that isn't a valid JPEG", async () => {
    expect(await analyzeFace(Buffer.from("não é uma imagem"))).toMatchObject({ ok: false, code: "IMAGEM_INVALIDA" });
  });

  it("accepts a single face and produces a 128-dimension descriptor", async () => {
    const r = await analyzeFace(photo("person-a-registration"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.descriptor).toHaveLength(128);
      expect(r.score).toBeGreaterThan(0.9);
    }
  });

  it("the same person (mirrored, rotated, darker) stays under the threshold", async () => {
    const d = faceDistance(await descriptorOf("person-a-registration"), await descriptorOf("person-a-selfie"));
    expect(d).toBeLessThan(matchThreshold());
  });

  it("different people land above the threshold", async () => {
    const d = faceDistance(await descriptorOf("person-a-registration"), await descriptorOf("person-b"));
    expect(d).toBeGreaterThan(matchThreshold());
  });
});

describe("creative photo (later check-ins)", { timeout: 60_000 }, () => {
  it("accepts a group photo when one of the faces is the teen's", async () => {
    const r = await matchCreativePhoto(photo("two-people"), await descriptorOf("person-a-registration"));
    expect(r).toMatchObject({ ok: true, faces: 2 });
  });
  it("accepts the same person at another angle and lighting", async () => {
    expect((await matchCreativePhoto(photo("person-a-selfie"), await descriptorOf("person-a-registration"))).ok).toBe(true);
  });
  it("rejects when nobody in the photo is the teen", async () => {
    expect(await matchCreativePhoto(photo("two-people"), await descriptorOf("person-b"))).toMatchObject({ ok: false, code: "ROSTO_NAO_CONFERE" });
  });
  it("rejects a creative photo with no face", async () => {
    expect(await matchCreativePhoto(photo("no-face"), await descriptorOf("person-b"))).toMatchObject({ ok: false, code: "SEM_ROSTO" });
  });
});

describe("descriptors", () => {
  it("Euclidean distance", () => {
    expect(faceDistance([0, 0], [3, 4])).toBe(5);
    expect(() => faceDistance([1], [1, 2])).toThrow();
  });
  it("parseDescriptor only accepts 128 numbers", () => {
    expect(parseDescriptor(Array(128).fill(0.1))).toHaveLength(128);
    expect(parseDescriptor(Array(127).fill(0.1))).toBeNull();
    expect(parseDescriptor(null)).toBeNull();
  });
  it("default threshold 0.65 (creative photo), configurable through FACE_MATCH_THRESHOLD", () => {
    expect(matchThreshold()).toBe(0.65);
    process.env.FACE_MATCH_THRESHOLD = "0.5";
    expect(matchThreshold()).toBe(0.5);
    delete process.env.FACE_MATCH_THRESHOLD;
  });
});
