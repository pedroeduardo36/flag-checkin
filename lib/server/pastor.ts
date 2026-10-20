import "server-only";
import { createHmac } from "node:crypto";
import { env } from "./env";
import { safeEqual } from "./security";

/**
 * Sessão da área do pastor: cookie httpOnly "exp.assinatura" (HMAC-SHA256 com CHECKIN_SECRET).
 * Sem tabela de sessões: o servidor só confere a assinatura e a validade.
 */
export const PASTOR_COOKIE = "o2_pastor";
export const PASTOR_SESSION_HOURS = 12;

const sign = (exp: number) => createHmac("sha256", env.checkinSecret).update(`pastor:${exp}`).digest("base64url");

export function createPastorSession(now = Date.now()): { value: string; maxAge: number } {
  const maxAge = PASTOR_SESSION_HOURS * 3600;
  const exp = now + maxAge * 1000;
  return { value: `${exp}.${sign(exp)}`, maxAge };
}

export function isValidPastorSession(value: string | undefined | null, now = Date.now()): boolean {
  const [expStr, sig] = String(value ?? "").split(".");
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || !sig || exp < now) return false;
  return safeEqual(sig, sign(exp));
}

/** Lê o cookie direto do cabeçalho (funciona em qualquer Route Handler). */
export function isPastorRequest(req: Request): boolean {
  const cookie = req.headers.get("cookie") ?? "";
  const m = new RegExp(`(?:^|;\\s*)${PASTOR_COOKIE}=([^;]+)`).exec(cookie);
  return isValidPastorSession(m ? decodeURIComponent(m[1]) : null);
}

export const checkPastorPassword = (password: unknown) => safeEqual(String(password ?? ""), env.pastorPassword);

export const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
  maxAge,
});
