import "server-only";
import { createHmac } from "node:crypto";
import { env } from "./env";
import { safeEqual } from "./security";

/**
 * Sessão da VISITA: prova de que ESTE aparelho concluiu o check-in DESTE adolescente HOJE.
 *
 * Nome + data de nascimento (+ coordenadas, que o próprio celular informa) NÃO autorizam ler a foto
 * ou o horário de um check-in. Só quem passou pela conferência de rosto recebe este cookie:
 * httpOnly, SameSite=strict, restrito a /api/checkin, válido até o fim do dia do culto.
 */
export const VISIT_COOKIE = "o2_visita";

type Visit = { mid: string; date: string; exp: number };

const sign = (data: string) => createHmac("sha256", env.checkinSecret).update(`visita:${data}`).digest("base64url");

export function createVisitSession(memberId: string, serviceDate: string, now = Date.now()) {
  const maxAge = 18 * 3600; // cobre o culto da noite com folga, some no dia seguinte
  const data = Buffer.from(JSON.stringify({ mid: memberId, date: serviceDate, exp: now + maxAge * 1000 } satisfies Visit)).toString("base64url");
  return { value: `${data}.${sign(data)}`, maxAge };
}

export function readVisitSession(value: string | null | undefined, now = Date.now()): Visit | null {
  const [data, sig] = String(value ?? "").split(".");
  if (!data || !sig || !safeEqual(sig, sign(data))) return null;
  try {
    const v = JSON.parse(Buffer.from(data, "base64url").toString()) as Visit;
    return typeof v.mid === "string" && typeof v.date === "string" && v.exp > now ? v : null;
  } catch {
    return null;
  }
}

/** Verdadeiro só se o cookie da requisição é deste adolescente e deste dia de culto. */
export function hasVisitSession(req: Request, memberId: string, serviceDate: string): boolean {
  const m = new RegExp(`(?:^|;\\s*)${VISIT_COOKIE}=([^;]+)`).exec(req.headers.get("cookie") ?? "");
  const v = readVisitSession(m ? decodeURIComponent(m[1]) : null);
  return !!v && v.mid === memberId && v.date === serviceDate;
}

export const visitCookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/api/checkin",
  maxAge,
});
