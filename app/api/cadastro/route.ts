import { withErrors } from "@/lib/server/http";
import { NextResponse } from "next/server";
import { db } from "@/lib/server/supabase";
import { env, PHOTO_BUCKET } from "@/lib/server/env";
import { decodePhoto, safeEqual } from "@/lib/server/security";
import { isValidBirthDate, isValidCpf, isValidPhone, onlyDigits } from "@/lib/format";

const clean = (v: unknown, max = 120) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);

export const POST = withErrors(async (req: Request) => {
  const b = await req.json().catch(() => null);
  if (!b) return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });

  if (!safeEqual(String(b.password ?? ""), env.registrationPassword))
    return NextResponse.json({ error: "Senha do fiscal incorreta.", field: "password" }, { status: 401 });

  const data = {
    name: clean(b.name),
    cpf: onlyDigits(b.cpf),
    phone: onlyDigits(b.phone),
    birth_date: String(b.birthDate ?? ""),
    guardian_name: clean(b.guardianName),
    guardian_phone: onlyDigits(b.guardianPhone),
  };

  const errors: Record<string, string> = {};
  if (data.name.split(" ").length < 2) errors.name = "Informe nome e sobrenome.";
  if (!isValidCpf(data.cpf)) errors.cpf = "CPF inválido.";
  if (!isValidPhone(data.phone)) errors.phone = "Telefone inválido.";
  if (!isValidBirthDate(data.birth_date)) errors.birthDate = "Data de nascimento inválida.";
  if (data.guardian_name.split(" ").length < 2) errors.guardianName = "Informe nome e sobrenome do responsável.";
  if (!isValidPhone(data.guardian_phone)) errors.guardianPhone = "Telefone do responsável inválido.";
  if (b.consent !== true) errors.consent = "É preciso a autorização do responsável.";
  const photo = decodePhoto(b.photo);
  if (!photo) errors.photo = "Tire uma foto do rosto.";
  if (Object.keys(errors).length)
    return NextResponse.json({ error: "Corrija os campos destacados.", errors }, { status: 400 });

  const { data: dup } = await db().from("members").select("id").eq("cpf", data.cpf).maybeSingle();
  if (dup)
    return NextResponse.json({ error: "Este CPF já está cadastrado. Faça o check-in.", code: "CPF_EXISTE" }, { status: 409 });

  const path = `membros/${data.cpf}-${Date.now()}.jpg`;
  const up = await db().storage.from(PHOTO_BUCKET).upload(path, photo!.buffer, { contentType: photo!.contentType });
  if (up.error) {
    console.error(up.error);
    return NextResponse.json({ error: "Não foi possível enviar a foto." }, { status: 500 });
  }

  const { error } = await db()
    .from("members")
    .insert({ ...data, photo_path: path, guardian_consent_at: new Date().toISOString() });
  if (error) {
    await db().storage.from(PHOTO_BUCKET).remove([path]);
    if (error.code === "23505")
      return NextResponse.json({ error: "Este CPF já está cadastrado.", code: "CPF_EXISTE" }, { status: 409 });
    console.error(error);
    return NextResponse.json({ error: "Erro ao salvar o cadastro." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
});
