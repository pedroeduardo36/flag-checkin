import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDatabase } from "./harness";
import { pgClient } from "./pg-client";

// The registration route runs for real; only its database client, email and after() are swapped.
const current: { client: ReturnType<typeof pgClient> | null } = { client: null };
vi.mock("@/lib/server/supabase", () => ({ db: () => current.client }));
vi.mock("@/lib/server/email", () => ({ emailConfigured: () => false, senderAddress: () => null, sendRegistrationEmail: async () => "sem_config", sendVerificationEmail: async () => "sem_config" }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
const { POST } = await import("@/app/api/cadastro/route");

const form = (over: Record<string, unknown> = {}) => ({
  name: "Ana Beatriz de Souza", birthDate: "2011-03-04", guardianName: "Maria Souza", guardianPhone: "61988880000",
  guardianEmail: "mae@example.com", consent: true, consentBiometric: true, ...over,
});
const submit = (body: object) =>
  POST(new Request("http://test/api/cadastro", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

/** Holds every registration read until `n` of them are waiting: all requests read before any inserts. */
function readBarrier(n: number) {
  let waiting = 0;
  let release!: () => void;
  const open = new Promise<void>((r) => (release = r));
  let done = false;
  return async (table: string) => {
    if (table !== "members" || done) return;
    if (++waiting >= n) { done = true; release(); }
    await open;
  };
}

let pg: PGlite;
const members = async () =>
  (await pg.query<{ id: string; name: string; possible_duplicate_of: string | null }>(
    "select id, name, possible_duplicate_of from public.members order by created_at, id")).rows;

beforeEach(async () => {
  pg = await freshDatabase();
  current.client = pgClient(pg);
}, 60_000);

describe("cadastrar_membro(): the duplicate decision and the insert are atomic", () => {
  it("inserts when the server saw every same-day registration", async () => {
    const id = (await pg.query<{ id: string }>("select public.cadastrar_membro($1, '{}', null) id", [{ name: "Ana Souza", birth_date: "2011-03-04", guardian_name: "Maria Souza", guardian_phone: "61988880000", guardian_email: "mae@example.com" }])).rows[0].id;
    expect(await members()).toEqual([{ id, name: "Ana Souza", possible_duplicate_of: null }]);
  });

  it("refuses (40001) when a same-day registration appeared after the server's read", async () => {
    const row = { name: "Ana Souza", birth_date: "2011-03-04", guardian_name: "Maria Souza", guardian_phone: "61988880000", guardian_email: "mae@example.com" };
    await pg.query("select public.cadastrar_membro($1, '{}', null)", [row]);
    await expect(pg.query("select public.cadastrar_membro($1, '{}', null)", [row])).rejects.toMatchObject({ code: "40001" });
    // A registration on another birth date doesn't interfere.
    await pg.query("select public.cadastrar_membro($1, '{}', null)", [{ ...row, birth_date: "2012-01-01" }]);
    expect(await members()).toHaveLength(2);
  });

  it("refuses when the registration flagged as the original no longer exists (merged away)", async () => {
    await expect(pg.query("select public.cadastrar_membro($1, '{}', gen_random_uuid())", [{ name: "Ana Souza", birth_date: "2011-03-04", guardian_name: "M S", guardian_phone: "61988880000", guardian_email: "a@b.co" }]))
      .rejects.toMatchObject({ code: "40001" });
  });
});

describe("concurrent registrations through the route (regression: mentor review on #2)", () => {
  it("the same guardian submitting twice at once stores ONE registration, and both get the same 200", async () => {
    current.client = pgClient(pg, { beforeSelect: readBarrier(2) });
    const [a, b] = await Promise.all([submit(form()), submit(form())]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await a.json()).toEqual(await b.json());
    expect(await members()).toHaveLength(1);
  });

  it("two different guardians registering the same teen at once leave a flagged, reviewable duplicate", async () => {
    current.client = pgClient(pg, { beforeSelect: readBarrier(2) });
    const [a, b] = await Promise.all([
      submit(form()),
      submit(form({ name: "Ana Souza", guardianName: "João Souza", guardianEmail: "pai@example.com" })),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const [first, second] = await members();
    expect(first.possible_duplicate_of).toBeNull();
    expect(second.possible_duplicate_of).toBe(first.id);
  });

  it("five simultaneous identical submissions still store one registration", async () => {
    current.client = pgClient(pg, { beforeSelect: readBarrier(5) });
    const res = await Promise.all(Array.from({ length: 5 }, () => submit(form())));
    expect(res.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(await members()).toHaveLength(1);
  });
});
