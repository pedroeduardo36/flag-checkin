import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { withErrors } from "@/lib/server/http";
import { db } from "@/lib/server/supabase";
import { seal, unseal } from "@/lib/server/credentials";
import { base32Encode, newTotpSecret, otpauthUri, verifyTotp } from "@/lib/server/totp";
import { adminAudit, clearAttempts, newRecoveryCodes, readSession, revokeSession, startSession, tooMany, tooManyAttempts } from "@/lib/server/leader";

export const dynamic = "force-dynamic";

/** Cadastro obrigatório do app autenticador. Só na etapa "cadastro_totp" (após ativação ou recuperação). */
async function enrolling(req: Request) {
  const s = await readSession(req);
  return s?.stage === "cadastro_totp" ? s : null;
}

// GET: QR code e chave para o app autenticador. A chave fica guardada (cifrada) até o 1º código conferir.
export const GET = withErrors(async (req: Request) => {
  const s = await enrolling(req);
  if (!s) return NextResponse.json({ error: "Sessão expirada. Entre de novo." }, { status: 401 });

  const { data: l, error } = await db().from("leaders").select("totp_pending_enc").eq("id", s.leader.id).single();
  if (error) throw error;
  let secret = unseal(l.totp_pending_enc);
  if (!secret) {
    secret = newTotpSecret();
    const up = await db().from("leaders").update({ totp_pending_enc: seal(secret) }).eq("id", s.leader.id);
    if (up.error) throw up.error;
  }
  const uri = otpauthUri(secret, s.leader.email);
  return NextResponse.json(
    { name: s.leader.name, email: s.leader.email, qr: await QRCode.toDataURL(uri, { margin: 1, width: 240 }), uri, secret: base32Encode(secret).match(/.{1,4}/g)!.join(" ") },
    { headers: { "Cache-Control": "no-store" } },
  );
});

// POST { code }: confirma o primeiro código, liga o autenticador e devolve os códigos de recuperação (uma vez só).
export const POST = withErrors(async (req: Request) => {
  const s = await enrolling(req);
  if (!s) return NextResponse.json({ error: "Sessão expirada. Entre de novo." }, { status: 401 });
  const key = `cadastro:${s.leader.id}`;
  if (await tooManyAttempts(key, 15 * 60, 8)) return tooMany();

  const body = await req.json().catch(() => null);
  const { data: l, error } = await db().from("leaders").select("totp_pending_enc").eq("id", s.leader.id).single();
  if (error) throw error;
  const secret = unseal(l.totp_pending_enc);
  const step = secret ? verifyTotp(secret, body?.code, 0) : null;
  if (!secret || step == null)
    return NextResponse.json({ error: "Código incorreto. Confira se o relógio do celular está no automático." }, { status: 400 });

  const up = await db()
    .from("leaders")
    .update({ totp_secret_enc: l.totp_pending_enc, totp_pending_enc: null, totp_enabled_at: new Date().toISOString(), totp_last_step: step, last_login_at: new Date().toISOString() })
    .eq("id", s.leader.id);
  if (up.error) throw up.error;
  const recoveryCodes = await newRecoveryCodes(s.leader.id);

  await adminAudit(req, { actor: s.leader, action: "totp_cadastrado", outcome: "ok", targetType: "lider", targetId: s.leader.id, targetLabel: s.leader.email, details: { codigos_recuperacao: recoveryCodes.length } });
  await clearAttempts(key);
  await revokeSession(s.id);
  return startSession(req, s.leader.id, "completa", { name: s.leader.name, recoveryCodes });
});
