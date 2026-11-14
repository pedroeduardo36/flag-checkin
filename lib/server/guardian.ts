import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db } from "./supabase";
import { flushPhotoDeletions } from "./photo-deletions";
import { serviceDate } from "./security";
import { emailConfigured, sendVerificationEmail } from "./email";

/**
 * Guardian and consent. The registration form is open: whoever fills it in claims to be the guardian,
 * but that proves nothing. So a registration only counts once the OWNER of the email given opens the
 * link, reads the explanation and gives consent, including the specific consent for facial biometrics.
 * Without it the teen can't check in, and the registration is deleted when the period runs out.
 */

/** Version of the consent text (the /privacidade page and the form). Change the text, bump the version. */
export const CONSENT_VERSION = "2026-10-30";
export const VERIFY_TTL_DAYS = 7;

/** The token only exists in the email; the database stores its hash (unkeyed, so the local script can create links production accepts). */
export const verifyTokenHash = (token: string) => createHash("sha256").update(`verificacao:${token}`).digest("hex");

export type ConsentState = {
  guardian_email_verified_at: string | null;
  guardian_email2_verified_at?: string | null;
  biometric_consent_at: string | null;
  consent_version: string | null; // null = legacy consent, from before this version
  verify_by: string | null;
};

/** Legacy registration (consent older than this version) still within the confirmation period. */
const inGrace = (m: ConsentState, today: string) =>
  !m.consent_version && !m.guardian_email_verified_at && !!m.verify_by && today <= m.verify_by;

/** A teen can only check in (and only has their face analyzed) with confirmed consent, or during the transition period. */
export function checkinAllowed(m: ConsentState, today = serviceDate()): boolean {
  return (!!m.guardian_email_verified_at && !!m.biometric_consent_at) || inGrace(m, today);
}

/** Check-in notices only go to confirmed emails (or a legacy registration's, until the deadline). */
export function noticeRecipients(
  m: ConsentState & { guardian_email: string | null; guardian_email2: string | null },
  today = serviceDate(),
): string[] {
  const grace = inGrace(m, today);
  return [
    m.guardian_email_verified_at || grace ? m.guardian_email : null,
    m.guardian_email2_verified_at || grace ? m.guardian_email2 : null,
  ].filter((e): e is string => !!e);
}

/** The app's public URL, for the link in the email. */
export function appUrl(req?: Request): string {
  return (process.env.PUBLIC_APP_URL || (req ? new URL(req.url).origin : "http://localhost:3000")).replace(/\/$/, "");
}

export type MemberForVerification = {
  id: string;
  name: string;
  guardian_name: string | null;
  guardian_email: string | null;
  guardian_email2: string | null;
  guardian_email_verified_at: string | null;
  guardian_email2_verified_at: string | null;
};

/**
 * Creates a single-use link (7 days) for each email not confirmed yet and sends it.
 * Never throws: returns how many emails were sent.
 */
export async function sendVerifications(m: MemberForVerification, baseUrl: string): Promise<number> {
  if (!emailConfigured()) return 0;
  const targets = [
    m.guardian_email && !m.guardian_email_verified_at ? { email: m.guardian_email, primary: true } : null,
    m.guardian_email2 && !m.guardian_email2_verified_at ? { email: m.guardian_email2, primary: false } : null,
  ].filter((t): t is { email: string; primary: boolean } => !!t);
  let sent = 0;
  for (const t of targets) {
    const token = randomBytes(32).toString("base64url");
    const { error } = await db().from("guardian_verifications").insert({
      member_id: m.id,
      email: t.email,
      token_hash: verifyTokenHash(token),
      expires_at: new Date(Date.now() + VERIFY_TTL_DAYS * 86400_000).toISOString(),
    });
    if (error) {
      console.error("Failed to create confirmation link:", error.message);
      continue;
    }
    // The token goes in the fragment (#): it never shows up in server logs or the Referer header.
    const status = await sendVerificationEmail(t.email, {
      guardianName: m.guardian_name ?? "",
      teenName: m.name,
      link: `${baseUrl}/confirmar#t=${token}`,
      primary: t.primary,
      validDays: VERIFY_TTL_DAYS,
    });
    if (status === "enviado") sent++;
  }
  return sent;
}

/** Deletes the whole registration: data, reference photo, face descriptor, attendances and check-in photos. */
export async function deleteMember(id: string): Promise<{ deleted: boolean; photos: number }> {
  // The database deletes the rows and queues the photos in one transaction; the files go right after.
  const { data: photos, error } = await db().rpc("apagar_cadastro", { p_id: id });
  if (error) throw error;
  if (photos === null) return { deleted: false, photos: 0 };
  await flushPhotoDeletions();
  return { deleted: true, photos: photos as number };
}

/**
 * Withdraws biometrics: deletes the reference photo and the descriptor. The registration goes back to
 * "awaiting confirmation": without new consent within 7 days it is deleted. A new link can be resent.
 */
export async function revokeBiometrics(id: string): Promise<boolean> {
  const { data: found, error } = await db().rpc("revogar_biometria", {
    p_id: id,
    p_versao: CONSENT_VERSION,
    p_prazo: serviceDate(new Date(Date.now() + VERIFY_TTL_DAYS * 86400_000)),
  });
  if (error) throw error;
  if (!found) return false;
  await flushPhotoDeletions();
  return true;
}
