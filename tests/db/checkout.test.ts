import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDatabase } from "./harness";
import { PARSERS, pgClient } from "./pg-client";

// The checkout routes run for real against every migration (P2 included). Swapped: the database client
// (SQL on PGlite), the SMTP transport (recorded) and after() (collected, so tests can await notifications).
Object.assign(process.env, {
  CHECKIN_SECRET: "test-secret-0123456789-abcdefghijklmnop", CHURCH_LAT: "-15.8", CHURCH_LNG: "-47.9", CHURCH_RADIUS_METERS: "150",
  SMTP_HOST: "smtp.test", SMTP_USER: "u", SMTP_PASS: "p", EMAIL_FROM: "Check-in <checkin@example.com>",
});
const sendMail = vi.fn(async () => ({ messageId: "1" }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail }) } }));
const current: { client: ReturnType<typeof pgClient> | null } = { client: null };
vi.mock("@/lib/server/supabase", () => ({ db: () => current.client }));
const pending: Promise<unknown>[] = [];
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void pending.push(Promise.resolve().then(fn)) }));
const flushAfter = async () => { while (pending.length) await pending.shift(); };

const checkoutRoute = await import("@/app/api/checkin/checkout/route");
const visitorRoute = await import("@/app/api/checkin/visitante/route");
const correctionRoute = await import("@/app/api/pastor/checkins/route");
const feedRoute = await import("@/app/api/pastor/feed/route");
const { createVisitSession, VISIT_COOKIE } = await import("@/lib/server/visit");
const { startSession } = await import("@/lib/server/leader");
const { serviceDate } = await import("@/lib/server/security");

const inside = { lat: -15.8, lng: -47.9, accuracy: 10 };
const call = (handler: (r: Request) => Promise<Response>, method: string, path: string, { body, cookie }: { body?: unknown; cookie?: string } = {}) =>
  handler(new Request(`http://test${path}`, {
    method,
    headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.7", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
const json = async (r: Response) => ({ status: r.status, data: await r.json(), setCookie: r.headers.get("set-cookie") ?? "" });
const visitCookie = (memberId: string | null, checkinId: string, date = serviceDate()) =>
  `${VISIT_COOKIE}=${encodeURIComponent(createVisitSession(memberId, date, Date.now(), checkinId).value)}`;
const hhmm = (d: Date) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Sao_Paulo" });

let pg: PGlite;
let teen: string, teenCheckin: string, arrivedAt: string, leaderId: string, leaderCookie: string;
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params, { parsers: PARSERS })).rows[0];

beforeEach(async () => {
  pg = await freshDatabase();
  current.client = pgClient(pg);
  sendMail.mockClear();
  pending.length = 0;
  delete process.env.CHECKOUT_NOTICE;
  teen = (await one<{ id: string }>(
    `insert into public.members (name, birth_date, guardian_name, guardian_phone, guardian_email, guardian_consent_at,
       guardian_email_verified_at, biometric_consent_at, consent_version, verify_by)
     values ('Ana Souza', '2011-03-04', 'Maria Souza', '61988880000', 'mae@example.com', now(), now(), now(), 'v1', null) returning id`)).id;
  // Arrived a minute before the current minute, so a leader-entered "now" is after the arrival.
  const minute = new Date(Math.floor(Date.now() / 60_000) * 60_000 - 60_000);
  ({ id: teenCheckin, checked_in_at: arrivedAt } = await one<{ id: string; checked_in_at: string }>(
    "insert into public.checkins (member_id, service_date, checked_in_at, photo_kind, photo_path, distance_m) values ($1, $2, $3, 'criativa', 'checkins/a.jpg', 12) returning id, checked_in_at",
    [teen, serviceDate(), minute.toISOString()]));
  leaderId = (await one<{ id: string }>("insert into public.leaders (name, email) values ('Líder Teste', 'lider@example.com') returning id")).id;
  const res = await startSession(new Request("http://test/"), leaderId, "completa", {});
  leaderCookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
}, 60_000);

describe("visit session: issuance and rejection", () => {
  it("without a session, nothing is shown and the checkout is refused", async () => {
    expect((await json(await call(checkoutRoute.GET, "GET", "/api/checkin/checkout"))).data).toEqual({ visit: null });
    const r = await json(await call(checkoutRoute.POST, "POST", "/api/checkin/checkout", { body: {} }));
    expect(r).toMatchObject({ status: 401, data: { code: "SEM_VISITA" } });
  });

  it("a forged cookie or a session for another day doesn't work", async () => {
    const forged = await json(await call(checkoutRoute.POST, "POST", "/api/checkin/checkout", { body: {}, cookie: `${VISIT_COOKIE}=eyJtaWQiOm51bGx9.assinaturafalsa` }));
    expect(forged.status).toBe(401);
    const otherDay = await json(await call(checkoutRoute.GET, "GET", "/api/checkin/checkout", { cookie: visitCookie(teen, teenCheckin, "2026-01-01") }));
    expect(otherDay.data).toEqual({ visit: null });
  });

  it("the session opens the visit with 'checkout not recorded'", async () => {
    const r = await json(await call(checkoutRoute.GET, "GET", "/api/checkin/checkout", { cookie: visitCookie(teen, teenCheckin) }));
    expect(r.data.visit).toMatchObject({ name: "Ana Souza", isVisitor: false, checkedInAt: arrivedAt, checkedOutAt: null });
  });
});

describe("participant checkout", () => {
  it("one tap records the server time, keeps the attendance and notifies the guardian (text only)", async () => {
    const before = Date.now();
    const r = await json(await call(checkoutRoute.POST, "POST", "/api/checkin/checkout", { body: inside, cookie: visitCookie(teen, teenCheckin) }));
    await flushAfter();
    expect(r).toMatchObject({ status: 200, data: { alreadyCheckedOut: false, checkoutBy: "participante" } });
    expect(Math.abs(Date.parse(r.data.checkedOutAt) - before)).toBeLessThan(10_000);
    const row = await one("select checked_in_at, photo_path, distance_m, checkout_by, checkout_leader_id, checkout_distance_m, checkout_email_status from public.checkins where id = $1", [teenCheckin]);
    expect(row).toMatchObject({ checked_in_at: arrivedAt, photo_path: "checkins/a.jpg", distance_m: 12, checkout_by: "participante", checkout_leader_id: null, checkout_email_status: "enviado" });
    expect(typeof row.checkout_distance_m).toBe("number");
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "mae@example.com", subject: expect.stringContaining("saiu do culto") }));
    expect(JSON.stringify(sendMail.mock.calls)).not.toMatch(/cid:|<img/);
  });

  it("three simultaneous confirmations record one checkout and all return it", async () => {
    const cookie = visitCookie(teen, teenCheckin);
    const first = await json(await call(checkoutRoute.POST, "POST", "/api/checkin/checkout", { body: {}, cookie }));
    const again = await Promise.all([0, 1, 2].map(async () => json(await call(checkoutRoute.POST, "POST", "/api/checkin/checkout", { body: {}, cookie }))));
    await flushAfter();
    expect(again.every((x) => x.status === 200 && x.data.alreadyCheckedOut === true && x.data.checkedOutAt === first.data.checkedOutAt)).toBe(true);
    expect(await one("select count(*)::int n from public.checkins")).toEqual({ n: 1 });
    expect(sendMail).toHaveBeenCalledTimes(1);
    const outcomes = (await pg.query<{ outcome: string }>("select outcome from public.audit_events where event = 'checkout'")).rows.map((r) => r.outcome);
    expect(outcomes.sort()).toEqual(["ok", "repetido", "repetido", "repetido"]);
  });

  it("CHECKOUT_NOTICE=false records the checkout without emailing", async () => {
    process.env.CHECKOUT_NOTICE = "false";
    await call(checkoutRoute.POST, "POST", "/api/checkin/checkout", { body: {}, cookie: visitCookie(teen, teenCheckin) });
    await flushAfter();
    expect(sendMail).not.toHaveBeenCalled();
    expect(await one("select checkout_email_status from public.checkins where id = $1", [teenCheckin])).toEqual({ checkout_email_status: "desligado" });
  });
});

describe("visitor checkout", () => {
  it("the visitor's own phone gets the session; repeating name and phone elsewhere doesn't", async () => {
    const first = await json(await call(visitorRoute.POST, "POST", "/api/checkin/visitante", { body: { ...inside, name: "Visitante Teste", phone: "61911112222" } }));
    expect(first.status).toBe(200);
    expect(first.setCookie).toContain(`${VISIT_COOKIE}=`);
    const repeat = await json(await call(visitorRoute.POST, "POST", "/api/checkin/visitante", { body: { ...inside, name: "Visitante Teste", phone: "61911112222" } }));
    expect(repeat).toMatchObject({ status: 200, data: { alreadyCheckedIn: true } });
    expect(repeat.setCookie).not.toContain(`${VISIT_COOKIE}=`);

    const out = await json(await call(checkoutRoute.POST, "POST", "/api/checkin/checkout", { body: {}, cookie: first.setCookie.split(";")[0] }));
    await flushAfter();
    expect(out).toMatchObject({ status: 200, data: { isVisitor: true, alreadyCheckedOut: false } });
    expect(sendMail).not.toHaveBeenCalled(); // visitors have no registered guardian
  });
});

describe("leader corrections, feed and audit", () => {
  const patch = (body: object, cookie = leaderCookie) => call(correctionRoute.PATCH, "PATCH", "/api/pastor/checkins", { body, cookie }).then(json);

  it("record/undo with a reason, never overwriting, reflected in the feed, the phone and the audit trail", async () => {
    const teenCookie = visitCookie(teen, teenCheckin);
    const own = await json(await call(checkoutRoute.POST, "POST", "/api/checkin/checkout", { body: {}, cookie: teenCookie }));
    await flushAfter();

    expect((await patch({ id: teenCheckin, action: "desfazer_saida", reason: "teste" }, teenCookie)).status).toBe(401);
    expect((await patch({ id: teenCheckin, action: "desfazer_saida", reason: "" })).status).toBe(400);
    expect(await patch({ id: teenCheckin, action: "registrar_saida", time: hhmm(new Date()), reason: "teste automático" }))
      .toMatchObject({ status: 409, data: { code: "JA_SAIU" } });

    const feed = await json(await call(feedRoute.GET, "GET", "/api/pastor/feed", { cookie: leaderCookie }));
    expect(feed.data).toMatchObject({ checkedOut: 1 });
    expect(feed.data.items[0]).toMatchObject({ id: teenCheckin, checkedOutAt: own.data.checkedOutAt, checkoutBy: "participante" });

    expect((await patch({ id: teenCheckin, action: "desfazer_saida", reason: "confirmou sem querer" })).status).toBe(200);
    expect(await one("select checked_in_at, checked_out_at, checkout_by from public.checkins where id = $1", [teenCheckin]))
      .toEqual({ checked_in_at: arrivedAt, checked_out_at: null, checkout_by: null });
    const changed = await json(await call(feedRoute.GET, "GET", `/api/pastor/feed?since=${encodeURIComponent(feed.data.cursor)}`, { cookie: leaderCookie }));
    expect(changed.data.items).toEqual([expect.objectContaining({ id: teenCheckin, checkedOutAt: null })]);
    expect((await json(await call(checkoutRoute.GET, "GET", "/api/checkin/checkout", { cookie: teenCookie }))).data.visit.checkedOutAt).toBeNull();

    const later = hhmm(new Date(Date.now() + 2 * 3600e3));
    expect((await patch({ id: teenCheckin, action: "registrar_saida", time: later, reason: "teste automático" })).status).toBe(400);
    expect(await patch({ id: teenCheckin, action: "registrar_saida", time: hhmm(new Date()), reason: "esqueceu de confirmar" }))
      .toMatchObject({ status: 200, data: { checkoutBy: "lider" } });
    expect(await one("select checkout_by, checkout_leader_id, checkout_distance_m from public.checkins where id = $1", [teenCheckin]))
      .toEqual({ checkout_by: "lider", checkout_leader_id: leaderId, checkout_distance_m: null });
    const after = await json(await call(checkoutRoute.POST, "POST", "/api/checkin/checkout", { body: {}, cookie: teenCookie }));
    expect(after.data).toMatchObject({ alreadyCheckedOut: true, checkoutBy: "lider" });

    const trail = (await pg.query<{ action: string; actor_id: string; target_id: string; details: Record<string, string> }>(
      "select action, actor_id, target_id, details from public.admin_audit where action like 'saida_%' order by id")).rows;
    expect(trail).toEqual([
      expect.objectContaining({ action: "saida_desfeita", actor_id: leaderId, target_id: teenCheckin, details: expect.objectContaining({ motivo: "confirmou sem querer", saida_anterior: own.data.checkedOutAt }) }),
      expect.objectContaining({ action: "saida_registrada", actor_id: leaderId, target_id: teenCheckin, details: expect.objectContaining({ motivo: "esqueceu de confirmar" }) }),
    ]);
    const view = await one("select saida, saida_confirmada_por from public.presencas where culto = $1", [serviceDate()]);
    expect(view.saida_confirmada_por).toBe("lider");
    expect(view.saida).toMatch(/^\d{2}:\d{2}$/);
  });
});
