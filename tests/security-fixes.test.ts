import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.CHECKIN_SECRET = "f".repeat(64);

// Registration route against an in-memory members table; rate limits and email are swapped out.
const members: Record<string, unknown>[] = [];
const inserted: Record<string, unknown>[] = [];
vi.mock("@/lib/server/rate-limit", () => ({ limited: async () => false, slowDown: () => new Response("{}", { status: 429 }) }));
vi.mock("@/lib/server/email", () => ({ emailConfigured: () => true, senderAddress: () => "o2@example.com", sendRegistrationEmail: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/lib/server/supabase", () => ({
  db: () => ({
    from: () => ({
      select: () => ({ eq: async (_c: string, d: string) => ({ data: members.filter((m) => m.birth_date === d), error: null }) }),
      insert: async (row: Record<string, unknown>) => (inserted.push(row), { error: null }),
    }),
  }),
}));
const { serviceCode, serviceCodeMatches } = await import("@/lib/server/service-code");
const registration = await import("@/app/api/cadastro/route");

const form = (over: Record<string, unknown> = {}) => ({
  name: "Ana Clara Souza", cpf: "52998224725", birthDate: "2011-03-04", guardianName: "Maria Souza", guardianPhone: "61988880000",
  guardianEmail: "maria@example.com", consent: true, ...over,
});
const register = async (body: Record<string, unknown>) => {
  const r = await registration.POST(new Request("http://x/api/cadastro", { method: "POST", body: JSON.stringify(body) }));
  return { status: r.status, data: await r.json() };
};

beforeEach(() => {
  members.length = 0;
  inserted.length = 0;
});

describe("code of the day for the first check-in", () => {
  it("6 digits, one per service day, accepted with the space leaders read aloud", () => {
    const code = serviceCode("2026-11-20");
    expect(code).toMatch(/^\d{6}$/);
    expect(serviceCode("2026-11-28")).not.toBe(code);
    expect(serviceCodeMatches("2026-11-20", `${code.slice(0, 3)} ${code.slice(3)}`)).toBe(true);
    expect(serviceCodeMatches("2026-11-28", code)).toBe(false);
    expect(serviceCodeMatches("2026-11-20", undefined)).toBe(false);
  });
});

describe("registration with the same name and birth date", () => {
  it("another family can't register a second Ana Clara Souza born on the same day", async () => {
    members.push({ name: "Ana Clara Souza", birth_date: "2011-03-04", guardian_email: "maria@example.com", guardian_email2: null });
    const r = await register(form({ guardianEmail: "outra@example.com" }));
    expect(r).toMatchObject({ status: 409, data: { code: "CADASTRO_PARECIDO" } });
    expect(inserted).toEqual([]);
  });

  it("the same family sending again stores nothing and gets the usual answer", async () => {
    members.push({ name: "Ana Clara Souza", birth_date: "2011-03-04", guardian_email: "maria@example.com", guardian_email2: null });
    expect(await register(form({ name: "Ana Souza" }))).toMatchObject({ status: 200, data: { ok: true } });
    expect(inserted).toEqual([]);
  });

  it("a different name on the same day registers normally", async () => {
    members.push({ name: "Bia Lima", birth_date: "2011-03-04", guardian_email: "x@example.com", guardian_email2: null });
    expect((await register(form())).status).toBe(200);
    expect(inserted).toHaveLength(1);
  });
});
