import { withErrors } from "@/lib/server/http";
import { NextResponse, after } from "next/server";
import { db } from "@/lib/server/supabase";
import { PHOTO_BUCKET } from "@/lib/server/env";
import { decodePhoto, readCheckinToken, serviceDate } from "@/lib/server/security";
import { analyzeFace, faceDistance, matchThreshold, parseDescriptor } from "@/lib/server/face";
import { sendCheckinEmail } from "@/lib/server/email";

export const maxDuration = 30;

/** Descritor do rosto do cadastro. Cadastros antigos (sem descritor) são calculados agora e salvos. */
async function referenceDescriptor(memberId: string) {
  const { data: m, error } = await db().from("members").select("face_descriptor, photo_path").eq("id", memberId).single();
  if (error || !m) throw error ?? new Error("Membro não encontrado");
  const saved = parseDescriptor(m.face_descriptor);
  if (saved) return saved;

  const file = await db().storage.from(PHOTO_BUCKET).download(m.photo_path);
  if (file.error) throw file.error;
  const face = await analyzeFace(Buffer.from(await file.data.arrayBuffer()));
  if (!face.ok) return null;
  await db().from("members").update({ face_descriptor: face.descriptor }).eq("id", memberId);
  return face.descriptor;
}

// Etapa 3: recebe a selfie antifraude e grava o check-in.
export const POST = withErrors(async (req: Request) => {
  const body = await req.json().catch(() => null);
  const t = readCheckinToken(body?.token);
  if (!t) return NextResponse.json({ error: "Sessão expirada. Comece o check-in de novo.", code: "TOKEN" }, { status: 401 });

  const photo = decodePhoto(body?.photo);
  if (!photo) return NextResponse.json({ error: "Foto inválida. Tire a foto novamente." }, { status: 400 });

  // Antifraude: a selfie precisa ter um rosto e ser da mesma pessoa da foto do cadastro.
  const [selfie, reference] = await Promise.all([analyzeFace(photo.buffer), referenceDescriptor(t.mid)]);
  if (!reference)
    return NextResponse.json(
      { error: "A foto do seu cadastro não mostra um rosto válido. Procure um líder para atualizar seu cadastro.", code: "CADASTRO_SEM_ROSTO" },
      { status: 409 },
    );
  if (!selfie.ok) return NextResponse.json({ error: selfie.message, code: selfie.code }, { status: 422 });

  const distance = faceDistance(selfie.descriptor, reference);
  if (distance > matchThreshold())
    return NextResponse.json(
      {
        error: "O rosto da selfie não confere com a foto do cadastro. Tire outra foto olhando de frente, em um lugar iluminado.",
        code: "ROSTO_NAO_CONFERE",
      },
      { status: 403 },
    );

  const date = serviceDate();
  const path = `checkins/${date}/${t.mid}-${Date.now()}.jpg`;
  const up = await db().storage.from(PHOTO_BUCKET).upload(path, photo.buffer, { contentType: photo.contentType });
  if (up.error) {
    console.error(up.error);
    return NextResponse.json({ error: "Não foi possível enviar a foto. Tente de novo." }, { status: 500 });
  }

  const { data, error } = await db()
    .from("checkins")
    .insert({
      member_id: t.mid,
      service_date: date,
      latitude: t.lat,
      longitude: t.lng,
      accuracy_m: t.acc,
      distance_m: t.dist,
      photo_path: path,
      face_distance: Number(distance.toFixed(4)),
      user_agent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
    })
    .select("id, checked_in_at, members(name, guardian_name, guardian_email)")
    .single();

  if (error) {
    await db().storage.from(PHOTO_BUCKET).remove([path]);
    if (error.code === "23505")
      return NextResponse.json({ error: "Você já fez check-in hoje.", code: "DUPLICADO" }, { status: 409 });
    console.error(error);
    return NextResponse.json({ error: "Erro ao registrar o check-in. Tente de novo." }, { status: 500 });
  }

  const member = (Array.isArray(data.members) ? data.members[0] : data.members) as
    | { name: string; guardian_name: string; guardian_email: string | null }
    | null;

  // Aviso ao responsável depois da resposta: o adolescente não espera o servidor de e-mail.
  after(async () => {
    const status = await sendCheckinEmail(member?.guardian_email, {
      guardianName: member?.guardian_name ?? "",
      teenName: member?.name ?? "",
      checkedInAt: data.checked_in_at,
      photo: photo.buffer,
    });
    await db()
      .from("checkins")
      .update({ guardian_email_status: status, guardian_email_at: new Date().toISOString() })
      .eq("id", data.id);
  });

  return NextResponse.json({ ok: true, name: member?.name ?? "", checkedInAt: data.checked_in_at });
});
