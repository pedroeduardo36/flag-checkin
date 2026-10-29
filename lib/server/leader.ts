import "server-only";
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "./supabase";
import { ipHash } from "./audit";
import { codeHash, randomCode, setupCodeHash, tokenHash } from "./credentials";

/**
 * Contas de LÍDER: senha + código do app autenticador, sessão guardada no banco.
 * O cookie leva só um valor aleatório; o banco guarda o hash dele. Revogar a sessão ou desativar
 * a conta vale na próxima requisição, em qualquer instância do servidor.
 *
 * Os dois tipos de acesso do app ficam separados: adolescente usa o cookie da visita (o2_visita,
 * só em /api/checkin) e nunca passa por aqui.
 */
export const LEADER_COOKIE = "o2_lider";
export type Stage = "senha" | "cadastro_totp" | "completa";
export type Leader = { id: string; name: string; email: string };
export type LeaderSession = { id: string; stage: Stage; leader: Leader };

/** Etapas intermediárias valem pouco: digitar o código ou cadastrar o autenticador. */
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

/** Cria uma sessão e devolve a resposta com o cookie. Toda troca de etapa gera um valor novo. */
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

/** Sessão válida: não revogada, não vencida e de conta ativa. */
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

/** Acesso a dados privados: só com a verificação em duas etapas concluída. */
export async function requireLeader(req: Request): Promise<LeaderSession | null> {
  const s = await readSession(req);
  return s?.stage === "completa" ? s : null;
}

export const unauthorized = () => NextResponse.json({ error: "Sessão expirada. Entre de novo." }, { status: 401 });

/** Encerra sessões de um líder (todas, ou todas menos uma). Devolve quantas foram encerradas. */
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
 * Limite de tentativas no banco: conta antes de conferir a senha/código, então 50 requisições
 * simultâneas não ganham 50 chances. Funciona igual com várias instâncias do servidor.
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
  | "presenca_removida" | "duplicado_descartado" | "cadastro_mesclado";

/**
 * Registro de ação administrativa ou de autenticação (tabela só de inserção: o banco recusa
 * alterar ou apagar). NUNCA passe senha, código do autenticador, código de recuperação ou
 * dado biométrico em `details`.
 */
export async function adminAudit(
  req: Request,
  e: {
    actor?: Leader | null;
    action: AdminAction;
    outcome: "ok" | "negado" | "bloqueado";
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
  if (error) console.error("Falha ao gravar auditoria administrativa:", error.message);
}

export const normalizeEmail = (v: unknown) => String(v ?? "").trim().toLowerCase().slice(0, 200);

export const SETUP_CODE_HOURS = 24;

/**
 * Ativação ou redefinição do acesso (celular perdido, conta reativada): apaga senha, autenticador
 * e códigos de recuperação, encerra as sessões e gera um código de uso único que vale 24 h.
 * Quem gera é OUTRO líder, que entrega o código pessoalmente: é o processo controlado de recuperação.
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

/** Troca todos os códigos de recuperação do líder por 10 novos (mostrados uma única vez). */
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
