import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { withErrors } from "@/lib/server/http";
import { runRetention } from "@/lib/server/retention";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Vercel Cron (vercel.json): daily, with "Authorization: Bearer $CRON_SECRET". Without CRON_SECRET nothing runs. */
export const GET = withErrors(async (req: Request) => {
  const secret = process.env.CRON_SECRET;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (!secret || got.length !== want.length || !timingSafeEqual(got, want))
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  return NextResponse.json(await runRetention(false));
});
