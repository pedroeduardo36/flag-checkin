import { NextResponse } from "next/server";
import { withErrors } from "@/lib/server/http";
import { db } from "@/lib/server/supabase";
import { PHOTO_BUCKET } from "@/lib/server/env";
import { adminAudit, requireLeader, unauthorized } from "@/lib/server/leader";

export const dynamic = "force-dynamic";

/**
 * DELETE { id, reason }: correção de presença. Remove um check-in registrado por engano (e a foto
 * dele), com o motivo. Fica na trilha de auditoria: quem, quando, qual presença e por quê.
 */
export const DELETE = withErrors(async (req: Request) => {
  const s = await requireLeader(req);
  if (!s) return unauthorized();
  const body = await req.json().catch(() => null);
  const reason = String(body?.reason ?? "").trim().replace(/\s+/g, " ").slice(0, 200);
  if (typeof body?.id !== "string") return NextResponse.json({ error: "Check-in inválido." }, { status: 400 });
  if (reason.length < 5) return NextResponse.json({ error: "Escreva o motivo da correção." }, { status: 400 });

  const { data: c, error } = await db()
    .from("checkins")
    .select("id, service_date, photo_path, visitor_name, members(name)")
    .eq("id", body.id)
    .maybeSingle();
  if (error) throw error;
  if (!c) return NextResponse.json({ error: "Check-in não encontrado." }, { status: 404 });

  const m = Array.isArray(c.members) ? c.members[0] : c.members;
  const who = m?.name ?? (c.visitor_name ? `${c.visitor_name} (visitante)` : "—");
  const del = await db().from("checkins").delete().eq("id", c.id);
  if (del.error) throw del.error;
  if (c.photo_path) await db().storage.from(PHOTO_BUCKET).remove([c.photo_path]);

  await adminAudit(req, {
    actor: s.leader, action: "presenca_removida", outcome: "ok", targetType: "checkin", targetId: c.id,
    targetLabel: `${who} · culto de ${c.service_date.split("-").reverse().join("/")}`, details: { motivo: reason },
  });
  return NextResponse.json({ ok: true });
});
