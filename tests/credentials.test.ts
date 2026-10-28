import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  process.env.CHECKIN_SECRET = "d".repeat(64);
});
const load = () => import("@/lib/server/credentials");

describe("senha dos líderes (scrypt)", () => {
  it("confere a senha certa e recusa a errada", async () => {
    const { hashPassword, verifyPassword } = await load();
    const h = await hashPassword("louvor no domingo 2026");
    expect(h).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(h).not.toContain("louvor");
    expect(await verifyPassword("louvor no domingo 2026", h)).toBe(true);
    expect(await verifyPassword("Louvor no domingo 2026", h)).toBe(false);
  });

  it("mesma senha gera hashes diferentes (sal por conta)", async () => {
    const { hashPassword } = await load();
    expect(await hashPassword("louvor no domingo 2026")).not.toBe(await hashPassword("louvor no domingo 2026"));
  });

  it("conta sem senha (não ativada) nunca entra", async () => {
    const { verifyPassword } = await load();
    expect(await verifyPassword("", null)).toBe(false);
    expect(await verifyPassword("qualquer", undefined)).toBe(false);
  });

  it("regras: tamanho, repetição, senha comum e e-mail", async () => {
    const { passwordProblem } = await load();
    expect(passwordProblem("curta")).toMatch(/10/);
    expect(passwordProblem("aaaaaaaaaaaa")).toMatch(/repetitiva/);
    expect(passwordProblem("x1234567890y")).toMatch(/comum/);
    expect(passwordProblem("joaosilva-forte!", "joaosilva@exemplo.com")).toMatch(/e-mail/);
    expect(passwordProblem("louvor no domingo 2026", "joaosilva@exemplo.com")).toBeNull();
  });
});

describe("segredo do autenticador cifrado", () => {
  it("cifra e decifra; adulterado ou com outra chave não abre", async () => {
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

describe("códigos de ativação e recuperação", () => {
  it("formato fácil de ditar, sem caracteres ambíguos", async () => {
    const { randomCode } = await load();
    for (let i = 0; i < 50; i++) {
      expect(randomCode([5, 5])).toMatch(/^[2-9A-HJKMNP-Z]{5}-[2-9A-HJKMNP-Z]{5}$/);
      expect(randomCode([4, 4, 4])).toMatch(/^[2-9A-HJKMNP-Z]{4}(-[2-9A-HJKMNP-Z]{4}){2}$/);
    }
  });

  it("hash ignora hífen, espaço e minúsculas, e separa ativação de recuperação", async () => {
    const { codeHash } = await load();
    expect(codeHash("recuperacao", "k7qm2 xr9td")).toBe(codeHash("recuperacao", "K7QM2-XR9TD"));
    expect(codeHash("ativacao", "K7QM2-XR9TD")).not.toBe(codeHash("recuperacao", "K7QM2-XR9TD"));
    expect(codeHash("recuperacao", "K7QM2-XR9TD")).not.toContain("K7QM2");
  });
});
