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

// Etapa 3: foto de registro (1º check-in) ou foto criativa (demais) → grava o check-in.
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

  const date = serviceDate();
  const reference = await referenceDescriptor(m);
  let path: string;
  let photoKind: "registro" | "criativa";
  let faceDistance: number | null = null;

  if (!reference) {
    // PRIMEIRO CHECK-IN: a foto precisa ter um rosto só, de perto. Vira a foto do cadastro.
    const face = await analyzeFace(photo.buffer);
    if (!face.ok) return NextResponse.json({ error: face.message, code: face.code }, { status: 422 });
    path = `membros/${m.id}-${Date.now()}.jpg`;
    const up = await db().storage.from(PHOTO_BUCKET).upload(path, photo.buffer, { contentType: photo.contentType });
    if (up.error) throw up.error;
    await db().from("members").update({ photo_path: path, face_descriptor: face.descriptor }).eq("id", m.id);
    photoKind = "registro";
  } else {
    // DEMAIS CHECK-INS: foto criativa (amigos, pose, careta). Basta um rosto conferir.
    const match = await matchCreativePhoto(photo.buffer, reference);
    if (!match.ok)
      return NextResponse.json({ error: match.message, code: match.code }, { status: match.code === "ROSTO_NAO_CONFERE" ? 403 : 422 });
    path = `checkins/${date}/${m.id}-${Date.now()}.jpg`;
    const up = await db().storage.from(PHOTO_BUCKET).upload(path, photo.buffer, { contentType: photo.contentType });
    if (up.error) throw up.error;
    photoKind = "criativa";
    faceDistance = Number(match.distance.toFixed(4));
  }

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
      face_distance: faceDistance,
      user_agent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
    })
    .select("id, checked_in_at")
    .single();

  if (error) {
    if (photoKind === "criativa") await db().storage.from(PHOTO_BUCKET).remove([path]);
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

  return NextResponse.json({ ok: true, name: m.name, checkedInAt: data.checked_in_at, photoKind });
});
