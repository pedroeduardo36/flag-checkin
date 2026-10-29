import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/supabase", () => ({ db: () => ({}) }));
process.env.CHECKIN_SECRET = "f".repeat(64);
const { checkinAllowed, noticeRecipients, verifyTokenHash } = await import("@/lib/server/guardian");

const HOJE = "2026-11-10";
const novo = { guardian_email_verified_at: null, guardian_email2_verified_at: null, biometric_consent_at: null, consent_version: "2026-10-30", verify_by: null };
const confirmado = { ...novo, guardian_email_verified_at: "2026-11-01T10:00:00Z", biometric_consent_at: "2026-11-01T10:00:00Z" };
const antigo = { ...novo, consent_version: null, verify_by: "2026-11-30" };
const emails = { guardian_email: "mae@exemplo.com", guardian_email2: "pai@exemplo.com" };

describe("consentimento do responsável", () => {
  it("cadastro novo só faz check-in depois da confirmação com biometria", () => {
    expect(checkinAllowed(novo, HOJE)).toBe(false);
    expect(checkinAllowed(confirmado, HOJE)).toBe(true);
    expect(checkinAllowed({ ...confirmado, biometric_consent_at: null }, HOJE)).toBe(false);
  });

  it("cadastro antigo tem prazo de transição; depois do prazo, só confirmando", () => {
    expect(checkinAllowed(antigo, HOJE)).toBe(true);
    expect(checkinAllowed(antigo, "2026-11-30")).toBe(true);
    expect(checkinAllowed(antigo, "2026-12-01")).toBe(false);
  });

  it("biometria retirada não volta a ter prazo de transição", () => {
    const retirada = { ...novo, verify_by: "2026-11-17" }; // revokeBiometrics grava a versão atual
    expect(checkinAllowed(retirada, HOJE)).toBe(false);
  });

  it("aviso de check-in só vai para e-mail confirmado", () => {
    expect(noticeRecipients({ ...novo, ...emails }, HOJE)).toEqual([]);
    expect(noticeRecipients({ ...confirmado, ...emails }, HOJE)).toEqual(["mae@exemplo.com"]);
    expect(noticeRecipients({ ...confirmado, ...emails, guardian_email2_verified_at: "2026-11-02T00:00:00Z" }, HOJE)).toEqual(["mae@exemplo.com", "pai@exemplo.com"]);
    expect(noticeRecipients({ ...antigo, ...emails }, HOJE)).toEqual(["mae@exemplo.com", "pai@exemplo.com"]);
    expect(noticeRecipients({ ...antigo, ...emails }, "2026-12-01")).toEqual([]);
  });

  it("o banco guarda só o hash do token do link", () => {
    expect(verifyTokenHash("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyTokenHash("abc")).not.toBe(verifyTokenHash("abd"));
  });
});
