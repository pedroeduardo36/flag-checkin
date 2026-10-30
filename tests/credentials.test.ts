import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  process.env.CHECKIN_SECRET = "d".repeat(64);
});
const load = () => import("@/lib/server/credentials");

describe("leader passwords (scrypt)", () => {
  it("verifies the right password and rejects the wrong one", async () => {
    const { hashPassword, verifyPassword } = await load();
    const h = await hashPassword("louvor no domingo 2026");
    expect(h).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(h).not.toContain("louvor");
    expect(await verifyPassword("louvor no domingo 2026", h)).toBe(true);
    expect(await verifyPassword("Louvor no domingo 2026", h)).toBe(false);
  });

  it("the same password produces different hashes (per-account salt)", async () => {
    const { hashPassword } = await load();
    expect(await hashPassword("louvor no domingo 2026")).not.toBe(await hashPassword("louvor no domingo 2026"));
  });

  it("an account without a password (not activated) never gets in", async () => {
    const { verifyPassword } = await load();
    expect(await verifyPassword("", null)).toBe(false);
    expect(await verifyPassword("qualquer", undefined)).toBe(false);
  });

  it("rules: length, repetition, common passwords and email", async () => {
    const { passwordProblem } = await load();
    expect(passwordProblem("curta")).toMatch(/10/);
    expect(passwordProblem("aaaaaaaaaaaa")).toMatch(/repetitiva/);
    expect(passwordProblem("x1234567890y")).toMatch(/comum/);
    expect(passwordProblem("joaosilva-forte!", "joaosilva@exemplo.com")).toMatch(/e-mail/);
    expect(passwordProblem("louvor no domingo 2026", "joaosilva@exemplo.com")).toBeNull();
  });
});

describe("encrypted authenticator secret", () => {
  it("encrypts and decrypts; tampered data or another key doesn't open", async () => {
    const { seal, unseal } = await load();
    const secret = Buffer.from("segredo-de-20-bytes!");
    const s = seal(secret);
    expect(s).not.toContain(secret.toString("base64url"));
    expect(unseal(s)?.equals(secret)).toBe(true);
    const parts = s.split(".");
    parts[2] = Buffer.from("x".repeat(20)).toString("base64url");
    expect(unseal(parts.join("."))).toBeNull();
    expect(unseal("")).toBeNull();

    vi.resetModules();
    process.env.CHECKIN_SECRET = "e".repeat(64);
    const other = await load();
    expect(other.unseal(s)).toBeNull();
  });
});

describe("activation and recovery codes", () => {
  it("easy to read aloud, no ambiguous characters", async () => {
    const { randomCode } = await load();
    for (let i = 0; i < 50; i++) {
      expect(randomCode([5, 5])).toMatch(/^[2-9A-HJKMNP-Z]{5}-[2-9A-HJKMNP-Z]{5}$/);
      expect(randomCode([4, 4, 4])).toMatch(/^[2-9A-HJKMNP-Z]{4}(-[2-9A-HJKMNP-Z]{4}){2}$/);
    }
  });

  it("hash ignores hyphens, spaces and case, and keeps activation apart from recovery", async () => {
    const { codeHash, setupCodeHash } = await load();
    expect(codeHash("recuperacao", "k7qm2 xr9td")).toBe(codeHash("recuperacao", "K7QM2-XR9TD"));
    expect(setupCodeHash("k7qm-2xr9-tdab")).toBe(setupCodeHash("K7QM-2XR9-TDAB"));
    expect(setupCodeHash("K7QM2-XR9TD")).not.toBe(codeHash("recuperacao", "K7QM2-XR9TD"));
    expect(codeHash("recuperacao", "K7QM2-XR9TD")).not.toContain("K7QM2");
  });

  it("activation code doesn't depend on the server secret (the local script issues it, production accepts it)", async () => {
    const a = (await load()).setupCodeHash("ABCD-EFGH-JKMN");
    vi.resetModules();
    process.env.CHECKIN_SECRET = "z".repeat(64);
    expect((await load()).setupCodeHash("ABCD-EFGH-JKMN")).toBe(a);
    // The recovery codes' HMAC, on the other hand, changes with the secret
    expect((await load()).codeHash("recuperacao", "K7QM2-XR9TD")).not.toBe(a);
  });
});
