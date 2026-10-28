// Cria uma conta de líder pela linha de comando (o PRIMEIRO líder; os demais são criados na aba "Líderes").
// Uso:  npm run lider:criar -- "Nome Sobrenome" email@exemplo.com
// Mostra UMA vez o código de ativação (vale 24 h). A pessoa abre /pastor → "Ativar conta",
// define a própria senha e cadastra o app autenticador. Ninguém além dela conhece a senha.
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
  console.error('Uso: npm run lider:criar -- "Nome Sobrenome" email@exemplo.com');
  process.exit(1);
}

const { data: existing } = await db().from("leaders").select("id, status").eq("email", email).maybeSingle();
if (existing) {
  console.error("Já existe um líder com este e-mail. Para redefinir o acesso, use a aba Líderes (outro líder).");
  process.exit(1);
}
const { data, error } = await db().from("leaders").insert({ name: name.trim(), email }).select("id").single();
if (error) throw error;
const setup = await resetAccess(data.id);
const audit = await db().from("admin_audit").insert({
  action: "conta_criada", outcome: "ok", target_type: "lider", target_id: data.id, target_label: email,
  details: { via: "linha_de_comando", codigo_ativacao_valido_ate: setup.expiresAt },
});
if (audit.error) console.error("Aviso: auditoria não gravada:", audit.error.message);

console.log(`\nLíder criado: ${name.trim()} <${email}>`);
console.log(`Código de ativação (uso único, vale até ${new Date(setup.expiresAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}):\n`);
console.log(`    ${setup.code}\n`);
console.log("Entregue pessoalmente. A pessoa abre /pastor → Ativar conta.");
