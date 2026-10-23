import { withErrors } from "@/lib/server/http";
import { NextResponse, after } from "next/server";
import { db } from "@/lib/server/supabase";
import { PHOTO_BUCKET } from "@/lib/server/env";
import { decodePhoto, readCheckinToken, serviceDate } from "@/lib/server/security";
import { analyzeFace, matchCreativePhoto, parseDescriptor } from "@/lib/server/face";
import { sendCheckinEmail } from "@/lib/server/email";

export const maxDuration = 30;

/** Rosto de referência do cadastro. Cadastros antigos com foto mas sem descritor são calculados agora. */
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

// Etapa 3. No 1º check-in são duas chamadas: a foto de REGISTRO (completa o cadastro, sem check-in)
// e depois a foto CRIATIVA (conclui o check-in). Nos seguintes, só a criativa.
export const POST = withErrors(async (req: Request) => {
  const body = await req.json().catch(() => null);
  const t = readCheckinToken(body?.token);
  if (!t) return NextResponse.json({ error: "Sua identificação expirou. Comece o check-in de novo.", code: "TOKEN" }, { status: 401 });

  const photo = decodePhoto(body?.photo);
  if (!photo) return NextResponse.json({ error: "Foto inválida. Tire a foto novamente." }, { status: 400 });

  const { data: m, error: mErr } = await db()
    .from("members")
    .select("id, name, face_descriptor, photo_path, guardian_name, guardian_email, guardian_email2")
    .eq("id", t.mid)
    .single();
  if (mErr || !m) throw mErr ?? new Error("Membro não encontrado");

  const reference = await referenceDescriptor(m);

  if (!reference) {
    // FOTO DE REGISTRO: um rosto só, de perto. Vira a foto do cadastro; o check-in vem com a criativa.
    const face = await analyzeFace(photo.buffer);
    if (!face.ok) return NextResponse.json({ error: face.message, code: face.code }, { status: 422 });
    const regPath = `membros/${m.id}-${Date.now()}.jpg`;
    const up = await db().storage.from(PHOTO_BUCKET).upload(regPath, photo.buffer, { contentType: photo.contentType });
    if (up.error) throw up.error;
    const upd = await db().from("members").update({ photo_path: regPath, face_descriptor: face.descriptor }).eq("id", m.id);
    if (upd.error) throw upd.error;
    return NextResponse.json({ ok: true, registered: true, next: "criativa", name: m.name });
  }

  // FOTO CRIATIVA (amigos, pose, careta): basta um rosto conferir com o registro.
  const match = await matchCreativePhoto(photo.buffer, reference);
  if (!match.ok)
    return NextResponse.json({ error: match.message, code: match.code }, { status: match.code === "ROSTO_NAO_CONFERE" ? 403 : 422 });

  const date = serviceDate();
  const path = `checkins/${date}/${m.id}-${Date.now()}.jpg`;
  const up = await db().storage.from(PHOTO_BUCKET).upload(path, photo.buffer, { contentType: photo.contentType });
  if (up.error) throw up.error;
  const { count: anteriores } = await db().from("checkins").select("id", { count: "exact", head: true }).eq("member_id", m.id);
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
      is_first: !anteriores,
      face_distance: faceDistance,
      user_agent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
    })
    .select("id, checked_in_at")
    .single();

  if (error) {
    await db().storage.from(PHOTO_BUCKET).remove([path]);
    if (error.code === "23505")
      return NextResponse.json({ error: "Você já fez check-in hoje.", code: "DUPLICADO" }, { status: 409 });
    throw error;
  }

  // Aviso ao responsável depois da resposta: o adolescente não espera o servidor de e-mail.
  after(async () => {
    const status = await sendCheckinEmail([m.guardian_email, m.guardian_email2], {
      guardianName: m.guardian_name ?? "",
      teenName: m.name,
      checkedInAt: data.checked_in_at,
      photo: photo.buffer,
    });
    await db().from("checkins").update({ guardian_email_status: status, guardian_email_at: new Date().toISOString() }).eq("id", data.id);
  });

  return NextResponse.json({ ok: true, name: m.name, checkedInAt: data.checked_in_at, photoKind, isFirst: !anteriores });
});
