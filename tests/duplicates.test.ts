import { describe, expect, it } from "vitest";
import { findDuplicate } from "@/lib/duplicates";

const incoming = { name: "Ana Beatriz de Souza", guardian_email: "mae@example.com", guardian_email2: null };
const existing = (over: Partial<{ id: string; name: string; guardian_email: string | null; guardian_email2: string | null }> = {}) => ({
  id: "m1", name: "Ana Beatriz Souza", guardian_email: "pai@example.com", guardian_email2: null, ...over,
});

describe("possible duplicate registrations (without CPF)", () => {
  it("a compatible name with the same birth date is flagged for review", () => {
    expect(findDuplicate(incoming, [existing()])).toEqual({ id: "m1", resubmission: false });
    expect(findDuplicate({ ...incoming, name: "Ana Souza" }, [existing()])).toEqual({ id: "m1", resubmission: false });
  });

  it("same name and same guardian email is a resubmission, not a new registration", () => {
    expect(findDuplicate(incoming, [existing({ guardian_email: "mae@example.com" })])).toEqual({ id: "m1", resubmission: true });
    expect(findDuplicate(incoming, [existing({ guardian_email2: "mae@example.com" })])).toEqual({ id: "m1", resubmission: true });
  });

  it("a similar name with the same email still goes to review (could be a sibling)", () => {
    expect(findDuplicate({ ...incoming, name: "Ana Souza" }, [existing({ guardian_email: "mae@example.com" })])).toEqual({ id: "m1", resubmission: false });
  });

  it("a different name is not a duplicate", () => {
    expect(findDuplicate({ ...incoming, name: "Bruno Lima" }, [existing()])).toBeNull();
    expect(findDuplicate(incoming, [])).toBeNull();
  });

  it("picks the most similar registration", () => {
    const r = findDuplicate(incoming, [existing({ id: "m1", name: "Ana Beatriz Souza Lima" }), existing({ id: "m2" })]);
    expect(r?.id).toBe("m2");
  });
});
