import { withErrors } from "@/lib/server/http";
import { NextResponse } from "next/server";
import { checkGeofence, parseCoords } from "@/lib/server/security";
import { env } from "@/lib/server/env";

// Diz ao app se a verificação de localização está ligada (desligada = modo teste).
export const GET = withErrors(async () => NextResponse.json({ disabled: env.geofenceDisabled }));
export const dynamic = "force-dynamic";

// Etapa 1: confere se o aparelho está no local do culto.
export const POST = withErrors(async (req: Request) => {
  const coords = parseCoords(await req.json().catch(() => null));
  if (!coords) return NextResponse.json({ error: "Localização inválida." }, { status: 400 });
  const geo = checkGeofence(coords);
  return NextResponse.json({ ok: geo.inside, distance: geo.distance, radius: geo.radius, disabled: geo.disabled });
});
