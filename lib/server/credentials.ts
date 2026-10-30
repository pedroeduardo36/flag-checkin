import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { env } from "./env";

// ---------- Password (scrypt, random salt per account) ----------
const N = 2 ** 15, R = 8, P = 1, KEYLEN = 32, MAXMEM = 64 * 1024 * 1024;

const derive = (password: string, salt: Buffer, n = N, r = R, p = P) =>
  new Promise<Buffer>((ok, fail) => scrypt(password.normalize("NFKC"), salt, KEYLEN, { N: n, r, p, maxmem: MAXMEM }, (e, k) => (e ? fail(e) : ok(k))));

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

// A missing account or one without a password still pays the scrypt cost: the response doesn't reveal who exists.
const DUMMY = `scrypt$${N}$${R}$${P}$${Buffer.alloc(16).toString("base64url")}$${Buffer.alloc(KEYLEN).toString("base64url")}`;

export async function verifyPassword(password: unknown, stored: string | null | undefined): Promise<boolean> {
  const [alg, n, r, p, salt, key] = String(stored || DUMMY).split("$");
  if (alg !== "scrypt" || !salt || !key) return false;
  const got = await derive(String(password ?? ""), Buffer.from(salt, "base64url"), Number(n), Number(r), Number(p));
  const want = Buffer.from(key, "base64url");
  return !!stored && got.length === want.length && timingSafeEqual(got, want);
}

const COMMON = ["1234567890", "0123456789", "senha12345", "password12", "qwertyuiop", "flag123456", "o2flag1234", "pastor1234"];

/** Leader password rules (NIST 800-63B: length matters more than mandatory symbols). Messages are shown to the leader. */
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

// ---------- Authenticator secret encrypted in the database (AES-256-GCM) ----------
// Key derived from CHECKIN_SECRET (HKDF): someone who can only read the database can't generate codes.
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

// ---------- Single-use codes (activation and recovery) ----------
// No 0/O or 1/I/L, so codes can be read aloud and typed without confusion. 31 symbols ≈ 5 bits each.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** E.g. groups=[5,5] → "K7QM2-XR9TD" (50 bits). */
export function randomCode(groups: number[]): string {
  return groups.map((n) => Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")).join("-");
}

export const normalizeCode = (code: unknown) => String(code ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");

/** Recovery codes: only the HMAC is stored (50 bits, valid until used), so a database leak doesn't expose them. */
export const codeHash = (kind: "recuperacao", code: unknown) =>
  createHmac("sha256", env.checkinSecret).update(`${kind}:${normalizeCode(code)}`).digest("base64url");

/**
 * Activation code: unkeyed SHA-256, so the `leader:create` script (which runs outside Vercel, without
 * the production secret) can issue codes production accepts. 60 random bits, single use and valid for
 * 24 h: brute-forcing the hash within that window isn't feasible.
 */
export const setupCodeHash = (code: unknown) => createHash("sha256").update(`ativacao:${normalizeCode(code)}`).digest("base64url");

/** Hash of the session cookie value (the database never stores the value itself). */
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("base64url");
