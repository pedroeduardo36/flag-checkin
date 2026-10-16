import { NextResponse } from "next/server";
import { db } from "@/lib/server/supabase";
import { PHOTO_BUCKET } from "@/lib/server/env";
import { analyzeFace } from "@/lib/server/face";
import { readFileSync } from "node:fs";
import path from "node:path";

export const maxDuration = 30;

export const dynamic = "force-dynamic";

// Diagnóstico da integração: confere variáveis, tabelas e bucket. Não expõe dados.
export async function GET() {
  const checks: Record<string, boolean | string> = {};
  const envs = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "CHURCH_LAT", "CHURCH_LNG", "REGISTRATION_PASSWORD", "CHECKIN_SECRET"];
  const missing = envs.filter((k) => !process.env[k]);
  checks.env = missing.length ? `faltando: ${missing.join(", ")}` : true;
  if (missing.length) return NextResponse.json({ ok: false, checks }, { status: 500 });

  try {
    const members = await db().from("members").select("id", { count: "exact", head: true });
    checks.members = members.error ? members.error.message : true;
    const checkins = await db().from("checkins").select("id", { count: "exact", head: true });
    checks.checkins = checkins.error ? checkins.error.message : true;
    const view = await db().from("presencas").select("culto", { head: true });
    checks.presencas = view.error ? view.error.message : true;
    const bucket = await db().storage.getBucket(PHOTO_BUCKET);
    checks.bucket = bucket.error ? bucket.error.message : bucket.data.public ? "bucket está PÚBLICO — deixe privado" : true;
    // Carrega os modelos de reconhecimento facial e confere que um logo (sem rosto) é recusado.
    const logo = readFileSync(path.join(process.cwd(), "public/brand/flag-logo.jpg"));
    const face = await analyzeFace(logo);
    checks.reconhecimento_facial = !face.ok && face.code === "SEM_ROSTO" ? true : `resultado inesperado: ${JSON.stringify(face).slice(0, 80)}`;
  } catch (err) {
    checks.conexao = err instanceof Error ? err.message : String(err);
  }

  const ok = Object.values(checks).every((v) => v === true);
  const geofence = process.env.GEOFENCE_DISABLED === "true" ? "DESLIGADA (modo teste)" : "ligada";
  return NextResponse.json({ ok, geofence, checks }, { status: ok ? 200 : 500 });
}
