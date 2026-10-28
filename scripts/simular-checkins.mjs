// Simula adolescentes chegando ao culto, para ver o feed do pastor ao vivo.
// Uso:  node scripts/simular-checkins.mjs [URL] [--limpar]
// Cadastra como o responsável faria (sem foto) e faz o 1º check-in (foto de registro) nas coordenadas da igreja.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const BASE = (args.find((a) => a.startsWith("http")) || "http://localhost:3000").replace(/\/$/, "");
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l))
  .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^"(.*)"$/, "$1")]));
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const PREFIXO = "Simulação";

if (args.includes("--limpar")) {
  const { data } = await sb.from("members").select("id, photo_path").like("name", `${PREFIXO}%`);
  for (const m of data ?? []) {
    const { data: cks } = await sb.from("checkins").select("photo_path, is_example").eq("member_id", m.id);
    if (cks?.some((c) => c.is_example)) continue; // nunca apaga o check-in de exemplo
    await sb.storage.from("fotos").remove([m.photo_path, ...(cks ?? []).map((c) => c.photo_path)].filter(Boolean));
    await sb.from("members").delete().eq("id", m.id);
  }
  console.log(`🧹 ${data?.length ?? 0} cadastro(s) de simulação removido(s)`);
  process.exit(0);
}

const foto = (n) => "data:image/jpeg;base64," + readFileSync(`tests/fixtures/${n}.jpg`).toString("base64");
const cpf = () => {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  for (const len of [9, 10]) { const s = n.reduce((a, d, i) => a + d * (len + 1 - i), 0); const r = (s * 10) % 11; n.push(r === 10 ? 0 : r); }
  return n.join("");
};
const post = async (path, body, cookie) => {
  const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => ({})), setCookie: r.headers.get("set-cookie") };
};

const local = { lat: Number(env.CHURCH_LAT), lng: Number(env.CHURCH_LNG), accuracy: 12 };

const pessoas = [
  { name: `${PREFIXO} Ana Beatriz`, cadastro: "pessoa-a-cadastro", selfie: "pessoa-a-selfie" },
  { name: `${PREFIXO} Bruno Lima`, cadastro: "pessoa-b", selfie: "pessoa-b" },
];
for (const [i, p] of pessoas.entries()) {
  const doc = cpf();
  const c = await post("/api/cadastro", {
    name: p.name, cpf: doc, phone: "61999990000", birthDate: "2010-05-20", guardianName: "Responsável Simulação",
    guardianPhone: "61988880000", guardianEmail: env.SMTP_USER || "responsavel@example.com", consent: true,
  });
  console.log(`cadastro (sem foto): ${p.name} → ${c.status}`);
  const id = await post("/api/checkin/identificar", { ...local, name: p.name, birthDate: "2010-05-20" });
  const ok = await post("/api/checkin/confirmar", { token: id.data.token, photo: foto(p.cadastro) });
  console.log(`1º check-in (foto de ${id.data.photoKind}): ${p.name} → ${ok.status}`);
  if (i < pessoas.length - 1) await new Promise((r) => setTimeout(r, 8000));
}
