import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDatabase } from "./harness";
import { fakeStorage, pgClient, type FakeStorage } from "./pg-client";

// Retention and the family-request helpers run for real against the migrations; only the clients are swapped.
const current: { client: ReturnType<typeof pgClient> | null } = { client: null };
vi.mock("@/lib/server/supabase", () => ({ db: () => current.client }));
const { runRetention } = await import("@/lib/server/retention");
const { deleteMember, revokeBiometrics, checkinAllowed } = await import("@/lib/server/guardian");

let pg: PGlite;
let storage: FakeStorage;
beforeEach(async () => {
  pg = await freshDatabase();
  storage = fakeStorage();
  current.client = pgClient(pg, { storage });
}, 60_000);

const one = async <T>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows[0];
const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString();
const dateAgo = (n: number) => daysAgo(n).slice(0, 10);

/** A registration; `confirmed` = the email owner confirmed it and gave the biometric consent. */
async function member(name: string, { confirmed = false, createdDaysAgo = 0, email = `${name.split(" ")[0].toLowerCase()}@example.com`, photo = null as string | null } = {}) {
  const at = confirmed ? daysAgo(createdDaysAgo) : null;
  return (await one<{ id: string }>(
    `insert into public.members (name, birth_date, guardian_name, guardian_phone, guardian_email, guardian_consent_at,
       guardian_email_verified_at, biometric_consent_at, consent_version, verify_by, created_at, photo_path, face_descriptor)
     values ($1, '2011-03-04', 'Resp ' || $1, '61988880000', $2, $3, $4, $4, 'v1', null, $3, $5, $6) returning id`,
    [name, email, daysAgo(createdDaysAgo), at, photo, photo ? Array(128).fill(0.1) : null],
  )).id;
}
const checkin = (memberId: string | null, serviceDaysAgo: number, photo: string | null = null) =>
  pg.query("insert into public.checkins (member_id, service_date, photo_kind, photo_path, visitor_name, visitor_phone) values ($1, $2, 'criativa', $3, $4, $5)",
    [memberId, dateAgo(serviceDaysAgo), photo, memberId ? null : "Visitante", memberId ? null : "61911112222"]);

describe("retention over historical audit data (mentor review on #3)", () => {
  it("clears the coordinates of old check-in audit entries instead of aborting the whole purge", async () => {
    await pg.query("insert into public.audit_events (at, event, outcome, ip_hash, lat, lng, distance_m) values ($1, 'identificar', 'token', 'h', -15.8, -47.9, 42)", [daysAgo(10)]);
    const stale = await member("Ana Antiga", { createdDaysAgo: 20 });            // unconfirmed past the deadline
    await checkin(await member("Bia Ativa", { confirmed: true }), 40, "checkins/old.jpg"); // photo past 30 days

    const r = await runRetention(false);
    expect(r).toMatchObject({ coordenadas_auditoria: 1, cadastros_sem_confirmacao: 1, photos: 1, photosRemoved: 1, photosPending: 0 });
    const audit = await one<Record<string, unknown>>("select event, outcome, ip_hash, lat, lng, distance_m from public.audit_events");
    expect(audit).toEqual({ event: "identificar", outcome: "token", ip_hash: "h", lat: null, lng: null, distance_m: 42 });
    expect(await one("select count(*)::int n from public.members where id = $1", [stale])).toEqual({ n: 0 });
  });

  it("the audit trail stays immutable outside that redaction, even during the purge", async () => {
    await pg.query("insert into public.audit_events (event, outcome, lat, lng) values ('identificar', 'token', -15.8, -47.9)");
    await expect(pg.query("update public.audit_events set lat = null, lng = null")).rejects.toThrow(/não podem ser alterados/);
    await pg.exec("begin; select set_config('app.expurgo', 'on', true);");
    await expect(pg.query("update public.audit_events set outcome = 'ok', lat = null, lng = null")).rejects.toThrow(/não podem ser alterados/);
    await pg.exec("rollback;");
  });
});

describe("merging duplicates keeps a confirmed guardian (mentor review on #3)", () => {
  it("a confirmed duplicate merged into an unconfirmed original survives the purge with its attendance", async () => {
    const original = await member("Ana Souza", { createdDaysAgo: 20, email: "antigo@example.com" }); // deadline passed
    await checkin(original, 14);
    const dup = await member("Ana B Souza", { confirmed: true, createdDaysAgo: 2, email: "mae@example.com" });
    await checkin(dup, 0);
    await pg.query("insert into public.guardian_verifications (member_id, email, token_hash, expires_at, used_at) values ($1, 'mae@example.com', 'hash1', now(), now())", [dup]);

    await pg.query("select public.mesclar_cadastro($1, $2)", [dup, original]);
    const kept = await one<Record<string, string | null>>("select guardian_email, guardian_email_verified_at, biometric_consent_at, verify_by from public.members where id = $1", [original]);
    expect(kept.guardian_email).toBe("mae@example.com"); // the verified address came with its verification
    expect(checkinAllowed(kept as never)).toBe(true);
    expect(await one("select member_id from public.guardian_verifications")).toEqual({ member_id: original });

    await runRetention(false);
    expect(await one("select count(*)::int n from public.members where id = $1", [original])).toEqual({ n: 1 });
    expect(await one("select count(*)::int n from public.checkins where member_id = $1", [original])).toEqual({ n: 2 });
  });

  it("never puts a verification timestamp on a different, unverified address", async () => {
    const original = await member("Ana Souza", { confirmed: true, email: "pai@example.com" });
    const dup = await member("Ana B Souza", { confirmed: true, email: "mae@example.com" });
    await pg.query("update public.members set guardian_email2 = 'tia@example.com' where id = $1", [dup]);
    await pg.query("select public.mesclar_cadastro($1, $2)", [dup, original]);
    expect(await one("select guardian_email, guardian_email2, guardian_email2_verified_at from public.members where id = $1", [original]))
      .toEqual({ guardian_email: "pai@example.com", guardian_email2: null, guardian_email2_verified_at: null });
  });

  it("neither confirmed: the merge keeps the later deadline, so it doesn't bring the purge forward", async () => {
    const original = await member("Ana Souza", { createdDaysAgo: 20 });
    const dup = await member("Ana B Souza", { createdDaysAgo: 1 });
    await pg.query("select public.mesclar_cadastro($1, $2)", [dup, original]);
    const { verify_by } = await one<{ verify_by: string }>("select verify_by::text from public.members where id = $1", [original]);
    expect(verify_by >= dateAgo(-5)).toBe(true);
  });
});

describe("photo deletions survive a Storage outage (mentor review on #3)", () => {
  it("retention: fails, keeps the path queued, then deletes it on the next run", async () => {
    await checkin(await member("Bia Ativa", { confirmed: true }), 40, "checkins/old.jpg");
    storage.fail = true;
    expect(await runRetention(false)).toMatchObject({ photos: 1, photosRemoved: 0, photosPending: 1 });
    expect(await one("select path, attempts from public.photo_deletions")).toEqual({ path: "checkins/old.jpg", attempts: 1 });
    expect(await one("select photo_path from public.checkins")).toEqual({ photo_path: null });

    storage.fail = false;
    expect(await runRetention(false)).toMatchObject({ photos: 0, photosRemoved: 1, photosPending: 0 });
    expect(storage.removed).toEqual(["checkins/old.jpg"]);
    expect(await one("select count(*)::int n from public.photo_deletions")).toEqual({ n: 0 });
    expect(await one("select outcome from public.admin_audit where action = 'expurgo_retencao' order by id limit 1")).toEqual({ outcome: "erro" });
  });

  it("deleting a registration and withdrawing biometrics queue their photos the same way", async () => {
    const a = await member("Ana Souza", { confirmed: true, photo: "members/ana.jpg" });
    await checkin(a, 3, "checkins/ana.jpg");
    const b = await member("Bia Lima", { confirmed: true, photo: "members/bia.jpg" });
    storage.fail = true;
    expect(await deleteMember(a)).toEqual({ deleted: true, photos: 2 });
    expect(await revokeBiometrics(b)).toBe(true);
    expect((await pg.query("select path from public.photo_deletions order by path")).rows.map((r) => (r as { path: string }).path))
      .toEqual(["checkins/ana.jpg", "members/ana.jpg", "members/bia.jpg"]);
    expect(await one("select photo_path, face_descriptor, biometric_consent_at from public.members where id = $1", [b]))
      .toEqual({ photo_path: null, face_descriptor: null, biometric_consent_at: null });

    storage.fail = false;
    await runRetention(false);
    expect(storage.removed.sort()).toEqual(["checkins/ana.jpg", "members/ana.jpg", "members/bia.jpg"]);
    expect(await deleteMember(a)).toEqual({ deleted: false, photos: 0 });
  });
});

describe("retired leaders (mentor review on #3)", () => {
  it("deleting a leader retired for 2 years keeps the accounts they created and doesn't abort the purge", async () => {
    const old = (await one<{ id: string }>("insert into public.leaders (name, email, status, disabled_at) values ('Velho', 'velho@example.com', 'desativado', $1) returning id", [daysAgo(800)])).id;
    const created = (await one<{ id: string }>("insert into public.leaders (name, email, created_by) values ('Nova', 'nova@example.com', $1) returning id", [old])).id;
    await pg.query("insert into public.admin_audit (actor_id, actor_name, action, outcome, target_id, at) values ($1, 'Velho', 'conta_criada', 'ok', $2, $3)", [old, created, daysAgo(400)]);
    await checkin(await member("Bia Ativa", { confirmed: true }), 40, "checkins/old.jpg");

    expect(await runRetention(false)).toMatchObject({ photosRemoved: 1 });
    expect(await one("select count(*)::int n from public.leaders where id = $1", [old])).toEqual({ n: 0 });
    expect(await one("select created_by from public.leaders where id = $1", [created])).toEqual({ created_by: null });
    expect(await one("select actor_name, target_id from public.admin_audit where action = 'conta_criada'")).toEqual({ actor_name: "Velho", target_id: created });
  });
});

describe("legacy registrations (consent older than this version)", () => {
  const legacy = async (name: string, verifyBy: string) => (await one<{ id: string }>(
    `insert into public.members (name, birth_date, guardian_name, guardian_phone, guardian_email, guardian_consent_at, verify_by)
     values ($1, '2011-03-04', 'Resp', '61988880000', 'resp@example.com', now(), $2) returning id`, [name, verifyBy],
  )).id;
  const link = (memberId: string) => pg.query(
    "insert into public.guardian_verifications (member_id, email, token_hash, expires_at) values ($1, 'resp@example.com', $2, now() + interval '7 days')",
    [memberId, `hash-${memberId}`],
  );
  const exists = async (id: string) => (await one<{ n: number }>("select count(*)::int n from public.members where id = $1", [id])).n === 1;

  it("the migration gives them 30 days from the day it runs, whenever that is", async () => {
    const seeded = await freshDatabase({
      before: "20261030000000",
      run: (db) => db.query(
        "insert into public.members (name, birth_date, guardian_name, guardian_phone, guardian_email, guardian_consent_at) values ('Ana Antiga', '2011-03-04', 'Resp', '61988880000', 'resp@example.com', now())",
      ),
    });
    const { rows } = await seeded.query<{ days: number }>("select verify_by - current_date as days from public.members");
    expect(rows).toEqual([{ days: 30 }]);
  }, 60_000);

  it("past the deadline, the purge keeps a registration whose guardian never got a link", async () => {
    const id = await legacy("Ana Antiga", dateAgo(1));
    expect(await runRetention(false)).toMatchObject({ cadastros_sem_confirmacao: 0 });
    expect(await exists(id)).toBe(true);
  });

  it("past the deadline, the purge deletes a registration whose guardian got a link and didn't confirm", async () => {
    const id = await legacy("Ana Antiga", dateAgo(1));
    await link(id);
    expect(await runRetention(false)).toMatchObject({ cadastros_sem_confirmacao: 1 });
    expect(await exists(id)).toBe(false);
  });
});
