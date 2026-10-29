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
 * GET: a visita deste aparelho hoje (para a tela de saída e para reabrir o check-in). Só com a sessão
 * da visita, gravada quando o check-in foi concluído neste aparelho. Sem ela: { visit: null }.
 */
export const GET = withErrors(async (req: Request) => {
  const v = visitFromRequest(req);
  const c = v ? await checkinOfVisit(v) : null;
  if (!c) return NextResponse.json({ visit: null });
  const signed = c.photo_path ? (await db().storage.from(PHOTO_BUCKET).createSignedUrl(c.photo_path, 300)).data : null;
  return NextResponse.json({ visit: view(c, signed?.signedUrl ?? null) });
});

/**
 * POST { lat?, lng?, accuracy? }: confirma a saída com um toque. O horário é o do servidor. A
 * localização é opcional (só a distância é guardada) e não bloqueia: quem já saiu do prédio também
 * pode confirmar. Repetir a confirmação devolve a saída já gravada, sem criar outra.
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
    // Já havia saída (toque repetido, outra aba, ou um líder registrou): mostra a que vale.
    const { data } = await db().from("checkins").select("checked_out_at, checkout_by").eq("id", c.id).single();
    log("repetido");
    return NextResponse.json({ ok: true, alreadyCheckedOut: true, ...view({ ...c, ...data }) });
  }

  after(() => notifyCheckout(c, at, "participante"));
  log("ok");
  return NextResponse.json({ ok: true, alreadyCheckedOut: false, ...view({ ...c, checked_out_at: saved.checked_out_at, checkout_by: "participante" }) });
});
