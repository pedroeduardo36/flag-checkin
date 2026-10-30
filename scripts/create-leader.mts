// Creates a leader account from the command line (the FIRST leader; the rest are created in the "Líderes" tab).
// Usage:  npm run leader:create -- "First Last" email@example.com
// Prints the activation code ONCE (valid for 24 h). The person opens /pastor → "Ativar conta",
// sets their own password and enrolls the authenticator app. Nobody else ever knows the password.
import { readFileSync } from "node:fs";

for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^([A-Z_]+)=(.*)$/.exec(l);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
}
const { db } = await import("../lib/server/supabase");
const { resetAccess, normalizeEmail } = await import("../lib/server/leader");
const { isValidEmail, nameTokens } = await import("../lib/format");

const [name = "", rawEmail = ""] = process.argv.slice(2);
const email = normalizeEmail(rawEmail);
if (nameTokens(name).length < 2 || !isValidEmail(email)) {
  console.error('Usage: npm run leader:create -- "First Last" email@example.com');
  process.exit(1);
}

const { data: existing } = await db().from("leaders").select("id, status").eq("email", email).maybeSingle();
if (existing) {
  console.error("A leader with this email already exists. To reset their access, use the Líderes tab (another leader).");
  process.exit(1);
}
const { data, error } = await db().from("leaders").insert({ name: name.trim(), email }).select("id").single();
if (error) throw error;
const setup = await resetAccess(data.id);
const audit = await db().from("admin_audit").insert({
  action: "conta_criada", outcome: "ok", target_type: "lider", target_id: data.id, target_label: email,
  details: { via: "linha_de_comando", // stored in admin_audit, kept in Portuguese
  codigo_ativacao_valido_ate: setup.expiresAt },
});
if (audit.error) console.error("Warning: audit entry not written:", audit.error.message);

console.log(`\nLeader created: ${name.trim()} <${email}>`);
console.log(`Activation code (single use, valid until ${new Date(setup.expiresAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}):\n`);
console.log(`    ${setup.code}\n`);
console.log("Hand it over in person. They open /pastor → Ativar conta.");
