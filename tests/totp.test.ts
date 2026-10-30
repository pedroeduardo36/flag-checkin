import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, otpauthUri, totpAt, totpStep, verifyTotp } from "@/lib/server/totp";

// Secret from RFC 6238 appendix B (SHA-1).
const RFC = Buffer.from("12345678901234567890");

describe("authenticator app codes (TOTP)", () => {
  it("matches the official RFC 6238 vectors (last 6 digits)", () => {
    expect(totpAt(RFC, totpStep(59_000))).toBe("287082");
    expect(totpAt(RFC, totpStep(1111111109_000))).toBe("081804");
    expect(totpAt(RFC, totpStep(1234567890_000))).toBe("005924");
    expect(totpAt(RFC, totpStep(2000000000_000))).toBe("279037");
  });

  it("base32 round trip (the format apps read)", () => {
    expect(base32Encode(RFC)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode("gezd gnbv gy3t qojq gezd gnbv gy3t qojq").equals(RFC)).toBe(true);
  });

  it("accepts 30 s of clock drift, no more", () => {
    const now = 1_800_000_000_000;
    const step = totpStep(now);
    expect(verifyTotp(RFC, totpAt(RFC, step), 0, now)).toBe(step);
    expect(verifyTotp(RFC, totpAt(RFC, step - 1), 0, now)).toBe(step - 1);
    expect(verifyTotp(RFC, totpAt(RFC, step + 1), 0, now)).toBe(step + 1);
    expect(verifyTotp(RFC, totpAt(RFC, step - 3), 0, now)).toBeNull();
  });

  it("the same code doesn't work twice", () => {
    const now = 1_800_000_000_000;
    const step = totpStep(now);
    const code = totpAt(RFC, step);
    expect(verifyTotp(RFC, code, step, now)).toBeNull(); // the server already stored this step
    expect(verifyTotp(RFC, totpAt(RFC, step - 1), step, now)).toBeNull(); // nor an earlier one
  });

  it("rejects invalid formats", () => {
    for (const c of ["", "12345", "1234567", "abcdef", null, undefined]) expect(verifyTotp(RFC, c, 0)).toBeNull();
  });

  it("otpauth URI with issuer and account", () => {
    const u = otpauthUri(RFC, "lider@exemplo.com");
    expect(u).toMatch(/^otpauth:\/\/totp\/Flag%20O2%3Alider%40exemplo\.com\?/);
    expect(u).toContain(`secret=${base32Encode(RFC)}`);
    expect(u).toContain("issuer=Flag+O2");
  });
});
