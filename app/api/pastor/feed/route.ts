import { NextResponse } from "next/server";
import { withErrors } from "@/lib/server/http";
import { db } from "@/lib/server/supabase";
import { PHOTO_BUCKET } from "@/lib/server/env";
import { serviceDate } from "@/lib/server/security";
import { requireLeader, unauthorized } from "@/lib/server/leader";
import { firstName } from "@/lib/format";

export const dynamic = "force-dynamic";

const PHOTO_URL_TTL = 60 * 60; // 1 h
const COLUMNS =
  "id, service_date, checked_in_at, checked_out_at, checkout_by, checkout_recorded_at, checkout_email_status, photo_path, photo_kind, is_first, " +
  "face_distance, guardian_email_status, visitor_name, members(name, photo_path)";

type Row = {
  id: string;
  service_date: string;
  checked_in_at: string;
  checked_out_at: string | null;
  checkout_by: "participante" | "lider" | null;
  checkout_recorded_at: string | null;
  checkout_email_status: string | null;
  photo_path: string | null;
  photo_kind: "registro" | "criativa" | null;
  is_first: boolean;
  visitor_name: string | null;
  face_distance: number | null;
  guardian_email_status: string | null;
  members: { name: string; photo_path: string } | { name: string; photo_path: string }[] | null;
};

/**
 * GET /api/pastor/feed?date=AAAA-MM-DD&since=ISO
 * Check-ins do dia (mais recentes primeiro). Com "since", só os que chegaram ou tiveram a saída
 * gravada/desfeita depois — usado no acompanhamento em tempo real, que pergunta a cada poucos segundos.
 * "cursor" é o "since" da próxima pergunta.
 */
export const GET = withErrors(async (req: Request) => {
  if (!(await requireLeader(req))) return unauthorized();

  const url = new URL(req.url);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("date") ?? "") ? url.searchParams.get("date")! : serviceDate();
  const since = url.searchParams.get("since");

  let q = db()
    .from("checkins")
    .select(COLUMNS)
    .eq("service_date", date)
    .order("checked_in_at", { ascending: false })
    .limit(300);
  // Sem converter: o banco guarda microssegundos, e arredondar para milissegundos repetiria o último item.
  const validSince = since && /^[\d\-T:.+Z ]{10,40}$/.test(since) && !Number.isNaN(Date.parse(since)) ? since : null;
  if (validSince) q = q.or(`checked_in_at.gt."${validSince}",checkout_recorded_at.gt."${validSince}"`);

  // Check-ins de exemplo (is_example): vêm só na carga completa, fora do contador do dia.
  const examplesQuery = since
    ? Promise.resolve({ data: [], error: null })
    : db().from("checkins").select(COLUMNS).eq("is_example", true).neq("service_date", date).order("checked_in_at", { ascending: false }).limit(5);

  const [{ data, error }, total, out, ex] = await Promise.all([
    q,
    db().from("checkins").select("id", { count: "exact", head: true }).eq("service_date", date).eq("is_example", false),
    db().from("checkins").select("id", { count: "exact", head: true }).eq("service_date", date).eq("is_example", false).not("checked_out_at", "is", null),
    examplesQuery,
  ]);
  if (error) throw error;
  if (ex.error) throw ex.error;

  const rows = (data ?? []) as unknown as Row[];
  const exampleRows = (ex.data ?? []) as unknown as Row[];
  const member = (r: Row) => (Array.isArray(r.members) ? r.members[0] : r.members);

  // Uma chamada só para assinar todas as fotos (selfie + foto do cadastro).
  const paths = [...new Set([...rows, ...exampleRows].flatMap((r) => [r.photo_path, member(r)?.photo_path].filter(Boolean) as string[]))];
  const signed = paths.length ? (await db().storage.from(PHOTO_BUCKET).createSignedUrls(paths, PHOTO_URL_TTL)).data ?? [] : [];
  const urlOf = new Map(signed.map((s) => [s.path, s.signedUrl]));

  const toItem = (r: Row) => {
    const m = member(r);
    return {
      id: r.id,
      serviceDate: r.service_date,
      name: m?.name ?? r.visitor_name ?? "",
      firstName: firstName(m?.name ?? r.visitor_name ?? ""),
      isVisitor: !m,
      photoKind: r.photo_kind,
      isFirst: r.is_first || r.photo_kind === "registro",
      checkedInAt: r.checked_in_at,
      selfieUrl: r.photo_path ? urlOf.get(r.photo_path) ?? null : null,
      avatarUrl: m?.photo_path ? urlOf.get(m.photo_path) ?? null : null,
      faceDistance: r.face_distance,
      guardianEmailStatus: r.guardian_email_status,
      checkedOutAt: r.checked_out_at,
      checkoutBy: r.checkout_by,
      checkoutEmailStatus: r.checkout_email_status,
    };
  };

  // Próximo "since": o último instante em que algo destes check-ins mudou.
  const cursor = rows
    .flatMap((r) => [r.checked_in_at, r.checkout_recorded_at])
    .filter((t): t is string => !!t)
    .reduce((max, t) => (Date.parse(t) > Date.parse(max) || (Date.parse(t) === Date.parse(max) && t > max) ? t : max), validSince ?? new Date(0).toISOString());

  return NextResponse.json({
    date,
    total: total.count ?? rows.length,
    checkedOut: out.count ?? 0,
    cursor,
    serverTime: new Date().toISOString(),
    items: rows.map(toItem),
    examples: exampleRows.map(toItem),
  });
});
