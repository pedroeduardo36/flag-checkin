// Gera 8 domingos de presença simulada para ver o Dashboard do pastor com dados.
// Uso:  node scripts/simular-dashboard.mjs            (cria)
//       node scripts/simular-dashboard.mjs --limpar   (apaga tudo que começa com "Simulação")
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l))
  .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^"(.*)"$/, "$1")]));
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const PREFIXO = "Simulação";

if (process.argv.includes("--limpar")) {
  const { data: ms } = await sb.from("members").select("id").like("name", `${PREFIXO}%`);
  if (ms?.length) await sb.from("members").delete().in("id", ms.map((m) => m.id));
  const { data: vs } = await sb.from("checkins").select("id").like("visitor_name", `${PREFIXO}%`);
  if (vs?.length) await sb.from("checkins").delete().in("id", vs.map((v) => v.id));
  console.log(`🧹 ${ms?.length ?? 0} adolescentes e ${vs?.length ?? 0} visitantes de simulação removidos`);
  process.exit(0);
}

const nomes = ["Ana Beatriz", "Bruno Lima", "Carla Mendes", "Davi Rocha", "Eduarda Alves", "Felipe Costa", "Gabriela Nunes", "Heitor Ramos", "Isabela Freitas", "João Pedro Dias"];
// Probabilidade de cada um ir em cada domingo (os primeiros vão mais).
const assiduidade = [1, 0.95, 0.9, 0.8, 0.75, 0.6, 0.5, 0.4, 0.3, 0.2];

const domingos = [];
const d = new Date();
d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 7) % 7) - 7); // domingo passado
for (let i = 7; i >= 0; i--) {
  const x = new Date(d);
  x.setUTCDate(d.getUTCDate() - i * 7);
  domingos.push(x.toISOString().slice(0, 10));
}

const { data: membros, error } = await sb.from("members").insert(nomes.map((n) => ({
  name: `${PREFIXO} ${n}`, birth_date: "2010-05-20", guardian_name: "Responsável Simulação",
  guardian_phone: "61988880000", guardian_email: "responsavel@example.com", guardian_consent_at: new Date().toISOString(),
}))).select("id");
if (error) throw error;

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const linhas = [];
domingos.forEach((dia, k) => {
  membros.forEach((m, i) => {
    if (rand() < assiduidade[i]) linhas.push({ member_id: m.id, service_date: dia, checked_in_at: `${dia}T22:${String(10 + i).padStart(2, "0")}:00Z`, photo_kind: "criativa" });
  });
  const visitantes = Math.floor(rand() * 4) + (k > 4 ? 1 : 0);
  for (let v = 0; v < visitantes; v++)
    linhas.push({ member_id: null, visitor_name: `${PREFIXO} Visitante ${k}-${v}`, visitor_phone: `6190000${k}${v}${String(Math.floor(rand() * 100)).padStart(2, "0")}`, service_date: dia, checked_in_at: `${dia}T22:30:00Z` });
});
const ins = await sb.from("checkins").insert(linhas);
if (ins.error) throw ins.error;
console.log(`✅ ${membros.length} adolescentes, ${linhas.length} check-ins em ${domingos.length} domingos (${domingos[0]} a ${domingos.at(-1)})`);
