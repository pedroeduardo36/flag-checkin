import "server-only";
import { createHmac } from "node:crypto";
import { env } from "./env";
import { safeEqual } from "./security";

/**
 * Sessão da VISITA: prova de que ESTE aparelho concluiu ESTE check-in HOJE.
 *
 * Nome + data de nascimento (+ coordenadas, que o próprio celular informa) NÃO autorizam ler a foto
 * ou o horário de um check-in. Só quem passou pela conferência de rosto recebe este cookie (o visitante,
 * ao fazer o próprio check-in): httpOnly, SameSite=strict, restrito a /api/checkin, válido até o fim
 * do dia do culto. É ele que permite confirmar a saída (checkout) sem digitar nada de novo.
 */
export const VISIT_COOKIE = "o2_visita";

/** mid: adolescente (null = visitante). cid: o check-in (cookies de antes do checkout não têm). */
export type Visit = { mid: string | null; cid?: string; date: string; exp: number };

const sign = (data: string) => createHmac("sha256", env.checkinSecret).update(`visita:${data}`).digest("base64url");

export function createVisitSession(memberId: string | null, serviceDate: string, now = Date.now(), checkinId?: string) {
  const maxAge = 18 * 3600; // cobre o culto da noite com folga, some no dia seguinte
  const visit: Visit = { mid: memberId, ...(checkinId ? { cid: checkinId } : {}), date: serviceDate, exp: now + maxAge * 1000 };
  const data = Buffer.from(JSON.stringify(visit)).toString("base64url");
  return { value: `${data}.${sign(data)}`, maxAge };
}

export function readVisitSession(value: string | null | undefined, now = Date.now()): Visit | null {
  const [data, sig] = String(value ?? "").split(".");
  if (!data || !sig || !safeEqual(sig, sign(data))) return null;
  try {
    const v = JSON.parse(Buffer.from(data, "base64url").toString()) as Visit;
    const ok = (typeof v.mid === "string" || v.mid === null) && (v.cid === undefined || typeof v.cid === "string") && typeof v.date === "string";
    return ok && v.exp > now ? v : null;
  } catch {
    return null;
  }
}

/** Sessão da visita gravada neste aparelho (cookie da requisição), se válida. */
export function visitFromRequest(req: Request, now = Date.now()): Visit | null {
  const m = new RegExp(`(?:^|;\\s*)${VISIT_COOKIE}=([^;]+)`).exec(req.headers.get("cookie") ?? "");
  return readVisitSession(m ? decodeURIComponent(m[1]) : null, now);
}

/** Verdadeiro só se o cookie da requisição é deste adolescente e deste dia de culto. */
export function hasVisitSession(req: Request, memberId: string, serviceDate: string): boolean {
  const v = visitFromRequest(req);
  return !!v && v.mid === memberId && v.date === serviceDate;
}

export const visitCookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/api/checkin",
  maxAge,
});
