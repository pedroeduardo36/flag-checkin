// Simulates teens arriving at the service, to watch the pastor's feed live.
// Usage:  node scripts/simulate-checkins.mjs [URL] [--clean]
// Registers them as a guardian would (no photo) and does the first check-in (registration photo) at the church coordinates.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const BASE = (args.find((a) => a.startsWith("http")) || "http://localhost:3000").replace(/\/$/, "");
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l))
  .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^"(.*)"$/, "$1")]));
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
// Name prefix of simulated rows (shown in the app, so it stays in Portuguese).
const PREFIX = "Simulação";

if (args.includes("--clean")) {
  const { data } = await sb.from("members").select("id, photo_path").like("name", `${PREFIX}%`);
  for (const m of data ?? []) {
    const { data: cks } = await sb.from("checkins").select("photo_path, is_example").eq("member_id", m.id);
    if (cks?.some((c) => c.is_example)) continue; // never deletes the example check-in
    await sb.storage.from("fotos").remove([m.photo_path, ...(cks ?? []).map((c) => c.photo_path)].filter(Boolean));
    await sb.from("members").delete().eq("id", m.id);
  }
  console.log(`🧹 ${data?.length ?? 0} simulated registration(s) removed`);
  process.exit(0);
}

const photo = (n) => "data:image/jpeg;base64," + readFileSync(`tests/fixtures/${n}.jpg`).toString("base64");
const post = async (path, body, cookie) => {
  const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => ({})), setCookie: r.headers.get("set-cookie") };
};

const local = { lat: Number(env.CHURCH_LAT), lng: Number(env.CHURCH_LNG), accuracy: 12 };

const people = [
  { name: `${PREFIX} Ana Beatriz`, registration: "person-a-registration", selfie: "person-a-selfie" },
  { name: `${PREFIX} Bruno Lima`, registration: "person-b", selfie: "person-b" },
];
for (const [i, p] of people.entries()) {
  const c = await post("/api/cadastro", {
    name: p.name, phone: "61999990000", birthDate: "2010-05-20", guardianName: "Responsável Simulação",
    guardianPhone: "61988880000", guardianEmail: env.SMTP_USER || "responsavel@example.com", consent: true, consentBiometric: true,
  });
  console.log(`registration (no photo): ${p.name} → ${c.status}`);
  // Simulation: the "guardian" confirms straight in the database (in the real app, through the email link).
  const now = new Date().toISOString();
  await sb.from("members").update({ guardian_email_verified_at: now, biometric_consent_at: now }).eq("name", p.name);
  const id = await post("/api/checkin/identificar", { ...local, name: p.name, birthDate: "2010-05-20" });
  const ok = await post("/api/checkin/confirmar", { token: id.data.token, photo: photo(p.registration) });
  console.log(`first check-in (${id.data.photoKind} photo): ${p.name} → ${ok.status}`);
  if (i < people.length - 1) await new Promise((r) => setTimeout(r, 8000));
}
