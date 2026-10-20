import { NextResponse } from "next/server";
import { withErrors } from "@/lib/server/http";
import { PASTOR_COOKIE, checkPastorPassword, cookieOptions, createPastorSession, isPastorRequest } from "@/lib/server/pastor";

export const dynamic = "force-dynamic";

// GET: a sessão ainda vale?
export const GET = withErrors(async (req: Request) => NextResponse.json({ ok: isPastorRequest(req) }));

// POST { password }: entra na área do pastor.
export const POST = withErrors(async (req: Request) => {
  const body = await req.json().catch(() => null);
  if (!checkPastorPassword(body?.password)) {
    await new Promise((r) => setTimeout(r, 800)); // freia tentativas em sequência
    return NextResponse.json({ error: "Senha incorreta." }, { status: 401 });
  }
  const s = createPastorSession();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(PASTOR_COOKIE, s.value, cookieOptions(s.maxAge));
  return res;
});

// DELETE: sai.
export const DELETE = withErrors(async () => {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(PASTOR_COOKIE, "", cookieOptions(0));
  return res;
});
