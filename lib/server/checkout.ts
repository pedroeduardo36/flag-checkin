import "server-only";
import { db } from "./supabase";
import { sendCheckoutEmail } from "./email";
import { noticeRecipients } from "./guardian";
import { serviceDate } from "./security";
import type { Visit } from "./visit";
import type { CheckoutBy } from "@/lib/checkout";

export const VISIT_COLUMNS =
  "id, member_id, service_date, checked_in_at, checked_out_at, checkout_by, photo_path, visitor_name, " +
  "members(name, guardian_name, guardian_email, guardian_email2, guardian_email_verified_at, guardian_email2_verified_at, biometric_consent_at, consent_version, verify_by)";

type Guardian = {
  name: string;
  guardian_name: string | null;
  guardian_email: string | null;
  guardian_email2: string | null;
  guardian_email_verified_at: string | null;
  guardian_email2_verified_at: string | null;
  biometric_consent_at: string | null;
  consent_version: string | null;
  verify_by: string | null;
};

export type VisitCheckin = {
  id: string;
  member_id: string | null;
  service_date: string;
  checked_in_at: string;
  checked_out_at: string | null;
  checkout_by: CheckoutBy | null;
  photo_path: string | null;
  visitor_name: string | null;
  members: Guardian | Guardian[] | null;
};

export const memberOf = (c: VisitCheckin): Guardian | null => (Array.isArray(c.members) ? c.members[0] ?? null : c.members);

/**
 * The check-in proven by this device's visit session. It must belong to the session's service: a
 * check-in that was corrected or moved to another day can't be closed by an old cookie.
 */
export async function checkinOfVisit(v: Visit): Promise<VisitCheckin | null> {
  let q = db().from("checkins").select(VISIT_COLUMNS).eq("service_date", v.date);
  if (v.cid) q = q.eq("id", v.cid);
  else if (v.mid) q = q.eq("member_id", v.mid); // cookie issued before checkout existed
  else return null;
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  const c = data as unknown as VisitCheckin | null;
  if (!c || (v.mid && c.member_id !== v.mid) || (!v.mid && c.member_id)) return null;
  return c;
}

/**
 * Records the checkout ONCE. The update only runs while there is no checkout yet: two simultaneous
 * confirmations (double tap, slow network) record a single one, and the arrival is never touched.
 * Returns the checkout recorded now, or null if one already existed.
 */
export async function recordCheckout(
  checkinId: string,
  e: { at: Date; by: CheckoutBy; leaderId?: string | null; distance?: number | null },
): Promise<{ checked_out_at: string } | null> {
  const { data, error } = await db()
    .from("checkins")
    .update({
      checked_out_at: e.at.toISOString(),
      checkout_by: e.by,
      checkout_leader_id: e.by === "lider" ? e.leaderId ?? null : null,
      checkout_distance_m: e.by === "participante" ? e.distance ?? null : null,
      checkout_recorded_at: new Date().toISOString(),
      checkout_email_status: null,
    })
    .eq("id", checkinId)
    .is("checked_out_at", null)
    .select("checked_out_at")
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Undoes a checkout (leader correction). Only the checkout is cleared; the attendance stays. */
export async function undoCheckout(checkinId: string) {
  const { data, error } = await db()
    .from("checkins")
    .update({
      checked_out_at: null, checkout_by: null, checkout_leader_id: null, checkout_distance_m: null,
      checkout_email_status: null, checkout_recorded_at: new Date().toISOString(),
    })
    .eq("id", checkinId)
    .not("checked_out_at", "is", null)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

/**
 * Checkout notice to the guardian (text only, confirmed emails only), like the arrival notice. Visitors
 * have no registered guardian. A leader correction made on another day sends nothing: it would arrive too late.
 */
export async function notifyCheckout(c: VisitCheckin, at: Date, by: CheckoutBy) {
  const m = memberOf(c);
  if (!m) return;
  if (by === "lider" && c.service_date !== serviceDate()) return;
  const status = await sendCheckoutEmail(noticeRecipients(m), { guardianName: m.guardian_name ?? "", teenName: m.name, checkedOutAt: at, by });
  await db().from("checkins").update({ checkout_email_status: status }).eq("id", c.id).not("checked_out_at", "is", null);
}
