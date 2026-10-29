import { withErrors } from "@/lib/server/http";
import { NextResponse } from "next/server";
import { db } from "@/lib/server/supabase";
import { PHOTO_BUCKET } from "@/lib/server/env";
import { checkGeofence, createCheckinToken, parseCoords, serviceDate } from "@/lib/server/security";
import { hasVisitSession } from "@/lib/server/visit";
import { audit } from "@/lib/server/audit";
import { firstName, isValidBirthDate, nameMatchScore, nameTokens } from "@/lib/format";

/** A identificação vale até a foto criativa, que é tirada já dentro do culto. */
const TOKEN_TTL_SECONDS = 4 * 60 * 60;

// Etapa 2: nome completo + data de nascimento. Devolve um token para a etapa da foto.
export const POST = withErrors(async (req: Request) => {
  const body = await req.json().catch(() => null);
  const coords = parseCoords(body);
  const name = String(body?.name ?? "").trim().slice(0, 120);
  const birthDate = String(body?.birthDate ?? "");

  const geo = checkGeofence(coords);
  const log = (outcome: string, memberId?: string) => audit(req, { event: "identificar", outcome, memberId, lat: coords?.lat, lng: coords?.lng });
  if (!coords && !geo.disabled)
    return NextResponse.json({ error: "Localização ausente. Volte e ative a localização." }, { status: 400 });
  if (nameTokens(name).length < 2 || !isValidBirthDate(birthDate))
    return NextResponse.json({ error: "Informe nome e sobrenome e a data de nascimento." }, { status: 400 });
  if (!geo.inside) {
    log("FORA_DO_LOCAL");
    return NextResponse.json({ error: "Você precisa estar no local do culto para fazer o check-in.", code: "FORA_DO_LOCAL" }, { status: 403 });
  }

  // Todos os nascidos nesse dia; o nome decide (tolera acento, "de/da", nome do meio omitido e um erro de digitação).
  const { data: sameDay, error } = await db()
    .from("members")
    .select("id, name, face_descriptor, photo_path")
    .eq("birth_date", birthDate);
  if (error) throw error;

  const ranked = (sameDay ?? [])
    .map((m) => ({ m, score: nameMatchScore(name, m.name) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!ranked.length) {
    log("NAO_ENCONTRADO");
    return NextResponse.json(
      {
        error: "Não encontramos seu cadastro com esse nome e data de nascimento. Confira os dados ou peça ao seu responsável para fazer o cadastro.",
        code: "NAO_ENCONTRADO",
      },
      { status: 404 },
    );
  }
  if (ranked.length > 1 && ranked[0].score === ranked[1].score) {
    log("AMBIGUO");
    return NextResponse.json(
      { error: "Encontramos mais de um cadastro parecido. Digite seu nome completo, como está no cadastro, ou procure um líder.", code: "AMBIGUO" },
      { status: 409 },
    );
  }
  const member = ranked[0].m;

  // Foto e horário de um check-in são dados privados de um menor. Nome + nascimento (+ coordenadas
  // informadas pelo próprio celular) NÃO autorizam lê-los. Só devolvemos esses detalhes ao aparelho
  // que concluiu o check-in deste adolescente hoje (sessão da visita, após a conferência de rosto).
  // Sem essa sessão a resposta é IDÊNTICA à de quem ainda não fez check-in: nem "já fez" vaza.
  const today = serviceDate();
  if (hasVisitSession(req, member.id, today)) {
    const { data: existing } = await db()
      .from("checkins")
      .select("checked_in_at, photo_path")
      .eq("member_id", member.id)
      .eq("service_date", today)
      .maybeSingle();
    if (existing) {
      log("detalhes_visita", member.id);
      const signed = existing.photo_path
        ? (await db().storage.from(PHOTO_BUCKET).createSignedUrl(existing.photo_path, 300)).data
        : null;
      return NextResponse.json({
        alreadyCheckedIn: true,
        name: member.name,
        checkedInAt: existing.checked_in_at,
        photoUrl: signed?.signedUrl ?? null,
      });
    }
  }

  log("token", member.id);
  const token = createCheckinToken(
    { mid: member.id, lat: coords?.lat ?? null, lng: coords?.lng ?? null, acc: coords?.accuracy ?? null, dist: geo.distance },
    TOKEN_TTL_SECONDS,
  );
  return NextResponse.json({
    token,
    expiresAt: new Date(Date.now() + TOKEN_TTL_SECONDS * 1000).toISOString(),
    firstName: firstName(member.name),
    // Primeiro check-in da vida: a foto é de REGISTRO (vira a referência do cadastro).
    photoKind: member.face_descriptor || member.photo_path ? "criativa" : "registro",
  });
});
