import "server-only";
import { NextResponse } from "next/server";
import { ipHash } from "./audit";
import { tooManyAttempts } from "./leader";

/**
 * Attempt limits for the public routes, kept in the database (auth_rate_hit), so they hold across server
 * instances. Many teens share the church's Wi-Fi, so per-network limits are generous and the tighter
 * ones are per person (name, phone, email or registration).
 */
export async function limited(req: Request, name: string, windowSeconds: number, perNetwork: number, per?: { key: string; max: number }) {
  const ip = ipHash(req) ?? "sem-ip";
  if (await tooManyAttempts(`${name}:ip:${ip}`, windowSeconds, perNetwork)) return true;
  return per ? tooManyAttempts(`${name}:${per.key}`, windowSeconds, per.max) : false;
}

export const slowDown = () =>
  NextResponse.json({ error: "Muitas tentativas seguidas. Espere alguns minutos e tente de novo.", code: "MUITAS_TENTATIVAS" }, { status: 429 });
