import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/supabase", () => ({ db: () => ({}) }));
process.env.CHECKIN_SECRET = "f".repeat(64);
const { checkinAllowed, noticeRecipients, verifyTokenHash } = await import("@/lib/server/guardian");

const TODAY = "2026-11-10";
const fresh = { guardian_email_verified_at: null, guardian_email2_verified_at: null, biometric_consent_at: null, consent_version: "2026-10-30", verify_by: null };
const confirmed = { ...fresh, guardian_email_verified_at: "2026-11-01T10:00:00Z", biometric_consent_at: "2026-11-01T10:00:00Z" };
const legacy = { ...fresh, consent_version: null, verify_by: "2026-11-30" };
const emails = { guardian_email: "mae@exemplo.com", guardian_email2: "pai@exemplo.com" };

describe("guardian consent", () => {
  it("new registration can only check in after confirmation with biometric consent", () => {
    expect(checkinAllowed(fresh, TODAY)).toBe(false);
    expect(checkinAllowed(confirmed, TODAY)).toBe(true);
    expect(checkinAllowed({ ...confirmed, biometric_consent_at: null }, TODAY)).toBe(false);
  });

  it("legacy registration has a transition period; after it, only with confirmation", () => {
    expect(checkinAllowed(legacy, TODAY)).toBe(true);
    expect(checkinAllowed(legacy, "2026-11-30")).toBe(true);
    expect(checkinAllowed(legacy, "2026-12-01")).toBe(false);
  });

  it("withdrawn biometrics don't get the transition period back", () => {
    const withdrawn = { ...fresh, verify_by: "2026-11-17" }; // revokeBiometrics stores the current version
    expect(checkinAllowed(withdrawn, TODAY)).toBe(false);
  });

  it("check-in notice only goes to confirmed emails", () => {
    expect(noticeRecipients({ ...fresh, ...emails }, TODAY)).toEqual([]);
    expect(noticeRecipients({ ...confirmed, ...emails }, TODAY)).toEqual(["mae@exemplo.com"]);
    expect(noticeRecipients({ ...confirmed, ...emails, guardian_email2_verified_at: "2026-11-02T00:00:00Z" }, TODAY)).toEqual(["mae@exemplo.com", "pai@exemplo.com"]);
    expect(noticeRecipients({ ...legacy, ...emails }, TODAY)).toEqual(["mae@exemplo.com", "pai@exemplo.com"]);
    expect(noticeRecipients({ ...legacy, ...emails }, "2026-12-01")).toEqual([]);
  });

  it("the database only stores the hash of the link token", () => {
    expect(verifyTokenHash("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyTokenHash("abc")).not.toBe(verifyTokenHash("abd"));
  });
});
