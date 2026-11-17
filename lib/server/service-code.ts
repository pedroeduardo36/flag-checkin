import "server-only";
import { createHmac } from "node:crypto";
import { env } from "./env";
import { safeEqual } from "./security";

/**
 * Code of the day for a teen's FIRST check-in, shown to leaders on /pastor and given in person at the door.
 * The first check-in saves the reference face for the whole registration, so it can't be done from afar by
 * someone who knows a teen's name and birth date (the phone's location is reported by the phone itself).
 */
export function serviceCode(date: string): string {
  const h = createHmac("sha256", env.checkinSecret).update(`codigo-culto:${date}`).digest();
  return String(h.readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

export const serviceCodeMatches = (date: string, code: unknown) =>
  safeEqual(String(code ?? "").replace(/\D/g, ""), serviceCode(date));
