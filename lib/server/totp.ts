import "server-only";
import { createHmac, randomBytes } from "node:crypto";

/**
 * Códigos de app autenticador (TOTP, RFC 6238): HMAC-SHA1, 6 dígitos, passo de 30 s.
 * Compatível com Google Authenticator, Microsoft Authenticator, 1Password, Authy etc.
 */
export const TOTP_STEP_SECONDS = 30;
const DIGITS = 6;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newTotpSecret = () => randomBytes(20); // 160 bits, o tamanho recomendado pela RFC 4226

export const totpStep = (now = Date.now()) => Math.floor(now / 1000 / TOTP_STEP_SECONDS);

export function totpAt(secret: Buffer, step: number, digits = DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", secret).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 10 ** digits).padStart(digits, "0");
}

/**
 * Confere o código aceitando 1 passo antes ou depois (relógio do celular adiantado/atrasado).
 * Devolve o passo que bateu, ou null. Só aceita passos depois de `lastStep`: o mesmo código
 * não entra duas vezes (o servidor grava o passo aceito).
 */
export function verifyTotp(secret: Buffer, code: unknown, lastStep: number, now = Date.now()): number | null {
  const c = String(code ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const cur = totpStep(now);
  for (const step of [cur - 1, cur, cur + 1]) {
    if (step > lastStep && totpAt(secret, step) === c) return step;
  }
  return null;
}

export function otpauthUri(secret: Buffer, account: string, issuer = "Flag O2"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const q = new URLSearchParams({ secret: base32Encode(secret), issuer, algorithm: "SHA1", digits: String(DIGITS), period: String(TOTP_STEP_SECONDS) });
  return `otpauth://totp/${label}?${q}`;
}
