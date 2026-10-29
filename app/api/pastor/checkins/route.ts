import { NextResponse, after } from "next/server";
import { withErrors } from "@/lib/server/http";
import { db } from "@/lib/server/supabase";
import { PHOTO_BUCKET } from "@/lib/server/env";
import { adminAudit, requireLeader, unauthorized } from "@/lib/server/leader";
import { VISIT_COLUMNS, memberOf, notifyCheckout, recordCheckout, undoCheckout, type VisitCheckin } from "@/lib/server/checkout";
import { leaderCheckoutTime } from "@/lib/checkout";

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

const ddmmyyyy = (d: string) => d.split("-").reverse().join("/");
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

/**
 * PATCH { id, action, reason, time? }: correção da SAÍDA, com motivo e registro de ações.
 * - "registrar_saida" + time ("HH:MM"): o adolescente esqueceu de confirmar. Marca a saída como
 *   registrada por um líder. Não sobrescreve uma saída que já existe (desfaça antes).
 * - "desfazer_saida": saída confirmada por engano (ou o adolescente voltou). A presença continua.
 */
export const PATCH = withErrors(async (req: Request) => {
  const s = await requireLeader(req);
  if (!s) return unauthorized();
  const body = await req.json().catch(() => null);
  const action = body?.action;
  const reason = String(body?.reason ?? "").trim().replace(/\s+/g, " ").slice(0, 200);
  if (typeof body?.id !== "string" || (action !== "registrar_saida" && action !== "desfazer_saida"))
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  if (reason.length < 5) return NextResponse.json({ error: "Escreva o motivo da correção." }, { status: 400 });

  const { data, error } = await db().from("checkins").select(VISIT_COLUMNS).eq("id", body.id).maybeSingle();
  if (error) throw error;
  const c = data as unknown as VisitCheckin | null;
  if (!c) return NextResponse.json({ error: "Check-in não encontrado." }, { status: 404 });
  const who = memberOf(c)?.name ?? (c.visitor_name ? `${c.visitor_name} (visitante)` : "—");
  const label = `${who} · culto de ${ddmmyyyy(c.service_date)}`;

  if (action === "desfazer_saida") {
    if (!c.checked_out_at) return NextResponse.json({ error: "Esta presença não tem saída registrada." }, { status: 409 });
    if (!(await undoCheckout(c.id))) return NextResponse.json({ error: "A saída já tinha sido desfeita." }, { status: 409 });
    await adminAudit(req, {
      actor: s.leader, action: "saida_desfeita", outcome: "ok", targetType: "checkin", targetId: c.id, targetLabel: label,
      details: { motivo: reason, saida_anterior: c.checked_out_at, confirmada_por: c.checkout_by },
    });
    return NextResponse.json({ ok: true, checkedOutAt: null, checkoutBy: null });
  }

  if (c.checked_out_at)
    return NextResponse.json({ error: `A saída já foi registrada às ${hhmm(c.checked_out_at)}. Para mudar, desfaça antes.`, code: "JA_SAIU" }, { status: 409 });
  const t = leaderCheckoutTime(c.service_date, body?.time, c.checked_in_at);
  if ("error" in t) return NextResponse.json({ error: t.error }, { status: 400 });
  const saved = await recordCheckout(c.id, { at: t.at, by: "lider", leaderId: s.leader.id });
  if (!saved) return NextResponse.json({ error: "A saída acabou de ser registrada por outra pessoa. Atualize a lista.", code: "JA_SAIU" }, { status: 409 });
  await adminAudit(req, {
    actor: s.leader, action: "saida_registrada", outcome: "ok", targetType: "checkin", targetId: c.id, targetLabel: label,
    details: { motivo: reason, saida: saved.checked_out_at },
  });
  after(() => notifyCheckout(c, t.at, "lider"));
  return NextResponse.json({ ok: true, checkedOutAt: saved.checked_out_at, checkoutBy: "lider" });
});
