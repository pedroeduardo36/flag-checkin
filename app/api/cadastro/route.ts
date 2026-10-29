import { withErrors } from "@/lib/server/http";
import { NextResponse, after } from "next/server";
import { db } from "@/lib/server/supabase";
import { emailConfigured, senderAddress } from "@/lib/server/email";
import { CONSENT_VERSION, VERIFY_TTL_DAYS, appUrl, sendVerifications } from "@/lib/server/guardian";
import { isValidBirthDate, isValidEmail, isValidPhone, nameTokens, onlyDigits } from "@/lib/format";
import { findDuplicate } from "@/lib/duplicates";

const clean = (v: unknown, max = 120) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);

/**
 * Cadastro feito pelo RESPONSÁVEL antes do culto (página /cadastro) ou pelo pastor.
 * Sem foto e sem senha do fiscal: a foto de referência é tirada no primeiro check-in.
 * Sem CPF: o check-in usa nome + nascimento e as presenças apontam para o id interno do cadastro.
 * Cadastro parecido com um existente é gravado com a marca "possível duplicado" para um líder revisar.
 * O cadastro só vale depois que o dono do e-mail confirma pelo link (lib/server/guardian.ts).
 */
export const POST = withErrors(async (req: Request) => {
  const b = await req.json().catch(() => null);
  if (!b) return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  // Campo invisível para pessoas: só robôs o preenchem.
  if (b.website) return NextResponse.json({ ok: true });

  const data = {
    name: clean(b.name),
    phone: onlyDigits(b.phone) || null,
    birth_date: String(b.birthDate ?? ""),
    guardian_name: clean(b.guardianName),
    guardian_phone: onlyDigits(b.guardianPhone),
    guardian_email: String(b.guardianEmail ?? "").trim().toLowerCase(),
    guardian_email2: String(b.guardianEmail2 ?? "").trim().toLowerCase() || null,
  };

  const errors: Record<string, string> = {};
  if (nameTokens(data.name).length < 2) errors.name = "Informe nome e sobrenome do adolescente.";
  if (data.phone && !isValidPhone(data.phone)) errors.phone = "Telefone do adolescente inválido.";
  if (!isValidBirthDate(data.birth_date)) errors.birthDate = "Data de nascimento inválida.";
  if (nameTokens(data.guardian_name).length < 2) errors.guardianName = "Informe seu nome e sobrenome.";
  if (!isValidPhone(data.guardian_phone)) errors.guardianPhone = "Seu telefone está inválido.";
  if (!isValidEmail(data.guardian_email)) errors.guardianEmail = "Seu e-mail está inválido.";
  if (data.guardian_email2 && !isValidEmail(data.guardian_email2)) errors.guardianEmail2 = "O segundo e-mail está inválido.";
  else if (data.guardian_email2 && data.guardian_email2 === data.guardian_email) errors.guardianEmail2 = "Use um e-mail diferente do primeiro.";
  if (b.consent !== true) errors.consent = "É preciso autorizar o uso dos dados.";
  if (b.consentBiometric !== true) errors.consentBiometric = "É preciso autorizar o reconhecimento facial para usar o check-in.";
  if (Object.keys(errors).length)
    return NextResponse.json({ error: "Corrija os campos destacados.", errors }, { status: 400 });

  const { data: sameDay, error: findError } = await db()
    .from("members")
    .select("id, name, guardian_name, guardian_email, guardian_email2, guardian_email_verified_at, guardian_email2_verified_at, created_at")
    .eq("birth_date", data.birth_date)
    .order("created_at");
  if (findError) throw findError;
  const match = findDuplicate(data, sameDay ?? []);

  const ok = () => NextResponse.json({ ok: true, confirmationSent: emailConfigured(), sender: senderAddress(), validDays: VERIFY_TTL_DAYS });
  const base = appUrl(req);

  // Mesmo responsável reenviando o mesmo cadastro: nada a gravar; reenvia o link para o que falta confirmar.
  // A resposta é igual à de um cadastro novo, então o formulário não revela se alguém já está cadastrado.
  if (match?.resubmission) {
    const existing = sameDay!.find((x) => x.id === match.id)!;
    after(() => sendVerifications(existing, base));
    return ok();
  }

  const { data: created, error } = await db()
    .from("members")
    .insert({
      ...data,
      guardian_consent_at: new Date().toISOString(), // declaração no formulário; o consentimento vale com a confirmação
      consent_version: CONSENT_VERSION,
      verify_by: null,
      possible_duplicate_of: match?.id ?? null,
    })
    .select("id, name, guardian_name, guardian_email, guardian_email2, guardian_email_verified_at, guardian_email2_verified_at")
    .single();
  if (error) throw error;
  // Link de confirmação depois da resposta: o responsável já confere se caiu no spam.
  after(() => sendVerifications(created, base));
  return ok();
});
