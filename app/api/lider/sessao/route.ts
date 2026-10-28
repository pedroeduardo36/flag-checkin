import { NextResponse } from "next/server";
import { withErrors } from "@/lib/server/http";
import { LEADER_COOKIE, adminAudit, leaderCookieOptions, readSession, revokeSession } from "@/lib/server/leader";

export const dynamic = "force-dynamic";

// GET: em que etapa está a sessão deste aparelho (nenhuma, senha, cadastro_totp, completa)?
export const GET = withErrors(async (req: Request) => {
  const s = await readSession(req);
  return NextResponse.json(
    s ? { ok: s.stage === "completa", stage: s.stage, leader: s.leader } : { ok: false, stage: null },
    { headers: { "Cache-Control": "no-store" } },
  );
});

// DELETE: sair (a sessão é encerrada no banco, não só apagada do navegador).
export const DELETE = withErrors(async (req: Request) => {
  const s = await readSession(req);
  if (s) {
    await revokeSession(s.id);
    if (s.stage === "completa") await adminAudit(req, { actor: s.leader, action: "logout", outcome: "ok", targetType: "sessao", targetId: s.id });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(LEADER_COOKIE, "", leaderCookieOptions(0));
  res.cookies.set("o2_pastor", "", leaderCookieOptions(0)); // cookie da senha compartilhada antiga
  return res;
});
