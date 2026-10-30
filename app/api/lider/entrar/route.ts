import { NextResponse } from "next/server";
import { withErrors } from "@/lib/server/http";
import { db } from "@/lib/server/supabase";
import { ipHash } from "@/lib/server/audit";
import { verifyPassword } from "@/lib/server/credentials";
import { adminAudit, clearAttempts, normalizeEmail, startSession, tooMany, tooManyAttempts } from "@/lib/server/leader";

export const dynamic = "force-dynamic";

const WINDOW = 15 * 60;

// Login step 1: email + password. Only unlocks the authenticator code step (10 min).
export const POST = withErrors(async (req: Request) => {
  const body = await req.json().catch(() => null);
  const email = normalizeEmail(body?.email);
  const password = String(body?.password ?? "").slice(0, 200);
  if (!email || !password) return NextResponse.json({ error: "Informe e-mail e senha." }, { status: 400 });

  // Count the attempt BEFORE checking: per account and per network.
  const ip = ipHash(req) ?? "sem-ip";
  if ((await tooManyAttempts(`entrar:ip:${ip}`, WINDOW, 30)) || (await tooManyAttempts(`entrar:email:${email}`, WINDOW, 8))) {
    await adminAudit(req, { action: "login", outcome: "bloqueado", targetType: "lider", targetLabel: email, details: { etapa: "senha" } });
    return tooMany();
  }

  const { data: l, error } = await db()
    .from("leaders")
    .select("id, name, email, password_hash, status, totp_enabled_at")
    .eq("email", email)
    .maybeSingle();
  if (error) throw error;

  const ok = await verifyPassword(password, l?.password_hash);
  if (!l || !ok || l.status !== "ativo") {
    const motivo = !l ? "conta_inexistente" : !ok ? "senha_errada" : "conta_desativada";
    await adminAudit(req, { action: "login", outcome: "negado", targetType: "lider", targetId: l?.id, targetLabel: email, details: { etapa: "senha", motivo } });
    return NextResponse.json({ error: "E-mail ou senha incorretos." }, { status: 401 });
  }
  // Right password but the authenticator was never enrolled: activation was left halfway.
  // A password alone can't enroll a new authenticator; another leader issues an activation code.
  if (!l.totp_enabled_at) {
    await adminAudit(req, { action: "login", outcome: "negado", targetType: "lider", targetId: l.id, targetLabel: email, details: { etapa: "senha", motivo: "sem_autenticador" } });
    return NextResponse.json(
      { error: "Sua conta ainda não tem o app autenticador cadastrado. Peça a outro líder um novo código de ativação.", code: "SEM_AUTENTICADOR" },
      { status: 403 },
    );
  }

  await clearAttempts(`entrar:email:${email}`);
  return startSession(req, l.id, "senha", { name: l.name });
});
