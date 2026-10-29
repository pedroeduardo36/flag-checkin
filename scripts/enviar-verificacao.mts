// Pede a confirmação (com o novo consentimento, que explica a biometria) aos responsáveis dos cadastros
// anteriores a esta versão. Até o prazo (members.verify_by) o check-in continua; depois, só confirmando.
//
//   npm run verificacao:enviar              → só simula (conta os e-mails)
//   npm run verificacao:enviar -- --enviar  → envia
//
// Registra em logs/verificacao.json só o id do cadastro e o resultado (sem e-mail): rodar de novo pula
// quem já recebeu. Quem perdeu o link recebe outro pela aba Líderes ("Reenviar confirmação").
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^([A-Z_]+)=(.*)$/.exec(l);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
}
const { db } = await import("../lib/server/supabase");
const { appUrl, sendVerifications } = await import("../lib/server/guardian");
const { emailConfigured } = await import("../lib/server/email");

const ENVIAR = process.argv.includes("--enviar");
const LOG = "logs/verificacao.json";
const log: Record<string, { sent: number; at: string }> = existsSync(LOG) ? JSON.parse(readFileSync(LOG, "utf8")) : {};

const { data, error } = await db()
  .from("members")
  .select("id, name, guardian_name, guardian_email, guardian_email2, guardian_email_verified_at, guardian_email2_verified_at, verify_by")
  .is("guardian_email_verified_at", null)
  .is("consent_version", null)
  .order("created_at");
if (error) throw error;
const pendentes = data.filter((m) => !log[m.id]?.sent && m.guardian_email);
const base = appUrl();

console.log(`Cadastros antigos sem confirmação: ${data.length} · a enviar: ${pendentes.length} · link para ${base}/confirmar`);
if (!emailConfigured()) throw new Error("SMTP não configurado no .env.local");
if (!process.env.PUBLIC_APP_URL) throw new Error("Defina PUBLIC_APP_URL no .env.local (o link do e-mail usa esse endereço)");
if (!ENVIAR) {
  console.log("\nSimulação: nada foi enviado. Use --enviar para enviar.");
  process.exit(0);
}

let falhas = 0;
mkdirSync("logs", { recursive: true });
for (const [i, m] of pendentes.entries()) {
  const sent = await sendVerifications(m, base);
  log[m.id] = { sent, at: new Date().toISOString() };
  writeFileSync(LOG, JSON.stringify(log, null, 1));
  if (!sent) falhas++;
  console.log(`${String(i + 1).padStart(3)}/${pendentes.length} ${sent ? "✅" : "❌"} ${m.name.split(" ")[0]} → ${sent} e-mail(s)`);
  await new Promise((r) => setTimeout(r, 1500)); // ritmo seguro para o Gmail
}
console.log(`\nFalhas: ${falhas}${falhas ? " (rode de novo para tentar só as falhas)" : ""}`);
process.exit(falhas ? 1 : 0);
