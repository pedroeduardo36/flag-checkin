import { withErrors } from "@/lib/server/http";
import { NextResponse } from "next/server";
import { db } from "@/lib/server/supabase";
import { PHOTO_BUCKET } from "@/lib/server/env";
import { checkGeofence, createCheckinToken, parseCoords, serviceDate } from "@/lib/server/security";
import { firstName, isValidBirthDate, isValidCpf, onlyDigits } from "@/lib/format";

// Etapa 2: CPF + data de nascimento. Devolve um token para a etapa da foto.
export const POST = withErrors(async (req: Request) => {
  const body = await req.json().catch(() => null);
  const coords = parseCoords(body);
  const cpf = onlyDigits(body?.cpf);
  const birthDate = String(body?.birthDate ?? "");

  const geo = checkGeofence(coords);
  if (!coords && !geo.disabled)
    return NextResponse.json({ error: "Localização ausente. Volte e ative a localização." }, { status: 400 });
  if (!isValidCpf(cpf) || !isValidBirthDate(birthDate))
    return NextResponse.json({ error: "Confira o CPF e a data de nascimento." }, { status: 400 });

  if (!geo.inside)
    return NextResponse.json({ error: "Você precisa estar no local do culto para fazer o check-in.", code: "FORA_DO_LOCAL" }, { status: 403 });

  const { data: member, error } = await db()
    .from("members")
    .select("id, name, birth_date")
    .eq("cpf", cpf)
    .maybeSingle();
  if (error) {
    console.error(error);
    return NextResponse.json({ error: "Erro ao consultar o cadastro. Tente de novo." }, { status: 500 });
  }
  // Mesma mensagem para CPF inexistente e data errada: não revela quais CPFs existem.
  if (!member || member.birth_date !== birthDate)
    return NextResponse.json(
      { error: "Não encontramos um cadastro com esse CPF e data de nascimento.", code: "NAO_ENCONTRADO" },
      { status: 404 },
    );

  const { data: existing } = await db()
    .from("checkins")
    .select("checked_in_at, photo_path")
    .eq("member_id", member.id)
    .eq("service_date", serviceDate())
    .maybeSingle();

  if (existing) {
    const { data: signed } = await db().storage.from(PHOTO_BUCKET).createSignedUrl(existing.photo_path, 600);
    return NextResponse.json({
      alreadyCheckedIn: true,
      name: member.name,
      checkedInAt: existing.checked_in_at,
      photoUrl: signed?.signedUrl ?? null,
    });
  }

  const token = createCheckinToken({
    mid: member.id,
    lat: coords?.lat ?? null,
    lng: coords?.lng ?? null,
    acc: coords?.accuracy ?? null,
    dist: geo.distance,
  });
  return NextResponse.json({ alreadyCheckedIn: false, token, firstName: firstName(member.name) });
});
