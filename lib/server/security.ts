import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";
import { distanceMeters } from "@/lib/format";

export function safeEqual(a: string, b: string): boolean {
  const ha = createHmac("sha256", "cmp").update(a).digest();
  const hb = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export type Coords = { lat: number; lng: number; accuracy: number };

export function parseCoords(body: any): Coords | null {
  const lat = Number(body?.lat), lng = Number(body?.lng), accuracy = Number(body?.accuracy ?? 0);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng, accuracy: Number.isFinite(accuracy) ? accuracy : 0 };
}

/** Confere se a posição está dentro do raio do local do culto. */
export function checkGeofence(c: Coords | null) {
  if (env.geofenceDisabled) {
    const distance = c ? Math.round(distanceMeters(c.lat, c.lng, env.churchLat, env.churchLng)) : null;
    return { inside: true, distance, radius: env.churchRadius, disabled: true };
  }
  if (!c) return { inside: false, distance: null, radius: env.churchRadius, disabled: false };
  const distance = Math.round(distanceMeters(c.lat, c.lng, env.churchLat, env.churchLng));
  return { inside: distance <= env.churchRadius, distance, radius: env.churchRadius, disabled: false };
}

// Token curto (5 min) que liga a etapa "CPF + nascimento" à etapa "foto".
type TokenPayload = { mid: string; lat: number | null; lng: number | null; acc: number | null; dist: number | null; exp: number };

const sign = (data: string) => createHmac("sha256", env.checkinSecret).update(data).digest("base64url");

export function createCheckinToken(p: Omit<TokenPayload, "exp">, ttlSeconds = 300): string {
  const data = Buffer.from(JSON.stringify({ ...p, exp: Date.now() + ttlSeconds * 1000 })).toString("base64url");
  return `${data}.${sign(data)}`;
}

export function readCheckinToken(token: string): TokenPayload | null {
  const [data, sig] = String(token ?? "").split(".");
  if (!data || !sig || !safeEqual(sig, sign(data))) return null;
  try {
    const p = JSON.parse(Buffer.from(data, "base64url").toString()) as TokenPayload;
    return p.exp > Date.now() ? p : null;
  } catch {
    return null;
  }
}

/** Data do culto no fuso de Brasília (AAAA-MM-DD). */
export function serviceDate(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
}

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

/** Converte o dataURL JPEG/PNG enviado pelo navegador em Buffer, com validação. */
export function decodePhoto(dataUrl: unknown): { buffer: Buffer; contentType: string } | null {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ""));
  if (!m) return null;
  const buffer = Buffer.from(m[2], "base64");
  if (buffer.length < 2000 || buffer.length > MAX_PHOTO_BYTES) return null;
  return { buffer, contentType: m[1] };
}
