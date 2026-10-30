// Sends the registration confirmation email to the guardians of every teen already registered
// (new registrations get it right away). Uses the same template as lib/server/email.ts.
//
//   npm run email:confirmation              → dry run only
//   npm run email:confirmation -- --send    → sends
//
// Records each send in logs/confirmacao-cadastro.json: running it again skips whoever already got it.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^([A-Z_]+)=(.*)$/.exec(l);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
}

const { createClient } = await import("@supabase/supabase-js");
const { sendRegistrationEmail, emailConfigured } = await import("../lib/server/email.ts");

const SEND = process.argv.includes("--send");
const LOG = "logs/confirmacao-cadastro.json";
const log: Record<string, { to: string[]; status: string; at: string }> = existsSync(LOG) ? JSON.parse(readFileSync(LOG, "utf8")) : {};

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const { data: members, error } = await sb
  .from("members")
  .select("id, name, guardian_name, guardian_email, guardian_email2")
  .order("name");
if (error) throw error;

const pending = members.filter((m) => log[m.id]?.status !== "enviado");
const withEmail = pending.filter((m) => m.guardian_email || m.guardian_email2);
const addresses = new Set(withEmail.flatMap((m) => [m.guardian_email, m.guardian_email2].filter(Boolean)));

console.log(`Registrations: ${members.length} · already received: ${members.length - pending.length} · to send: ${withEmail.length} emails`);
console.log(`Distinct addresses: ${addresses.size} · with a 2nd email: ${withEmail.filter((m) => m.guardian_email2).length} · no email: ${pending.length - withEmail.length}`);
if (!emailConfigured()) throw new Error("SMTP not configured in .env.local");
if (!SEND) {
  console.log("\nDry run: nothing was sent. Use --send to send.");
  process.exit(0);
}

let ok = 0, failures = 0;
for (const [i, m] of withEmail.entries()) {
  const to = [m.guardian_email, m.guardian_email2].filter(Boolean) as string[];
  const status = await sendRegistrationEmail(to, { guardianName: m.guardian_name ?? "", teenName: m.name });
  log[m.id] = { to, status, at: new Date().toISOString() };
  writeFileSync(LOG, JSON.stringify(log, null, 1));
  status === "enviado" ? ok++ : failures++;
  console.log(`${String(i + 1).padStart(3)}/${withEmail.length} ${status === "enviado" ? "✅" : "❌"} ${m.name.split(" ")[0]} → ${to.length} email(s)`);
  await new Promise((r) => setTimeout(r, 1500)); // safe pace for Gmail
}
console.log(`\nSent: ${ok} · failures: ${failures}${failures ? " (run again to retry only the failures)" : ""}`);
process.exit(failures ? 1 : 0);
