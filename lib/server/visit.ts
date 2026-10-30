import "server-only";
import { createHmac } from "node:crypto";
import { env } from "./env";
import { safeEqual } from "./security";

/**
 * VISIT session: proof that THIS device completed THIS teen's check-in TODAY.
 *
 * Name + birth date (+ coordinates, which the phone itself reports) do NOT authorize reading a
 * check-in's photo or time. Only someone who passed the face match gets this cookie:
 * httpOnly, SameSite=strict, scoped to /api/checkin, valid until the end of the service day.
 */
export const VISIT_COOKIE = "o2_visita";

type Visit = { mid: string; date: string; exp: number };

// The "visita:" prefix and the cookie name are part of the signature: renaming them would log everyone out.
const sign = (data: string) => createHmac("sha256", env.checkinSecret).update(`visita:${data}`).digest("base64url");

export function createVisitSession(memberId: string, serviceDate: string, now = Date.now()) {
  const maxAge = 18 * 3600; // comfortably covers the evening service and expires the next day
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

/** True only if the request cookie belongs to this teen and this service day. */
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
