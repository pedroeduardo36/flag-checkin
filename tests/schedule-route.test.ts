import { beforeEach, describe, expect, it, vi } from "vitest";

// The leader schedule route against an in-memory schedule; the session and the database client are swapped.
const state = { encontros: new Set<string>(), checkins: new Map<string, number>(), audit: [] as Record<string, unknown>[], leader: true };
const leader = { id: "l1", name: "Líder Teste" };
vi.mock("@/lib/server/leader", () => ({
  requireLeader: async () => (state.leader ? { leader, stage: "completa" } : null),
  unauthorized: () => new Response(JSON.stringify({ error: "Sessão expirada. Entre de novo." }), { status: 401 }),
  adminAudit: async (_req: Request, e: Record<string, unknown>) => void state.audit.push(e),
}));
vi.mock("@/lib/server/security", () => ({ serviceDate: () => "2026-11-14" }));
vi.mock("@/lib/server/supabase", () => ({
  db: () => ({
    from: (table: string) => ({
      insert: async ({ service_date }: { service_date: string }) => {
        if (state.encontros.has(service_date)) return { error: { code: "23505" } };
        state.encontros.add(service_date);
        return { error: null };
      },
      select: () => ({ eq: async (_c: string, d: string) => ({ count: table === "checkins" ? state.checkins.get(d) ?? 0 : 0, error: null }) }),
      delete: () => ({
        eq: (_c: string, d: string) => ({
          select: async () => ({ data: state.encontros.delete(d) ? [{ service_date: d }] : [], error: null }),
        }),
      }),
    }),
  }),
}));
const route = await import("@/app/api/pastor/encontros/route");
const call = async (method: "POST" | "DELETE", date: string) => {
  const r = await route[method](new Request("http://x/api/pastor/encontros", { method, body: JSON.stringify({ date }) }));
  return { status: r.status, data: await r.json() };
};

beforeEach(() => {
  state.encontros = new Set(["2026-11-20", "2026-11-28"]);
  state.checkins = new Map();
  state.audit = [];
  state.leader = true;
});

describe("leaders manage the service schedule", () => {
  it("without a leader session, nothing changes", async () => {
    state.leader = false;
    expect((await call("POST", "2026-11-14")).status).toBe(401);
    expect(state.encontros.has("2026-11-14")).toBe(false);
  });

  it("an extra service today opens the check-in and goes to the action log", async () => {
    expect(await call("POST", "2026-11-14")).toEqual({ status: 200, data: { ok: true } });
    expect(state.encontros.has("2026-11-14")).toBe(true);
    expect(state.audit).toEqual([expect.objectContaining({ action: "encontro_criado", targetId: "2026-11-14", actor: leader })]);
  });

  it("refuses a past date and a date already scheduled", async () => {
    expect(await call("POST", "2026-11-13")).toMatchObject({ status: 400, data: { error: "Escolha hoje ou uma data futura." } });
    expect(await call("POST", "2026-11-20")).toMatchObject({ status: 409 });
    expect(state.audit).toEqual([]);
  });

  it("removes a future service without check-ins, but not one that already has check-ins", async () => {
    state.checkins.set("2026-11-28", 3);
    expect(await call("DELETE", "2026-11-28")).toMatchObject({ status: 409 });
    expect(await call("DELETE", "2026-11-20")).toEqual({ status: 200, data: { ok: true } });
    expect([...state.encontros]).toEqual(["2026-11-28"]);
    expect(state.audit).toEqual([expect.objectContaining({ action: "encontro_removido", targetId: "2026-11-20" })]);
  });

  it("past services can't be removed", async () => {
    expect(await call("DELETE", "2026-11-06")).toMatchObject({ status: 400 });
  });
});
