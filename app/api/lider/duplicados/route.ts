import { NextResponse } from "next/server";
import { withErrors } from "@/lib/server/http";
import { db } from "@/lib/server/supabase";
import { PHOTO_BUCKET } from "@/lib/server/env";
import { adminAudit, requireLeader, unauthorized } from "@/lib/server/leader";

export const dynamic = "force-dynamic";

/**
 * Possible duplicate registrations (same birth date and a compatible name), for a leader to review.
 * Shows only what's needed to decide: name, birth date, guardian, registration date, attendances,
 * and whether the guardian's email or phone match (without displaying the contacts).
 */

type Row = {
  id: string; name: string; birth_date: string; guardian_name: string; guardian_phone: string | null;
  guardian_email: string | null; guardian_email2: string | null; photo_path: string | null; created_at: string;
  possible_duplicate_of: string | null;
};
const COLS = "id, name, birth_date, guardian_name, guardian_phone, guardian_email, guardian_email2, photo_path, created_at, possible_duplicate_of";

const view = (m: Row, checkins: number) => ({
  id: m.id, name: m.name, birthDate: m.birth_date, guardianName: m.guardian_name,
  createdAt: m.created_at, checkins, hasPhoto: !!m.photo_path,
});

const sameGuardian = (a: Row, b: Row) => {
  const emails = new Set([a.guardian_email, a.guardian_email2].filter(Boolean));
  return (!!a.guardian_phone && a.guardian_phone === b.guardian_phone) || [b.guardian_email, b.guardian_email2].some((e) => !!e && emails.has(e));
};

export const GET = withErrors(async (req: Request) => {
  if (!(await requireLeader(req))) return unauthorized();

  const { data: dups, error } = await db().from("members").select(COLS).not("possible_duplicate_of", "is", null).order("created_at");
  if (error) throw error;
  if (!dups.length) return NextResponse.json({ pairs: [] }, { headers: { "Cache-Control": "no-store" } });

  const originalIds = [...new Set(dups.map((d) => d.possible_duplicate_of as string))];
  const { data: originals, error: oError } = await db().from("members").select(COLS).in("id", originalIds);
  if (oError) throw oError;
  const ids = [...dups.map((d) => d.id), ...originalIds];
  const { data: checkins, error: cError } = await db().from("checkins").select("member_id").in("member_id", ids);
  if (cError) throw cError;
  const count = (id: string) => checkins.filter((c) => c.member_id === id).length;

  const pairs = dups.flatMap((d) => {
    const o = originals.find((x) => x.id === d.possible_duplicate_of);
    if (!o) return [];
    return [{ duplicate: view(d, count(d.id)), original: view(o, count(o.id)), sameGuardian: sameGuardian(d, o) }];
  });
  return NextResponse.json({ pairs }, { headers: { "Cache-Control": "no-store" } });
});

type Action = "pessoas_diferentes" | "mesclar";

// PATCH { id, action }: id is the registration flagged as a duplicate.
// pessoas_diferentes: clears the flag. mesclar: moves attendances and photo to the original and deletes the duplicate.
export const PATCH = withErrors(async (req: Request) => {
  const s = await requireLeader(req);
  if (!s) return unauthorized();
  const body = await req.json().catch(() => null);
  const action = body?.action as Action;
  if (!["pessoas_diferentes", "mesclar"].includes(action) || typeof body?.id !== "string")
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });

  const { data: d, error } = await db().from("members").select("id, name, possible_duplicate_of").eq("id", body.id).maybeSingle();
  if (error) throw error;
  if (!d?.possible_duplicate_of) return NextResponse.json({ error: "Este cadastro não está marcado como duplicado." }, { status: 404 });
  const { data: o } = await db().from("members").select("id, name").eq("id", d.possible_duplicate_of).maybeSingle();
  const label = `${d.name} × ${o?.name ?? "—"}`;

  if (action === "pessoas_diferentes") {
    const upd = await db().from("members").update({ possible_duplicate_of: null }).eq("id", d.id);
    if (upd.error) throw upd.error;
    await adminAudit(req, { actor: s.leader, action: "duplicado_descartado", outcome: "ok", targetType: "cadastro", targetId: d.id, targetLabel: label, details: { original: d.possible_duplicate_of } });
    return NextResponse.json({ ok: true });
  }

  const { data: leftovers, error: mError } = await db().rpc("mesclar_cadastro", { p_duplicado: d.id, p_original: d.possible_duplicate_of });
  if (mError) throw mError;
  const paths = (leftovers as string[] | null) ?? [];
  if (paths.length) await db().storage.from(PHOTO_BUCKET).remove(paths);
  await adminAudit(req, {
    actor: s.leader, action: "cadastro_mesclado", outcome: "ok", targetType: "cadastro", targetId: d.possible_duplicate_of, targetLabel: label,
    details: { cadastro_apagado: d.id, fotos_apagadas: paths.length },
  });
  return NextResponse.json({ ok: true, keptId: d.possible_duplicate_of });
});
