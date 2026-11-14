import "server-only";
import { createHmac } from "node:crypto";
import { env } from "./env";
import { safeEqual } from "./security";

/**
 * VISIT session: proof that THIS device completed THIS check-in TODAY.
 *
 * Name + birth date (+ coordinates, which the phone itself reports) do NOT authorize reading a
 * check-in's photo or time. Only someone who passed the face match gets this cookie (a visitor gets it
 * on their own check-in): httpOnly, SameSite=strict, scoped to /api/checkin, valid until the end of the
 * service day. It is what lets the person confirm their checkout without typing anything again.
 */
export const VISIT_COOKIE = "o2_visita";

/** mid: the teen (null = visitor). cid: the check-in (cookies issued before checkout don't have it). */
export type Visit = { mid: string | null; cid?: string; date: string; exp: number };

// The "visita:" prefix and the cookie name are part of the signature: renaming them would log everyone out.
const sign = (data: string) => createHmac("sha256", env.checkinSecret).update(`visita:${data}`).digest("base64url");

export function createVisitSession(memberId: string | null, serviceDate: string, now = Date.now(), checkinId?: string) {
  const maxAge = 18 * 3600; // comfortably covers the evening service and expires the next day
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

/** The visit session stored on this device (the request cookie), if valid. */
export function visitFromRequest(req: Request, now = Date.now()): Visit | null {
  const m = new RegExp(`(?:^|;\\s*)${VISIT_COOKIE}=([^;]+)`).exec(req.headers.get("cookie") ?? "");
  return readVisitSession(m ? decodeURIComponent(m[1]) : null, now);
}

/** True only if the request cookie belongs to this teen and this service day. */
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
