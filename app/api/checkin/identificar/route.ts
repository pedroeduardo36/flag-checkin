import { withErrors } from "@/lib/server/http";
import { NextResponse } from "next/server";
import { db } from "@/lib/server/supabase";
import { PHOTO_BUCKET } from "@/lib/server/env";
import { checkGeofence, createCheckinToken, parseCoords, serviceDate } from "@/lib/server/security";
import { hasVisitSession } from "@/lib/server/visit";
import { audit } from "@/lib/server/audit";
import { checkinAllowed } from "@/lib/server/guardian";
import { firstName, isValidBirthDate, nameMatchScore, nameTokens } from "@/lib/format";

/** Identification stays valid until the creative photo, which is taken once the service has started. */
const TOKEN_TTL_SECONDS = 4 * 60 * 60;

// Step 2: full name + birth date. Returns a token for the photo step.
export const POST = withErrors(async (req: Request) => {
  const body = await req.json().catch(() => null);
  const coords = parseCoords(body);
  const name = String(body?.name ?? "").trim().slice(0, 120);
  const birthDate = String(body?.birthDate ?? "");

  const geo = checkGeofence(coords);
  const log = (outcome: string, memberId?: string) => audit(req, { event: "identificar", outcome, memberId, distance: geo.distance });
  if (!coords && !geo.disabled)
    return NextResponse.json({ error: "Localização ausente. Volte e ative a localização." }, { status: 400 });
  if (nameTokens(name).length < 2 || !isValidBirthDate(birthDate))
    return NextResponse.json({ error: "Informe nome e sobrenome e a data de nascimento." }, { status: 400 });
  if (!geo.inside) {
    log("FORA_DO_LOCAL");
    return NextResponse.json({ error: "Você precisa estar no local do culto para fazer o check-in.", code: "FORA_DO_LOCAL" }, { status: 403 });
  }

  // Everyone born on that day; the name decides (tolerates accents, "de/da", an omitted middle name and one typo).
  const { data: sameDay, error } = await db()
    .from("members")
    .select("id, name, face_descriptor, photo_path, guardian_email_verified_at, biometric_consent_at, consent_version, verify_by")
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

  // Without consent confirmed by the owner of the guardian's email, no photo and no face analysis.
  if (!checkinAllowed(member)) {
    log("CADASTRO_PENDENTE", member.id);
    return NextResponse.json(
      {
        error: "Seu cadastro ainda não foi confirmado pelo seu responsável. Peça para ele(a) abrir o e-mail de confirmação da O2 · Flag, ou procure um líder.",
        code: "CADASTRO_PENDENTE",
      },
      { status: 403 },
    );
  }

  // A check-in's photo and time are a minor's private data. Name + birth date (+ coordinates
  // reported by the phone itself) do NOT authorize reading them. We only return these details to the device
  // that completed this teen's check-in today (visit session, after the face match).
  // Without that session the response is IDENTICAL to someone who hasn't checked in yet: not even "already done" leaks.
  const today = serviceDate();
  if (hasVisitSession(req, member.id, today)) {
    const { data: existing } = await db()
      .from("checkins")
      .select("checked_in_at, checked_out_at, photo_path")
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
        checkedOutAt: existing.checked_out_at,
        photoUrl: signed?.signedUrl ?? null,
      });
    }
  }

  log("token", member.id);
  const token = createCheckinToken(
    { mid: member.id, acc: coords?.accuracy ?? null, dist: geo.distance },
    TOKEN_TTL_SECONDS,
  );
  return NextResponse.json({
    token,
    expiresAt: new Date(Date.now() + TOKEN_TTL_SECONDS * 1000).toISOString(),
    firstName: firstName(member.name),
    // First check-in ever: the photo is the REGISTRATION one (it becomes the registration's reference).
    photoKind: member.face_descriptor || member.photo_path ? "criativa" : "registro",
  });
});
