// Generates 8 Sundays of simulated attendance to see the pastor Dashboard with data.
// Usage:  node scripts/simulate-dashboard.mjs           (creates)
//         node scripts/simulate-dashboard.mjs --clean   (deletes everything starting with "Simulação")
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l))
  .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^"(.*)"$/, "$1")]));
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
// Name prefix of simulated rows (shown in the app, so it stays in Portuguese).
const PREFIX = "Simulação";

if (process.argv.includes("--clean")) {
  const { data: ms } = await sb.from("members").select("id").like("name", `${PREFIX}%`);
  if (ms?.length) await sb.from("members").delete().in("id", ms.map((m) => m.id));
  const { data: vs } = await sb.from("checkins").select("id").like("visitor_name", `${PREFIX}%`);
  if (vs?.length) await sb.from("checkins").delete().in("id", vs.map((v) => v.id));
  console.log(`🧹 ${ms?.length ?? 0} simulated teens and ${vs?.length ?? 0} simulated visitors removed`);
  process.exit(0);
}

const names = ["Ana Beatriz", "Bruno Lima", "Carla Mendes", "Davi Rocha", "Eduarda Alves", "Felipe Costa", "Gabriela Nunes", "Heitor Ramos", "Isabela Freitas", "João Pedro Dias"];
// Probability of each person attending each Sunday (the first ones attend more).
const attendanceRate = [1, 0.95, 0.9, 0.8, 0.75, 0.6, 0.5, 0.4, 0.3, 0.2];

const sundays = [];
const d = new Date();
d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 7) % 7) - 7); // last Sunday
for (let i = 7; i >= 0; i--) {
  const x = new Date(d);
  x.setUTCDate(d.getUTCDate() - i * 7);
  sundays.push(x.toISOString().slice(0, 10));
}

const { data: members, error } = await sb.from("members").insert(names.map((n) => ({
  name: `${PREFIX} ${n}`, birth_date: "2010-05-20", guardian_name: "Responsável Simulação",
  guardian_phone: "61988880000", guardian_email: "responsavel@example.com", guardian_consent_at: new Date().toISOString(),
  guardian_email_verified_at: new Date().toISOString(), biometric_consent_at: new Date().toISOString(), consent_version: "simulacao", verify_by: null,
}))).select("id");
if (error) throw error;

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const rows = [];
sundays.forEach((day, k) => {
  members.forEach((m, i) => {
    if (rand() < attendanceRate[i]) rows.push({ member_id: m.id, service_date: day, checked_in_at: `${day}T22:${String(10 + i).padStart(2, "0")}:00Z`, photo_kind: "criativa" });
  });
  const visitors = Math.floor(rand() * 4) + (k > 4 ? 1 : 0);
  for (let v = 0; v < visitors; v++)
    rows.push({ member_id: null, visitor_name: `${PREFIX} Visitante ${k}-${v}`, visitor_phone: `6190000${k}${v}${String(Math.floor(rand() * 100)).padStart(2, "0")}`, service_date: day, checked_in_at: `${day}T22:30:00Z` });
});
const ins = await sb.from("checkins").insert(rows);
if (ins.error) throw ins.error;
console.log(`✅ ${members.length} teens, ${rows.length} check-ins over ${sundays.length} Sundays (${sundays[0]} to ${sundays.at(-1)})`);
