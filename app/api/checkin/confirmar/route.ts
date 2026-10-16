import { withErrors } from "@/lib/server/http";
import { NextResponse } from "next/server";
import { db } from "@/lib/server/supabase";
import { PHOTO_BUCKET } from "@/lib/server/env";
import { decodePhoto, readCheckinToken, serviceDate } from "@/lib/server/security";

// Etapa 3: recebe a selfie antifraude e grava o check-in.
export const POST = withErrors(async (req: Request) => {
  const body = await req.json().catch(() => null);
  const t = readCheckinToken(body?.token);
  if (!t) return NextResponse.json({ error: "Sessão expirada. Comece o check-in de novo.", code: "TOKEN" }, { status: 401 });

  const photo = decodePhoto(body?.photo);
  if (!photo) return NextResponse.json({ error: "Foto inválida. Tire a foto novamente." }, { status: 400 });

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
      user_agent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
    })
    .select("checked_in_at, members(name)")
    .single();

  if (error) {
    await db().storage.from(PHOTO_BUCKET).remove([path]);
    if (error.code === "23505")
      return NextResponse.json({ error: "Você já fez check-in hoje.", code: "DUPLICADO" }, { status: 409 });
    console.error(error);
    return NextResponse.json({ error: "Erro ao registrar o check-in. Tente de novo." }, { status: 500 });
  }

  const member = Array.isArray(data.members) ? data.members[0] : data.members;
  return NextResponse.json({ ok: true, name: (member as any)?.name ?? "", checkedInAt: data.checked_in_at });
});
