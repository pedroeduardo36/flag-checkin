import "server-only";
import { createHmac } from "node:crypto";
import { after } from "next/server";
import { env } from "./env";
import { db } from "./supabase";

/** Turns the IP into an irreversible code (HMAC): repeats and abuse are visible without storing the raw IP. */
export function ipHash(req: Request): string | null {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip");
  return ip ? createHmac("sha256", env.checkinSecret).update(`ip:${ip}`).digest("base64url").slice(0, 22) : null;
}

/**
 * Logs an attempt on the public check-in routes after the response is sent: it never slows the user
 * down, and a failure here (for example, the table not existing yet) never breaks the check-in.
 * Event values are stored as-is in audit_events, so they stay in Portuguese.
 */
export function audit(
  req: Request,
  e: { event: "identificar" | "confirmar"; outcome: string; memberId?: string | null; lat?: number | null; lng?: number | null },
) {
  const row = {
    event: e.event,
    outcome: e.outcome,
    member_id: e.memberId ?? null,
    ip_hash: ipHash(req),
    user_agent: req.headers.get("user-agent")?.slice(0, 200) ?? null,
    lat: e.lat ?? null,
    lng: e.lng ?? null,
  };
  after(async () => {
    const { error } = await db().from("audit_events").insert(row);
    if (error) console.error("Failed to write audit event:", error.message);
  });
}
