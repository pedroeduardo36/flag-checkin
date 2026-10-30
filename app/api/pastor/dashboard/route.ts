import { NextResponse } from "next/server";
import { withErrors } from "@/lib/server/http";
import { db } from "@/lib/server/supabase";
import { PHOTO_BUCKET } from "@/lib/server/env";
import { requireLeader, unauthorized } from "@/lib/server/leader";
import { buildDashboard, type CheckinRow } from "@/lib/stats";

export const dynamic = "force-dynamic";

/** Every check-in (only the columns the calculation needs), in pages of 1000. */
async function allCheckins(): Promise<CheckinRow[]> {
  const out: CheckinRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db()
      .from("checkins")
      .select("service_date, member_id, visitor_phone")
      .order("service_date")
      .range(from, from + 999);
    if (error) throw error;
    out.push(...(data as CheckinRow[]));
    if (!data || data.length < 1000) return out;
  }
}

// GET /api/pastor/dashboard → KPIs, per-service trend and attendance ranking.
export const GET = withErrors(async (req: Request) => {
  if (!(await requireLeader(req))) return unauthorized();

  const dash = buildDashboard(await allCheckins());

  // Registration name and photo only for people in the ranking.
  const ids = dash.ranking.map((r) => r.memberId);
  const { data: members } = ids.length
    ? await db().from("members").select("id, name, photo_path").in("id", ids)
    : { data: [] as { id: string; name: string; photo_path: string | null }[] };
  const paths = (members ?? []).map((m) => m.photo_path).filter(Boolean) as string[];
  const signed = paths.length ? (await db().storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600)).data ?? [] : [];
  const urlOf = new Map(signed.map((s) => [s.path, s.signedUrl]));
  const info = new Map((members ?? []).map((m) => [m.id, m]));

  return NextResponse.json({
    ...dash,
    ranking: dash.ranking.map((r) => {
      const m = info.get(r.memberId);
      return { ...r, name: m?.name ?? "—", avatarUrl: m?.photo_path ? urlOf.get(m.photo_path) ?? null : null };
    }),
  });
});
