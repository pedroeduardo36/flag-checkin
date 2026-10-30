import { withErrors } from "@/lib/server/http";
import { NextResponse, after } from "next/server";
import { db } from "@/lib/server/supabase";
import { PHOTO_BUCKET } from "@/lib/server/env";
import { checkGeofence, parseCoords } from "@/lib/server/security";
import { visitFromRequest } from "@/lib/server/visit";
import { audit } from "@/lib/server/audit";
import { checkinOfVisit, memberOf, notifyCheckout, recordCheckout, type VisitCheckin } from "@/lib/server/checkout";
import { firstName } from "@/lib/format";

export const dynamic = "force-dynamic";

const NO_VISIT = {
  error: "Não encontramos um check-in de hoje neste celular. Abra no mesmo navegador em que você fez o check-in, ou procure um líder.",
  code: "SEM_VISITA",
};

const view = (c: VisitCheckin, photoUrl: string | null = null) => {
  const name = memberOf(c)?.name ?? c.visitor_name ?? "";
  return {
    name,
    firstName: firstName(name),
    isVisitor: !c.member_id,
    checkedInAt: c.checked_in_at,
    checkedOutAt: c.checked_out_at,
    checkoutBy: c.checkout_by,
    photoUrl,
  };
};

/**
 * GET: this device's visit today (for the checkout screen and for reopening the check-in). Only with the
 * visit session, stored when the check-in was completed on this device. Without it: { visit: null }.
 */
export const GET = withErrors(async (req: Request) => {
  const v = visitFromRequest(req);
  const c = v ? await checkinOfVisit(v) : null;
  if (!c) return NextResponse.json({ visit: null });
  const signed = c.photo_path ? (await db().storage.from(PHOTO_BUCKET).createSignedUrl(c.photo_path, 300)).data : null;
  return NextResponse.json({ visit: view(c, signed?.signedUrl ?? null) });
});

/**
 * POST { lat?, lng?, accuracy? }: confirms the checkout with one tap. The time is the server's. Location
 * is optional (only the distance is stored) and never blocks: someone who already left the building can
 * still confirm. Repeating the confirmation returns the checkout already recorded instead of creating another.
 */
export const POST = withErrors(async (req: Request) => {
  const v = visitFromRequest(req);
  const c = v ? await checkinOfVisit(v) : null;
  const body = await req.json().catch(() => null);
  const coords = parseCoords(body);
  const distance = coords ? checkGeofence(coords).distance : null;
  const log = (outcome: string) => audit(req, { event: "checkout", outcome, memberId: c?.member_id ?? v?.mid ?? null, distance });
  if (!c) return log("SEM_VISITA"), NextResponse.json(NO_VISIT, { status: 401 });

  const at = new Date();
  const saved = await recordCheckout(c.id, { at, by: "participante", distance });
  if (!saved) {
    // A checkout already existed (repeated tap, another tab, or a leader recorded it): show the one that counts.
    const { data } = await db().from("checkins").select("checked_out_at, checkout_by").eq("id", c.id).single();
    log("repetido");
    return NextResponse.json({ ok: true, alreadyCheckedOut: true, ...view({ ...c, ...data }) });
  }

  after(() => notifyCheckout(c, at, "participante"));
  log("ok");
  return NextResponse.json({ ok: true, alreadyCheckedOut: false, ...view({ ...c, checked_out_at: saved.checked_out_at, checkout_by: "participante" }) });
});
