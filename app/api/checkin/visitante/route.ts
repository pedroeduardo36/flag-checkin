import { randomUUID } from "node:crypto";
import { withErrors } from "@/lib/server/http";
import { NextResponse } from "next/server";
import { db } from "@/lib/server/supabase";
import { PHOTO_BUCKET } from "@/lib/server/env";
import { checkGeofence, decodePhoto, parseCoords, serviceDate } from "@/lib/server/security";
import { isValidPhone, nameTokens, onlyDigits } from "@/lib/format";
import { VISIT_COOKIE, createVisitSession, visitCookieOptions } from "@/lib/server/visit";

// Visitor check-in: only name and phone; the creative photo is optional.
export const POST = withErrors(async (req: Request) => {
  const body = await req.json().catch(() => null);
  const coords = parseCoords(body);
  const name = String(body?.name ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
  const phone = onlyDigits(body?.phone);

  const geo = checkGeofence(coords);
  if (!coords && !geo.disabled)
    return NextResponse.json({ error: "Localização ausente. Volte e ative a localização." }, { status: 400 });
  const errors: Record<string, string> = {};
  if (nameTokens(name).length < 2) errors.name = "Informe nome e sobrenome.";
  if (!isValidPhone(phone)) errors.phone = "Telefone inválido.";
  const photo = body?.photo ? decodePhoto(body.photo) : null;
  if (body?.photo && !photo) errors.photo = "Foto inválida. Tire outra ou continue sem foto.";
  if (Object.keys(errors).length) return NextResponse.json({ error: "Confira os dados.", errors }, { status: 400 });
  if (!geo.inside)
    return NextResponse.json({ error: "Você precisa estar no local do culto para fazer o check-in.", code: "FORA_DO_LOCAL" }, { status: 403 });

  const date = serviceDate();
  const { data: existing } = await db()
    .from("checkins")
    .select("checked_in_at")
    .is("member_id", null)
    .eq("visitor_phone", phone)
    .eq("service_date", date)
    .maybeSingle();
  if (existing) return NextResponse.json({ ok: true, alreadyCheckedIn: true, name, checkedInAt: existing.checked_in_at });

  let path: string | null = null;
  if (photo) {
    path = `checkins/${date}/visitante-${randomUUID()}.jpg`; // no phone number in the file name
    const up = await db().storage.from(PHOTO_BUCKET).upload(path, photo.buffer, { contentType: photo.contentType });
    if (up.error) throw up.error;
  }

  const { data, error } = await db()
    .from("checkins")
    .insert({
      member_id: null,
      visitor_name: name,
      visitor_phone: phone,
      service_date: date,
      accuracy_m: coords?.accuracy ?? null,
      distance_m: geo.distance,
      photo_path: path,
      photo_kind: path ? "criativa" : null,
      guardian_email_status: "sem_email",
      user_agent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
    })
    .select("id, checked_in_at")
    .single();
  if (error) {
    if (path) await db().storage.from(PHOTO_BUCKET).remove([path]);
    if (error.code === "23505") return NextResponse.json({ ok: true, alreadyCheckedIn: true, name }, { status: 200 });
    throw error;
  }
  // Visit session: only this device confirms this visitor's checkout. Repeating name and phone on
  // another device ("already checked in" above) doesn't grant the session: knowing the phone number doesn't close someone's visit.
  const visit = createVisitSession(null, date, Date.now(), data.id);
  const res = NextResponse.json({ ok: true, alreadyCheckedIn: false, name, checkedInAt: data.checked_in_at });
  res.cookies.set(VISIT_COOKIE, visit.value, visitCookieOptions(visit.maxAge));
  return res;
});
