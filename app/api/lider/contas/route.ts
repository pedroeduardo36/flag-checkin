import { NextResponse } from "next/server";
import { withErrors } from "@/lib/server/http";
import { db } from "@/lib/server/supabase";
import { isValidEmail, nameTokens } from "@/lib/format";
import { adminAudit, normalizeEmail, requireLeader, resetAccess, revokeSessions, unauthorized } from "@/lib/server/leader";

export const dynamic = "force-dynamic";

/**
 * Leader account administration. Every leader can administer (there are only two kinds of access:
 * teen and leader). Deactivate and reset apply to ANOTHER leader: nobody locks themselves out alone,
 * and recovering a lost phone always goes through a second person.
 */

// GET: list of leaders with their access status and open sessions.
export const GET = withErrors(async (req: Request) => {
  const s = await requireLeader(req);
  if (!s) return unauthorized();

  const [leaders, sessions, codes] = await Promise.all([
    db().from("leaders").select("id, name, email, status, totp_enabled_at, setup_expires_at, created_at, disabled_at, last_login_at").order("name"),
    db().from("leader_sessions").select("id, leader_id, created_at, last_seen_at, user_agent").eq("stage", "completa").is("revoked_at", null).gt("expires_at", new Date().toISOString()),
    db().from("leader_recovery_codes").select("leader_id").is("used_at", null),
  ]);
  if (leaders.error) throw leaders.error;
  if (sessions.error) throw sessions.error;
  if (codes.error) throw codes.error;

  const now = Date.now();
  return NextResponse.json({
    me: { ...s.leader, sessionId: s.id },
    leaders: leaders.data.map((l) => ({
      id: l.id,
      name: l.name,
      email: l.email,
      status: l.status,
      authenticator: !!l.totp_enabled_at,
      pendingActivation: !!l.setup_expires_at && Date.parse(l.setup_expires_at) > now,
      createdAt: l.created_at,
      disabledAt: l.disabled_at,
      lastLoginAt: l.last_login_at,
      activeSessions: sessions.data.filter((x) => x.leader_id === l.id).length,
      recoveryCodesLeft: codes.data.filter((x) => x.leader_id === l.id).length,
    })),
  }, { headers: { "Cache-Control": "no-store" } });
});

// POST { name, email }: creates the account and returns the activation code (shown only once).
export const POST = withErrors(async (req: Request) => {
  const s = await requireLeader(req);
  if (!s) return unauthorized();
  const body = await req.json().catch(() => null);
  const name = String(body?.name ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
  const email = normalizeEmail(body?.email);
  const errors: Record<string, string> = {};
  if (nameTokens(name).length < 2) errors.name = "Informe nome e sobrenome.";
  if (!isValidEmail(email)) errors.email = "E-mail inválido.";
  if (Object.keys(errors).length) return NextResponse.json({ error: "Corrija os campos destacados.", errors }, { status: 400 });

  const { data, error } = await db().from("leaders").insert({ name, email, created_by: s.leader.id }).select("id").single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "Já existe um líder com este e-mail.", errors: { email: "E-mail já cadastrado." } }, { status: 409 });
    throw error;
  }
  const setup = await resetAccess(data.id);
  await adminAudit(req, { actor: s.leader, action: "conta_criada", outcome: "ok", targetType: "lider", targetId: data.id, targetLabel: email, details: { codigo_ativacao_valido_ate: setup.expiresAt } });
  return NextResponse.json({ ok: true, id: data.id, name, email, setupCode: setup.code, expiresAt: setup.expiresAt });
});

type Action = "desativar" | "reativar" | "redefinir" | "revogar_sessoes";
const ACTIONS: Action[] = ["desativar", "reativar", "redefinir", "revogar_sessoes"];

// PATCH { id, action }: desativar | reativar | redefinir (celular perdido) | revogar_sessoes.
export const PATCH = withErrors(async (req: Request) => {
  const s = await requireLeader(req);
  if (!s) return unauthorized();
  const body = await req.json().catch(() => null);
  const action = body?.action as Action;
  if (!ACTIONS.includes(action) || typeof body?.id !== "string") return NextResponse.json({ error: "Ação inválida." }, { status: 400 });

  const { data: t, error } = await db().from("leaders").select("id, name, email, status").eq("id", body.id).maybeSingle();
  if (error) throw error;
  if (!t) return NextResponse.json({ error: "Líder não encontrado." }, { status: 404 });
  const self = t.id === s.leader.id;
  const target = { targetType: "lider" as const, targetId: t.id, targetLabel: t.email };

  if (self && action !== "revogar_sessoes") {
    const auditAction = action === "desativar" ? "conta_desativada" : action === "reativar" ? "conta_reativada" : "acesso_redefinido";
    await adminAudit(req, { actor: s.leader, action: auditAction, outcome: "negado", ...target, details: { motivo: "propria_conta" } });
    return NextResponse.json({ error: "Peça a outro líder para fazer isso na sua conta." }, { status: 403 });
  }

  if (action === "desativar") {
    const up = await db().from("leaders").update({ status: "desativado", disabled_at: new Date().toISOString() }).eq("id", t.id);
    if (up.error) throw up.error;
    const ended = await revokeSessions(t.id);
    await adminAudit(req, { actor: s.leader, action: "conta_desativada", outcome: "ok", ...target, details: { sessoes_encerradas: ended } });
    return NextResponse.json({ ok: true, sessionsEnded: ended });
  }

  if (action === "revogar_sessoes") {
    // On your own account: ends the OTHER devices' sessions and keeps this one.
    const ended = await revokeSessions(t.id, self ? s.id : undefined);
    await adminAudit(req, { actor: s.leader, action: "sessoes_revogadas", outcome: "ok", ...target, details: { sessoes_encerradas: ended, manteve_a_atual: self } });
    return NextResponse.json({ ok: true, sessionsEnded: ended });
  }

  // reactivate or reset: credentials wiped and a new activation code, handed over in person.
  if (action === "reativar") {
    const up = await db().from("leaders").update({ status: "ativo", disabled_at: null }).eq("id", t.id);
    if (up.error) throw up.error;
  }
  const setup = await resetAccess(t.id);
  await adminAudit(req, {
    actor: s.leader, action: action === "reativar" ? "conta_reativada" : "acesso_redefinido", outcome: "ok", ...target,
    details: { senha_autenticador_e_codigos: "apagados", codigo_ativacao_valido_ate: setup.expiresAt },
  });
  return NextResponse.json({ ok: true, setupCode: setup.code, expiresAt: setup.expiresAt });
});
