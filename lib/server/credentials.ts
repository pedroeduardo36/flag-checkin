import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { env } from "./env";

// ---------- Senha (scrypt, sal aleatório por conta) ----------
const N = 2 ** 15, R = 8, P = 1, KEYLEN = 32, MAXMEM = 64 * 1024 * 1024;

const derive = (password: string, salt: Buffer, n = N, r = R, p = P) =>
  new Promise<Buffer>((ok, fail) => scrypt(password.normalize("NFKC"), salt, KEYLEN, { N: n, r, p, maxmem: MAXMEM }, (e, k) => (e ? fail(e) : ok(k))));

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

// Conta inexistente ou sem senha também gasta o tempo do scrypt: a resposta não denuncia quem existe.
const DUMMY = `scrypt$${N}$${R}$${P}$${Buffer.alloc(16).toString("base64url")}$${Buffer.alloc(KEYLEN).toString("base64url")}`;

export async function verifyPassword(password: unknown, stored: string | null | undefined): Promise<boolean> {
  const [alg, n, r, p, salt, key] = String(stored || DUMMY).split("$");
  if (alg !== "scrypt" || !salt || !key) return false;
  const got = await derive(String(password ?? ""), Buffer.from(salt, "base64url"), Number(n), Number(r), Number(p));
  const want = Buffer.from(key, "base64url");
  return !!stored && got.length === want.length && timingSafeEqual(got, want);
}

const COMMON = ["1234567890", "0123456789", "senha12345", "password12", "qwertyuiop", "flag123456", "o2flag1234", "pastor1234"];

/** Regras da senha de líder (NIST 800-63B: tamanho conta mais que símbolos obrigatórios). */
export function passwordProblem(password: unknown, email = ""): string | null {
  const p = String(password ?? "");
  if (p.length < 10) return "Use pelo menos 10 caracteres.";
  if (p.length > 128) return "Use no máximo 128 caracteres.";
  if (new Set(p).size < 4) return "Senha muito repetitiva.";
  const low = p.toLowerCase();
  if (COMMON.some((c) => low.includes(c))) return "Senha muito comum. Escolha outra.";
  const user = email.split("@")[0].toLowerCase();
  if (user.length >= 4 && low.includes(user)) return "Não use o seu e-mail na senha.";
  return null;
}

// ---------- Segredo do autenticador cifrado no banco (AES-256-GCM) ----------
// Chave derivada do CHECKIN_SECRET (HKDF): quem lê só o banco não consegue gerar códigos.
const sealKey = () => Buffer.from(hkdfSync("sha256", env.checkinSecret, "flag-o2", "totp-v1", 32));

export function seal(plain: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", sealKey(), iv);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return ["v1", iv.toString("base64url"), ct.toString("base64url"), c.getAuthTag().toString("base64url")].join(".");
}

export function unseal(sealed: string | null | undefined): Buffer | null {
  const [v, iv, ct, tag] = String(sealed ?? "").split(".");
  if (v !== "v1" || !iv || !ct || !tag) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", sealKey(), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]);
  } catch {
    return null;
  }
}

// ---------- Códigos de uso único (ativação e recuperação) ----------
// Sem 0/O, 1/I/L: dá para ditar e digitar sem confusão. 31 símbolos ≈ 5 bits cada.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** Ex.: groups=[5,5] → "K7QM2-XR9TD" (50 bits). */
export function randomCode(groups: number[]): string {
  return groups.map((n) => Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")).join("-");
}

export const normalizeCode = (code: unknown) => String(code ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");

/** Códigos de recuperação: guardamos só o HMAC (50 bits, valem até serem usados): um vazamento do banco não os entrega. */
export const codeHash = (kind: "recuperacao", code: unknown) =>
  createHmac("sha256", env.checkinSecret).update(`${kind}:${normalizeCode(code)}`).digest("base64url");

/**
 * Código de ativação: SHA-256 sem chave, para o script `lider:criar` (que roda fora da Vercel, sem o
 * segredo de produção) gerar códigos que a produção aceita. 60 bits aleatórios, uso único e 24 h de
 * validade: inverter o hash por força bruta nesse prazo é inviável.
 */
export const setupCodeHash = (code: unknown) => createHash("sha256").update(`ativacao:${normalizeCode(code)}`).digest("base64url");

/** Hash do valor do cookie de sessão (o banco nunca guarda o valor em si). */
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("base64url");
