// Envia o e-mail de confirmação de cadastro para os responsáveis de todos os adolescentes já cadastrados
// (os cadastros novos já recebem na hora). Usa o mesmo modelo de lib/server/email.ts.
//
//   npx tsx --conditions=react-server scripts/enviar-confirmacao-cadastro.mts            → só simula
//   npx tsx --conditions=react-server scripts/enviar-confirmacao-cadastro.mts --enviar   → envia
//
// Registra cada envio em logs/confirmacao-cadastro.json: rodar de novo pula quem já recebeu.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^([A-Z_]+)=(.*)$/.exec(l);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
}

const { createClient } = await import("@supabase/supabase-js");
const { sendCadastroEmail, emailConfigured } = await import("../lib/server/email.ts");

const ENVIAR = process.argv.includes("--enviar");
const LOG = "logs/confirmacao-cadastro.json";
const log: Record<string, { to: string[]; status: string; at: string }> = existsSync(LOG) ? JSON.parse(readFileSync(LOG, "utf8")) : {};

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const { data: membros, error } = await sb
  .from("members")
  .select("id, name, guardian_name, guardian_email, guardian_email2")
  .order("name");
if (error) throw error;

const pendentes = membros.filter((m) => log[m.id]?.status !== "enviado");
const comEmail = pendentes.filter((m) => m.guardian_email || m.guardian_email2);
const enderecos = new Set(comEmail.flatMap((m) => [m.guardian_email, m.guardian_email2].filter(Boolean)));

console.log(`Cadastros: ${membros.length} · já receberam: ${membros.length - pendentes.length} · a enviar: ${comEmail.length} e-mails`);
console.log(`Endereços diferentes: ${enderecos.size} · com 2º e-mail: ${comEmail.filter((m) => m.guardian_email2).length} · sem e-mail: ${pendentes.length - comEmail.length}`);
if (!emailConfigured()) throw new Error("SMTP não configurado no .env.local");
if (!ENVIAR) {
  console.log("\nSimulação: nada foi enviado. Use --enviar para enviar.");
  process.exit(0);
}

let ok = 0, falhas = 0;
for (const [i, m] of comEmail.entries()) {
  const to = [m.guardian_email, m.guardian_email2].filter(Boolean) as string[];
  const status = await sendCadastroEmail(to, { guardianName: m.guardian_name ?? "", teenName: m.name });
  log[m.id] = { to, status, at: new Date().toISOString() };
  writeFileSync(LOG, JSON.stringify(log, null, 1));
  status === "enviado" ? ok++ : falhas++;
  console.log(`${String(i + 1).padStart(3)}/${comEmail.length} ${status === "enviado" ? "✅" : "❌"} ${m.name.split(" ")[0]} → ${to.length} e-mail(s)`);
  await new Promise((r) => setTimeout(r, 1500)); // ritmo seguro para o Gmail
}
console.log(`\nEnviados: ${ok} · falhas: ${falhas}${falhas ? " (rode de novo para tentar só as falhas)" : ""}`);
process.exit(falhas ? 1 : 0);
