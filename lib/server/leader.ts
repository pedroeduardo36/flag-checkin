import "server-only";
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "./supabase";
import { ipHash } from "./audit";
import { codeHash, randomCode, setupCodeHash, tokenHash } from "./credentials";

/**
 * LEADER accounts: password + authenticator app code, with the session stored in the database.
 * The cookie only carries a random value; the database stores its hash. Revoking a session or
 * deactivating an account takes effect on the next request, on any server instance.
 *
 * The app's two kinds of access stay apart: teens use the visit cookie (o2_visita, only on
 * /api/checkin) and never go through here.
 *
 * Stage, action and outcome values are stored in the database, so they stay in Portuguese.
 */
export const LEADER_COOKIE = "o2_lider";
export type Stage = "senha" | "cadastro_totp" | "completa";
export type Leader = { id: string; name: string; email: string };
export type LeaderSession = { id: string; stage: Stage; leader: Leader };

/** Intermediate stages are short-lived: entering the code or enrolling the authenticator. */
const TTL_SECONDS: Record<Stage, number> = { senha: 10 * 60, cadastro_totp: 30 * 60, completa: 12 * 3600 };

export const leaderCookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
  maxAge,
});

function readCookie(req: Request): string | null {
  const m = new RegExp(`(?:^|;\\s*)${LEADER_COOKIE}=([^;]+)`).exec(req.headers.get("cookie") ?? "");
  return m ? decodeURIComponent(m[1]) : null;
}

/** Creates a session and returns the response with the cookie. Every stage change issues a new value. */
export async function startSession(req: Request, leaderId: string, stage: Stage, body: Record<string, unknown>) {
  const token = randomBytes(32).toString("base64url");
  const ttl = TTL_SECONDS[stage];
  const { error } = await db().from("leader_sessions").insert({
    leader_id: leaderId,
    token_hash: tokenHash(token),
    stage,
    expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
    ip_hash: ipHash(req),
    user_agent: req.headers.get("user-agent")?.slice(0, 200) ?? null,
  });
  if (error) throw error;
  const res = NextResponse.json({ ok: true, stage, ...body });
  res.cookies.set(LEADER_COOKIE, token, leaderCookieOptions(ttl));
  return res;
}

/** Valid session: not revoked, not expired and belonging to an active account. */
export async function readSession(req: Request): Promise<LeaderSession | null> {
  const token = readCookie(req);
  if (!token || token.length < 40) return null;
  const { data, error } = await db()
    .from("leader_sessions")
    .select("id, stage, expires_at, revoked_at, leaders!inner(id, name, email, status)")
    .eq("token_hash", tokenHash(token))
    .maybeSingle();
  if (error) throw error;
  const l = data && (Array.isArray(data.leaders) ? data.leaders[0] : data.leaders);
  if (!data || !l || data.revoked_at || Date.parse(data.expires_at) <= Date.now() || l.status !== "ativo") return null;
  return { id: data.id, stage: data.stage as Stage, leader: { id: l.id, name: l.name, email: l.email } };
}

/** Access to private data: only once two-step verification is complete. */
export async function requireLeader(req: Request): Promise<LeaderSession | null> {
  const s = await readSession(req);
  return s?.stage === "completa" ? s : null;
}

export const unauthorized = () => NextResponse.json({ error: "Sessão expirada. Entre de novo." }, { status: 401 });

/** Ends a leader's sessions (all of them, or all but one). Returns how many were ended. */
export async function revokeSessions(leaderId: string, exceptSessionId?: string): Promise<number> {
  let q = db()
    .from("leader_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("leader_id", leaderId)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString());
  if (exceptSessionId) q = q.neq("id", exceptSessionId);
  const { data, error } = await q.select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

export async function revokeSession(sessionId: string) {
  const { error } = await db().from("leader_sessions").update({ revoked_at: new Date().toISOString() }).eq("id", sessionId);
  if (error) throw error;
}

/**
 * Attempt limit kept in the database: it counts before checking the password/code, so 50
 * simultaneous requests don't get 50 tries. Works the same across server instances.
 */
export async function tooManyAttempts(key: string, windowSeconds: number, max: number): Promise<boolean> {
  const { data, error } = await db().rpc("auth_rate_hit", { p_key: key, p_window_seconds: windowSeconds });
  if (error) throw error;
  return Number(data) > max;
}

export async function clearAttempts(...keys: string[]) {
  await db().from("auth_rate_limits").delete().in("key", keys);
}

export const tooMany = () =>
  NextResponse.json({ error: "Muitas tentativas. Espere 15 minutos e tente de novo.", code: "MUITAS_TENTATIVAS" }, { status: 429 });

export type AdminAction =
  | "login" | "login_codigo" | "logout"
  | "conta_criada" | "conta_ativada" | "conta_desativada" | "conta_reativada"
  | "acesso_redefinido" | "sessoes_revogadas"
  | "totp_cadastrado" | "recuperacao_usada" | "codigos_recuperacao_gerados"
  | "presenca_removida" | "duplicado_descartado" | "cadastro_mesclado"
  | "consentimento_registrado" | "cadastro_apagado" | "biometria_revogada" | "dados_exportados" | "confirmacao_reenviada"
  | "expurgo_retencao";

/**
 * Logs an admin or authentication action (insert-only table: the database refuses updates and
 * deletes). NEVER put a password, authenticator code, recovery code or biometric data in `details`.
 */
export async function adminAudit(
  req: Request,
  e: {
    actor?: Leader | null;
    action: AdminAction;
    outcome: "ok" | "negado" | "bloqueado" | "erro";
    targetType?: "lider" | "checkin" | "sessao" | "cadastro";
    targetId?: string | null;
    targetLabel?: string | null;
    details?: Record<string, string | number | boolean | null>;
  },
) {
  const { error } = await db().from("admin_audit").insert({
    actor_id: e.actor?.id ?? null,
    actor_name: e.actor?.name ?? null,
    action: e.action,
    target_type: e.targetType ?? null,
    target_id: e.targetId ?? null,
    target_label: e.targetLabel ?? null,
    outcome: e.outcome,
    details: e.details ?? null,
    ip_hash: ipHash(req),
  });
  if (error) console.error("Failed to write admin audit entry:", error.message);
}

export const normalizeEmail = (v: unknown) => String(v ?? "").trim().toLowerCase().slice(0, 200);

export const SETUP_CODE_HOURS = 24;

/**
 * Activates or resets access (lost phone, reactivated account): clears the password, authenticator
 * and recovery codes, ends the sessions and issues a single-use code valid for 24 h. ANOTHER leader
 * issues it and hands it over in person: that is the controlled recovery process.
 */
export async function resetAccess(leaderId: string): Promise<{ code: string; expiresAt: string }> {
  const code = randomCode([4, 4, 4]);
  const expiresAt = new Date(Date.now() + SETUP_CODE_HOURS * 3600_000).toISOString();
  const { error } = await db()
    .from("leaders")
    .update({
      setup_code_hash: setupCodeHash(code),
      setup_expires_at: expiresAt,
      password_hash: null,
      totp_secret_enc: null,
      totp_pending_enc: null,
      totp_enabled_at: null,
      totp_last_step: 0,
    })
    .eq("id", leaderId);
  if (error) throw error;
  await db().from("leader_recovery_codes").delete().eq("leader_id", leaderId);
  await revokeSessions(leaderId);
  return { code, expiresAt };
}

export const RECOVERY_CODE_COUNT = 10;

/** Replaces all of the leader's recovery codes with 10 new ones (shown only once). */
export async function newRecoveryCodes(leaderId: string): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => randomCode([5, 5]));
  const del = await db().from("leader_recovery_codes").delete().eq("leader_id", leaderId);
  if (del.error) throw del.error;
  const { error } = await db()
    .from("leader_recovery_codes")
    .insert(codes.map((c) => ({ leader_id: leaderId, code_hash: codeHash("recuperacao", c) })));
  if (error) throw error;
  return codes;
}
