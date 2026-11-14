// Asks the guardians of registrations older than this version to confirm (with the new consent, which explains
// biometrics). Check-in keeps working until the deadline (members.verify_by); after that, only once confirmed.
//
//   npm run verification:send              → dry run only (counts the emails)
//   npm run verification:send -- --send     → sends
//
// Writes only the registration id and the result to logs/verificacao.json (no email): running it again skips
// whoever already got one. Anyone who lost the link gets another from the Leaders tab ("Reenviar confirmação").
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^([A-Z_]+)=(.*)$/.exec(l);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
}
const { db } = await import("../lib/server/supabase");
const { appUrl, sendVerifications } = await import("../lib/server/guardian");
const { emailConfigured } = await import("../lib/server/email");

const SEND = process.argv.includes("--send");
const LOG = "logs/verificacao.json";
const log: Record<string, { sent: number; at: string }> = existsSync(LOG) ? JSON.parse(readFileSync(LOG, "utf8")) : {};

const { data, error } = await db()
  .from("members")
  .select("id, name, guardian_name, guardian_email, guardian_email2, guardian_email_verified_at, guardian_email2_verified_at, verify_by")
  .is("guardian_email_verified_at", null)
  .is("consent_version", null)
  .order("created_at");
if (error) throw error;
const pending = data.filter((m) => !log[m.id]?.sent && m.guardian_email);
const base = appUrl();

console.log(`Unconfirmed legacy registrations: ${data.length} · to send: ${pending.length} · link to ${base}/confirmar`);
if (!emailConfigured()) throw new Error("SMTP is not configured in .env.local");
if (!process.env.PUBLIC_APP_URL) throw new Error("Set PUBLIC_APP_URL in .env.local (the email link uses that address)");
if (!SEND) {
  console.log("\nDry run: nothing was sent. Use --send to send.");
  process.exit(0);
}

let failures = 0;
mkdirSync("logs", { recursive: true });
for (const [i, m] of pending.entries()) {
  const sent = await sendVerifications(m, base);
  log[m.id] = { sent, at: new Date().toISOString() };
  writeFileSync(LOG, JSON.stringify(log, null, 1));
  if (!sent) failures++;
  console.log(`${String(i + 1).padStart(3)}/${pending.length} ${sent ? "✅" : "❌"} ${m.name.split(" ")[0]} → ${sent} e-mail(s)`);
  await new Promise((r) => setTimeout(r, 1500)); // a pace Gmail is comfortable with
}
console.log(`\nFailures: ${failures}${failures ? " (run again to retry only the failures)" : ""}`);
process.exit(failures ? 1 : 0);
