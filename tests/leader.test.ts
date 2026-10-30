import { beforeEach, describe, expect, it, vi } from "vitest";

// The database shouldn't even be queried when there is no leader cookie.
const from = vi.fn();
vi.mock("@/lib/server/supabase", () => ({ db: () => ({ from, rpc: vi.fn() }) }));

beforeEach(() => {
  vi.resetModules();
  from.mockReset();
  process.env.CHECKIN_SECRET = "f".repeat(64);
});

const req = (cookie?: string) => new Request("http://x/api/pastor/feed", { headers: cookie ? { cookie } : {} });

describe("leader session", () => {
  it("the teen's visit cookie doesn't open the leader area", async () => {
    const { createVisitSession, VISIT_COOKIE } = await import("@/lib/server/visit");
    const { requireLeader, readSession } = await import("@/lib/server/leader");
    const { value } = createVisitSession("ana", "2026-10-25");
    expect(await requireLeader(req(`${VISIT_COOKIE}=${encodeURIComponent(value)}`))).toBeNull();
    expect(await readSession(req())).toBeNull();
    expect(await readSession(req("o2_pastor=9999999999999.assinaturaantiga"))).toBeNull(); // senha compartilhada antiga
    expect(from).not.toHaveBeenCalled();
  });

  it("only the 'completa' stage unlocks private data", async () => {
    const { requireLeader, LEADER_COOKIE } = await import("@/lib/server/leader");
    const token = "t".repeat(43);
    for (const [stage, liberado] of [["senha", false], ["cadastro_totp", false], ["completa", true]] as const) {
      from.mockReturnValueOnce({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({
          data: { id: "s1", stage, expires_at: new Date(Date.now() + 60_000).toISOString(), revoked_at: null, leaders: { id: "l1", name: "Líder", email: "l@x.com", status: "ativo" } },
          error: null,
        }) }) }),
      });
      expect(!!(await requireLeader(req(`${LEADER_COOKIE}=${token}`)))).toBe(liberado);
    }
  });

  it("a revoked, expired or deactivated-account session is rejected", async () => {
    const { readSession, LEADER_COOKIE } = await import("@/lib/server/leader");
    const base = { id: "s1", stage: "completa", expires_at: new Date(Date.now() + 60_000).toISOString(), revoked_at: null, leaders: { id: "l1", name: "L", email: "l@x.com", status: "ativo" } };
    const cases = [
      { ...base, revoked_at: new Date().toISOString() },
      { ...base, expires_at: new Date(Date.now() - 1000).toISOString() },
      { ...base, leaders: { ...base.leaders, status: "desativado" } },
    ];
    for (const data of cases) {
      from.mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data, error: null }) }) }) });
      expect(await readSession(req(`${LEADER_COOKIE}=${"t".repeat(43)}`))).toBeNull();
    }
  });

  it("httpOnly, SameSite=strict cookie", async () => {
    const { leaderCookieOptions } = await import("@/lib/server/leader");
    expect(leaderCookieOptions(60)).toMatchObject({ httpOnly: true, sameSite: "strict", path: "/", maxAge: 60 });
  });
});
