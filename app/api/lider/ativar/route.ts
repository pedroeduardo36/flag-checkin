import { NextResponse } from "next/server";
import { withErrors } from "@/lib/server/http";
import { db } from "@/lib/server/supabase";
import { ipHash } from "@/lib/server/audit";
import { hashPassword, normalizeCode, passwordProblem, setupCodeHash } from "@/lib/server/credentials";
import { adminAudit, clearAttempts, normalizeEmail, revokeSessions, startSession, tooMany, tooManyAttempts } from "@/lib/server/leader";

export const dynamic = "force-dynamic";

const WINDOW = 15 * 60;

/**
 * Primeiro acesso (ou acesso redefinido): e-mail + código de ativação entregue por outro líder +
 * senha nova. Em seguida, obrigatoriamente, o cadastro do app autenticador.
 */
export const POST = withErrors(async (req: Request) => {
  const body = await req.json().catch(() => null);
  const email = normalizeEmail(body?.email);
  const code = normalizeCode(body?.setupCode);
  const password = String(body?.password ?? "");
  if (!email || code.length !== 12) return NextResponse.json({ error: "Informe o e-mail e o código de ativação de 12 caracteres." }, { status: 400 });
  const problem = passwordProblem(password, email);
  if (problem) return NextResponse.json({ error: problem, errors: { password: problem } }, { status: 400 });

  const ip = ipHash(req) ?? "sem-ip";
  if ((await tooManyAttempts(`ativar:ip:${ip}`, WINDOW, 20)) || (await tooManyAttempts(`ativar:email:${email}`, WINDOW, 5))) {
    await adminAudit(req, { action: "conta_ativada", outcome: "bloqueado", targetType: "lider", targetLabel: email });
    return tooMany();
  }

  const { data: l, error } = await db()
    .from("leaders")
    .select("id, name, email, status, setup_code_hash, setup_expires_at")
    .eq("email", email)
    .maybeSingle();
  if (error) throw error;
  const valid =
    l && l.status === "ativo" && l.setup_code_hash && l.setup_expires_at && Date.parse(l.setup_expires_at) > Date.now();
  // Consome o código com atualização condicional: dois envios simultâneos não ativam duas vezes.
  const consumed = valid
    ? (await db()
        .from("leaders")
        .update({ setup_code_hash: null, setup_expires_at: null, password_hash: await hashPassword(password) })
        .eq("id", l.id)
        .eq("setup_code_hash", setupCodeHash(code))
        .select("id")).data?.length
    : 0;
  if (!l || !consumed) {
    await adminAudit(req, { action: "conta_ativada", outcome: "negado", targetType: "lider", targetId: l?.id, targetLabel: email });
    return NextResponse.json({ error: "E-mail ou código de ativação inválido (ou vencido). Peça um novo a outro líder." }, { status: 401 });
  }

  await revokeSessions(l.id);
  await clearAttempts(`ativar:email:${email}`);
  await adminAudit(req, { actor: l, action: "conta_ativada", outcome: "ok", targetType: "lider", targetId: l.id, targetLabel: email, details: { proxima_etapa: "cadastro_autenticador" } });
  return startSession(req, l.id, "cadastro_totp", { name: l.name });
});
