import { withErrors } from "@/lib/server/http";
import { NextResponse } from "next/server";
import { checkGeofence, parseCoords } from "@/lib/server/security";
import { env } from "@/lib/server/env";

// Tells the app whether the location check is on (off = test mode).
export const GET = withErrors(async () => NextResponse.json({ disabled: env.geofenceDisabled }));
export const dynamic = "force-dynamic";

// Step 1: checks that the device is at the service venue.
export const POST = withErrors(async (req: Request) => {
  const coords = parseCoords(await req.json().catch(() => null));
  if (!coords) return NextResponse.json({ error: "Localização inválida." }, { status: 400 });
  const geo = checkGeofence(coords);
  return NextResponse.json({ ok: geo.inside, distance: geo.distance, radius: geo.radius, disabled: geo.disabled });
});
