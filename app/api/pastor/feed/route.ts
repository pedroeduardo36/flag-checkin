import { NextResponse } from "next/server";
import { withErrors } from "@/lib/server/http";
import { db } from "@/lib/server/supabase";
import { PHOTO_BUCKET } from "@/lib/server/env";
import { serviceDate } from "@/lib/server/security";
import { isPastorRequest } from "@/lib/server/pastor";
import { firstName } from "@/lib/format";

export const dynamic = "force-dynamic";

const PHOTO_URL_TTL = 60 * 60; // 1 h

type Row = {
  id: string;
  checked_in_at: string;
  photo_path: string;
  face_distance: number | null;
  guardian_email_status: string | null;
  members: { name: string; photo_path: string } | { name: string; photo_path: string }[] | null;
};

/**
 * GET /api/pastor/feed?date=AAAA-MM-DD&since=ISO
 * Check-ins do dia (mais recentes primeiro). Com "since", só os que chegaram depois — usado no
 * acompanhamento em tempo real, que pergunta a cada poucos segundos.
 */
export const GET = withErrors(async (req: Request) => {
  if (!isPastorRequest(req)) return NextResponse.json({ error: "Sessão expirada. Entre de novo." }, { status: 401 });

  const url = new URL(req.url);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("date") ?? "") ? url.searchParams.get("date")! : serviceDate();
  const since = url.searchParams.get("since");

  let q = db()
    .from("checkins")
    .select("id, checked_in_at, photo_path, face_distance, guardian_email_status, members(name, photo_path)")
    .eq("service_date", date)
    .order("checked_in_at", { ascending: false })
    .limit(300);
  if (since && !Number.isNaN(Date.parse(since))) q = q.gt("checked_in_at", since);

  const [{ data, error }, total] = await Promise.all([
    q,
    db().from("checkins").select("id", { count: "exact", head: true }).eq("service_date", date),
  ]);
  if (error) throw error;

  const rows = (data ?? []) as Row[];
  const member = (r: Row) => (Array.isArray(r.members) ? r.members[0] : r.members);

  // Uma chamada só para assinar todas as fotos (selfie + foto do cadastro).
  const paths = [...new Set(rows.flatMap((r) => [r.photo_path, member(r)?.photo_path].filter(Boolean) as string[]))];
  const signed = paths.length ? (await db().storage.from(PHOTO_BUCKET).createSignedUrls(paths, PHOTO_URL_TTL)).data ?? [] : [];
  const urlOf = new Map(signed.map((s) => [s.path, s.signedUrl]));

  return NextResponse.json({
    date,
    total: total.count ?? rows.length,
    serverTime: new Date().toISOString(),
    items: rows.map((r) => {
      const m = member(r);
      return {
        id: r.id,
        name: m?.name ?? "",
        firstName: firstName(m?.name ?? ""),
        checkedInAt: r.checked_in_at,
        selfieUrl: urlOf.get(r.photo_path) ?? null,
        avatarUrl: m?.photo_path ? urlOf.get(m.photo_path) ?? null : null,
        faceDistance: r.face_distance,
        guardianEmailStatus: r.guardian_email_status,
      };
    }),
  });
});
