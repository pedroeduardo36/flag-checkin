import { NextResponse } from "next/server";
import { withErrors } from "@/lib/server/http";
import { db } from "@/lib/server/supabase";
import { codeHash, normalizeCode, unseal } from "@/lib/server/credentials";
import { verifyTotp } from "@/lib/server/totp";
import {
  LEADER_COOKIE, adminAudit, clearAttempts, leaderCookieOptions, readSession, revokeSession, revokeSessions, startSession, tooMany, tooManyAttempts,
} from "@/lib/server/leader";

export const dynamic = "force-dynamic";

/**
 * Etapa 2 do login: código de 6 dígitos do app autenticador OU um código de recuperação.
 * Código de recuperação = celular perdido: entra, mas o autenticador antigo é apagado, as outras
 * sessões da conta são encerradas e a pessoa cadastra um autenticador novo na hora.
 */
export const POST = withErrors(async (req: Request) => {
  const s = await readSession(req);
  if (!s || s.stage !== "senha") return NextResponse.json({ error: "Comece de novo com e-mail e senha." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const leader = s.leader;
  const keys = [`codigo:${leader.id}`, `codigo-dia:${leader.id}`];
  if ((await tooManyAttempts(keys[0], 15 * 60, 5)) || (await tooManyAttempts(keys[1], 24 * 3600, 20))) {
    await adminAudit(req, { actor: leader, action: "login_codigo", outcome: "bloqueado", targetType: "lider", targetId: leader.id, targetLabel: leader.email });
    await revokeSession(s.id);
    return tooMany();
  }

  // ----- Código de recuperação -----
  if (body?.recoveryCode) {
    if (normalizeCode(body.recoveryCode).length !== 10)
      return NextResponse.json({ error: "Código de recuperação inválido." }, { status: 401 });
    const { data: used } = await db()
      .from("leader_recovery_codes")
      .update({ used_at: new Date().toISOString() })
      .eq("leader_id", leader.id)
      .eq("code_hash", codeHash("recuperacao", body.recoveryCode))
      .is("used_at", null) // atualização condicional: cada código vale UMA vez, mesmo com envios simultâneos
      .select("id");
    if (!used?.length) {
      await adminAudit(req, { actor: leader, action: "recuperacao_usada", outcome: "negado", targetType: "lider", targetId: leader.id, targetLabel: leader.email });
      return NextResponse.json({ error: "Código de recuperação inválido ou já usado." }, { status: 401 });
    }
    const { error } = await db()
      .from("leaders")
      .update({ totp_secret_enc: null, totp_pending_enc: null, totp_enabled_at: null, totp_last_step: 0 })
      .eq("id", leader.id);
    if (error) throw error;
    // O celular perdido pode estar com a área aberta: todas as sessões desta conta caem agora.
    const ended = await revokeSessions(leader.id, s.id);
    await revokeSession(s.id);
    const { count } = await db().from("leader_recovery_codes").select("id", { count: "exact", head: true }).eq("leader_id", leader.id).is("used_at", null);
    await adminAudit(req, {
      actor: leader, action: "recuperacao_usada", outcome: "ok", targetType: "lider", targetId: leader.id, targetLabel: leader.email,
      details: { codigos_restantes: count ?? 0, autenticador_antigo: "apagado", sessoes_encerradas: ended },
    });
    await clearAttempts(...keys);
    return startSession(req, leader.id, "cadastro_totp", { name: leader.name });
  }

  // ----- Código do app autenticador -----
  const { data: l, error } = await db().from("leaders").select("totp_secret_enc, totp_last_step").eq("id", leader.id).single();
  if (error) throw error;
  const secret = unseal(l.totp_secret_enc);
  const step = secret ? verifyTotp(secret, body?.code, Number(l.totp_last_step)) : null;
  // Grava o passo aceito só se ainda for o mais novo: o mesmo código não serve duas vezes.
  const fresh = step != null
    ? (await db().from("leaders").update({ totp_last_step: step, last_login_at: new Date().toISOString() }).eq("id", leader.id).lt("totp_last_step", step).select("id")).data?.length
    : 0;
  if (!fresh) {
    await adminAudit(req, { actor: leader, action: "login_codigo", outcome: "negado", targetType: "lider", targetId: leader.id, targetLabel: leader.email });
    return NextResponse.json({ error: "Código incorreto ou já usado. Confira o app autenticador." }, { status: 401 });
  }

  await adminAudit(req, { actor: leader, action: "login", outcome: "ok", targetType: "lider", targetId: leader.id, targetLabel: leader.email });
  await clearAttempts(...keys);
  await revokeSession(s.id);
  return startSession(req, leader.id, "completa", { name: leader.name });
});

// Desiste no meio do login.
export const DELETE = withErrors(async (req: Request) => {
  const s = await readSession(req);
  if (s) await revokeSession(s.id);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(LEADER_COOKIE, "", leaderCookieOptions(0));
  return res;
});
