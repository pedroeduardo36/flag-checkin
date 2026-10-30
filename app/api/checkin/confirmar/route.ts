import { withErrors } from "@/lib/server/http";
import { NextResponse, after } from "next/server";
import { db } from "@/lib/server/supabase";
import { PHOTO_BUCKET } from "@/lib/server/env";
import { decodePhoto, readCheckinToken, serviceDate } from "@/lib/server/security";
import { analyzeFace, matchCreativePhoto, parseDescriptor } from "@/lib/server/face";
import { sendCheckinEmail } from "@/lib/server/email";
import { audit } from "@/lib/server/audit";
import { VISIT_COOKIE, createVisitSession, visitCookieOptions } from "@/lib/server/visit";

export const maxDuration = 30;

/** The registration's reference face. Older registrations with a photo but no descriptor are computed now. */
async function referenceDescriptor(m: { id: string; face_descriptor: unknown; photo_path: string | null }) {
  const saved = parseDescriptor(m.face_descriptor);
  if (saved || !m.photo_path) return saved;
  const file = await db().storage.from(PHOTO_BUCKET).download(m.photo_path);
  if (file.error) throw file.error;
  const face = await analyzeFace(Buffer.from(await file.data.arrayBuffer()));
  if (!face.ok) return null;
  await db().from("members").update({ face_descriptor: face.descriptor }).eq("id", m.id);
  return face.descriptor;
}

// Step 3. On the first check-in there are two calls: the REGISTRATION photo (completes the registration, no check-in)
// and then the CREATIVE photo (completes the check-in). Later check-ins only send the creative one.
export const POST = withErrors(async (req: Request) => {
  const body = await req.json().catch(() => null);
  const t = readCheckinToken(body?.token);
  const log = (outcome: string) => audit(req, { event: "confirmar", outcome, memberId: t?.mid, lat: t?.lat, lng: t?.lng });
  if (!t) return log("TOKEN"), NextResponse.json({ error: "Sua identificação expirou. Comece o check-in de novo.", code: "TOKEN" }, { status: 401 });

  const photo = decodePhoto(body?.photo);
  if (!photo) return NextResponse.json({ error: "Foto inválida. Tire a foto novamente." }, { status: 400 });

  const { data: m, error: mErr } = await db()
    .from("members")
    .select("id, name, face_descriptor, photo_path, guardian_name, guardian_email, guardian_email2")
    .eq("id", t.mid)
    .single();
  if (mErr || !m) throw mErr ?? new Error("Member not found");

  const reference = await referenceDescriptor(m);

  if (!reference) {
    // REGISTRATION PHOTO: a single face, close up. It becomes the registration photo; the check-in comes with the creative one.
    const face = await analyzeFace(photo.buffer);
    if (!face.ok) return log(face.code), NextResponse.json({ error: face.message, code: face.code }, { status: 422 });
    const regPath = `membros/${m.id}-${Date.now()}.jpg`;
    const up = await db().storage.from(PHOTO_BUCKET).upload(regPath, photo.buffer, { contentType: photo.contentType });
    if (up.error) throw up.error;
    const upd = await db().from("members").update({ photo_path: regPath, face_descriptor: face.descriptor }).eq("id", m.id);
    if (upd.error) throw upd.error;
    log("registro");
    return NextResponse.json({ ok: true, registered: true, next: "criativa", name: m.name });
  }

  // CREATIVE PHOTO (friends, poses, funny faces): one face matching the registration is enough.
  const match = await matchCreativePhoto(photo.buffer, reference);
  if (!match.ok)
    return log(match.code), NextResponse.json({ error: match.message, code: match.code }, { status: match.code === "ROSTO_NAO_CONFERE" ? 403 : 422 });

  const date = serviceDate();
  const path = `checkins/${date}/${m.id}-${Date.now()}.jpg`;
  const up = await db().storage.from(PHOTO_BUCKET).upload(path, photo.buffer, { contentType: photo.contentType });
  if (up.error) throw up.error;
  const { count: previousCheckins } = await db().from("checkins").select("id", { count: "exact", head: true }).eq("member_id", m.id);
  const photoKind = "criativa" as const;
  const faceDistance = Number(match.distance.toFixed(4));

  const { data, error } = await db()
    .from("checkins")
    .insert({
      member_id: m.id,
      service_date: date,
      latitude: t.lat,
      longitude: t.lng,
      accuracy_m: t.acc,
      distance_m: t.dist,
      photo_path: path,
      photo_kind: photoKind,
      is_first: !previousCheckins,
      face_distance: faceDistance,
      user_agent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
    })
    .select("id, checked_in_at")
    .single();

  if (error) {
    await db().storage.from(PHOTO_BUCKET).remove([path]);
    if (error.code !== "23505") throw error;
    // There was already a check-in today. We only get here AFTER the face matched: whoever holds the device proved
    // to be the teen, so they can see their own check-in (and this device gets the visit session).
    const { data: existing } = await db()
      .from("checkins")
      .select("checked_in_at, photo_path")
      .eq("member_id", m.id)
      .eq("service_date", date)
      .single();
    const signed = existing?.photo_path ? (await db().storage.from(PHOTO_BUCKET).createSignedUrl(existing.photo_path, 300)).data : null;
    log("DUPLICADO");
    const visit = createVisitSession(m.id, date);
    const dup = NextResponse.json(
      { error: "Você já fez check-in hoje.", code: "DUPLICADO", name: m.name, checkedInAt: existing?.checked_in_at ?? null, photoUrl: signed?.signedUrl ?? null },
      { status: 409 },
    );
    dup.cookies.set(VISIT_COOKIE, visit.value, visitCookieOptions(visit.maxAge));
    return dup;
  }

  // Guardian notice after the response: the teen doesn't wait for the mail server.
  after(async () => {
    const status = await sendCheckinEmail([m.guardian_email, m.guardian_email2], {
      guardianName: m.guardian_name ?? "",
      teenName: m.name,
      checkedInAt: data.checked_in_at,
      photo: photo.buffer,
    });
    await db().from("checkins").update({ guardian_email_status: status, guardian_email_at: new Date().toISOString() }).eq("id", data.id);
  });

  log("ok");
  // This device proved to be the teen (face matched): only it can see the photo and time again today.
  const visit = createVisitSession(m.id, date);
  const res = NextResponse.json({ ok: true, name: m.name, checkedInAt: data.checked_in_at, photoKind, isFirst: !previousCheckins });
  res.cookies.set(VISIT_COOKIE, visit.value, visitCookieOptions(visit.maxAge));
  return res;
});
