import { withErrors } from "@/lib/server/http";
import { NextResponse } from "next/server";
import { db } from "@/lib/server/supabase";
import { isValidBirthDate, isValidCpf, isValidEmail, isValidPhone, nameTokens, onlyDigits } from "@/lib/format";

const clean = (v: unknown, max = 120) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);

/**
 * Cadastro feito pelo RESPONSÁVEL antes do culto (página /cadastro) ou pelo pastor.
 * Sem foto e sem senha do fiscal: a foto de referência é tirada no primeiro check-in.
 */
export const POST = withErrors(async (req: Request) => {
  const b = await req.json().catch(() => null);
  if (!b) return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  // Campo invisível para pessoas: só robôs o preenchem.
  if (b.website) return NextResponse.json({ ok: true });

  const data = {
    name: clean(b.name),
    cpf: onlyDigits(b.cpf),
    phone: onlyDigits(b.phone) || null,
    birth_date: String(b.birthDate ?? ""),
    guardian_name: clean(b.guardianName),
    guardian_phone: onlyDigits(b.guardianPhone),
    guardian_email: String(b.guardianEmail ?? "").trim().toLowerCase(),
  };

  const errors: Record<string, string> = {};
  if (nameTokens(data.name).length < 2) errors.name = "Informe nome e sobrenome do adolescente.";
  if (!isValidCpf(data.cpf)) errors.cpf = "CPF do adolescente inválido.";
  if (data.phone && !isValidPhone(data.phone)) errors.phone = "Telefone do adolescente inválido.";
  if (!isValidBirthDate(data.birth_date)) errors.birthDate = "Data de nascimento inválida.";
  if (nameTokens(data.guardian_name).length < 2) errors.guardianName = "Informe seu nome e sobrenome.";
  if (!isValidPhone(data.guardian_phone)) errors.guardianPhone = "Seu telefone está inválido.";
  if (!isValidEmail(data.guardian_email)) errors.guardianEmail = "Seu e-mail está inválido.";
  if (b.consent !== true) errors.consent = "É preciso autorizar o uso dos dados.";
  if (Object.keys(errors).length)
    return NextResponse.json({ error: "Corrija os campos destacados.", errors }, { status: 400 });

  const { error } = await db().from("members").insert({ ...data, guardian_consent_at: new Date().toISOString() });
  if (error) {
    if (error.code === "23505")
      return NextResponse.json({ error: "Este CPF já está cadastrado. O adolescente já pode fazer o check-in.", code: "CPF_EXISTE" }, { status: 409 });
    throw error;
  }
  return NextResponse.json({ ok: true });
});
