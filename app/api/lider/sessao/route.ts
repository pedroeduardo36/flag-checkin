import { NextResponse } from "next/server";
import { withErrors } from "@/lib/server/http";
import { LEADER_COOKIE, adminAudit, leaderCookieOptions, readSession, revokeSession } from "@/lib/server/leader";

export const dynamic = "force-dynamic";

// GET: which stage is this device's session at (none, senha, cadastro_totp, completa)?
export const GET = withErrors(async (req: Request) => {
  const s = await readSession(req);
  return NextResponse.json(
    s ? { ok: s.stage === "completa", stage: s.stage, leader: s.leader } : { ok: false, stage: null },
    { headers: { "Cache-Control": "no-store" } },
  );
});

// DELETE: sign out (the session is ended in the database, not just deleted from the browser).
export const DELETE = withErrors(async (req: Request) => {
  const s = await readSession(req);
  if (s) {
    await revokeSession(s.id);
    if (s.stage === "completa") await adminAudit(req, { actor: s.leader, action: "logout", outcome: "ok", targetType: "sessao", targetId: s.id });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(LEADER_COOKIE, "", leaderCookieOptions(0));
  res.cookies.set("o2_pastor", "", leaderCookieOptions(0)); // cookie from the old shared password
  return res;
});
