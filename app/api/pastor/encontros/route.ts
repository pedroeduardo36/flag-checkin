import { NextResponse } from "next/server";
import { withErrors } from "@/lib/server/http";
import { db } from "@/lib/server/supabase";
import { adminAudit, requireLeader, unauthorized } from "@/lib/server/leader";
import { serviceDate } from "@/lib/server/security";
import { scheduleDateError, shortServiceDate } from "@/lib/schedule";

export const dynamic = "force-dynamic";

/** POST { date }: a leader schedules a service (an extra one, or the next ones). Check-in opens on that day. */
export const POST = withErrors(async (req: Request) => {
  const s = await requireLeader(req);
  if (!s) return unauthorized();
  const date = String((await req.json().catch(() => null))?.date ?? "");
  const invalid = scheduleDateError(date, serviceDate());
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  const { error } = await db().from("encontros").insert({ service_date: date });
  if (error?.code === "23505") return NextResponse.json({ error: `Já existe encontro em ${shortServiceDate(date)}.` }, { status: 409 });
  if (error) throw error;
  await adminAudit(req, { actor: s.leader, action: "encontro_criado", outcome: "ok", targetType: "encontro", targetId: date, targetLabel: shortServiceDate(date) });
  return NextResponse.json({ ok: true });
});

/** DELETE { date }: unschedules a service from today on, only while it has no check-ins (they would lose their service). */
export const DELETE = withErrors(async (req: Request) => {
  const s = await requireLeader(req);
  if (!s) return unauthorized();
  const date = String((await req.json().catch(() => null))?.date ?? "");
  if (scheduleDateError(date, serviceDate())) return NextResponse.json({ error: "Só dá para remover encontros de hoje em diante." }, { status: 400 });

  const { count, error: countError } = await db().from("checkins").select("id", { count: "exact", head: true }).eq("service_date", date);
  if (countError) throw countError;
  if (count) return NextResponse.json({ error: "Esse encontro já tem check-ins e não pode ser removido." }, { status: 409 });
  const { data, error } = await db().from("encontros").delete().eq("service_date", date).select("service_date");
  if (error) throw error;
  if (!data?.length) return NextResponse.json({ error: "Esse encontro não está na agenda." }, { status: 404 });
  await adminAudit(req, { actor: s.leader, action: "encontro_removido", outcome: "ok", targetType: "encontro", targetId: date, targetLabel: shortServiceDate(date) });
  return NextResponse.json({ ok: true });
});
