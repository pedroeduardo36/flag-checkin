import { NextResponse } from "next/server";
import { withErrors } from "@/lib/server/http";
import { db } from "@/lib/server/supabase";
import { unseal } from "@/lib/server/credentials";
import { verifyTotp } from "@/lib/server/totp";
import { adminAudit, newRecoveryCodes, requireLeader, tooMany, tooManyAttempts, unauthorized } from "@/lib/server/leader";

export const dynamic = "force-dynamic";

// POST { code }: gera 10 códigos de recuperação novos (os antigos deixam de valer). Pede o código atual do autenticador.
export const POST = withErrors(async (req: Request) => {
  const s = await requireLeader(req);
  if (!s) return unauthorized();
  if (await tooManyAttempts(`codigo:${s.leader.id}`, 15 * 60, 5)) return tooMany();

  const body = await req.json().catch(() => null);
  const { data: l, error } = await db().from("leaders").select("totp_secret_enc, totp_last_step").eq("id", s.leader.id).single();
  if (error) throw error;
  const secret = unseal(l.totp_secret_enc);
  const step = secret ? verifyTotp(secret, body?.code, Number(l.totp_last_step)) : null;
  const fresh = step != null
    ? (await db().from("leaders").update({ totp_last_step: step }).eq("id", s.leader.id).lt("totp_last_step", step).select("id")).data?.length
    : 0;
  if (!fresh) {
    await adminAudit(req, { actor: s.leader, action: "codigos_recuperacao_gerados", outcome: "negado", targetType: "lider", targetId: s.leader.id, targetLabel: s.leader.email });
    return NextResponse.json({ error: "Código do autenticador incorreto ou já usado." }, { status: 400 });
  }
  const recoveryCodes = await newRecoveryCodes(s.leader.id);
  await adminAudit(req, { actor: s.leader, action: "codigos_recuperacao_gerados", outcome: "ok", targetType: "lider", targetId: s.leader.id, targetLabel: s.leader.email, details: { quantidade: recoveryCodes.length } });
  return NextResponse.json({ ok: true, recoveryCodes });
});
