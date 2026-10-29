import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  process.env.CHECKIN_SECRET = "c".repeat(64);
});
const load = () => import("@/lib/server/visit");
const req = (cookie?: string) => new Request("http://x/api/checkin/identificar", { method: "POST", headers: cookie ? { cookie } : {} });

describe("sessão da visita (quem pode rever foto e horário do check-in)", () => {
  it("vale só para o adolescente e o dia em que o check-in foi concluído", async () => {
    const { VISIT_COOKIE, createVisitSession, hasVisitSession } = await load();
    const { value } = createVisitSession("ana", "2026-10-25");
    const c = `${VISIT_COOKIE}=${encodeURIComponent(value)}`;
    expect(hasVisitSession(req(c), "ana", "2026-10-25")).toBe(true);
    expect(hasVisitSession(req(c), "bruno", "2026-10-25")).toBe(false); // outro adolescente
    expect(hasVisitSession(req(c), "ana", "2026-11-01")).toBe(false); // outro culto
  });

  it("sem cookie, cookie forjado ou adulterado → sem acesso", async () => {
    const { VISIT_COOKIE, createVisitSession, hasVisitSession, readVisitSession } = await load();
    expect(hasVisitSession(req(), "ana", "2026-10-25")).toBe(false);
    expect(hasVisitSession(req(`${VISIT_COOKIE}=abc.def`), "ana", "2026-10-25")).toBe(false);
    const [, sig] = createVisitSession("bruno", "2026-10-25").value.split(".");
    const forged = Buffer.from(JSON.stringify({ mid: "ana", date: "2026-10-25", exp: Date.now() + 1e6 })).toString("base64url");
    expect(readVisitSession(`${forged}.${sig}`)).toBeNull(); // trocar o adolescente invalida a assinatura
  });

  it("guarda o check-in (para a saída) e vale também para visitante, sem dar acesso de adolescente", async () => {
    const { VISIT_COOKIE, createVisitSession, hasVisitSession, readVisitSession, visitFromRequest } = await load();
    const ana = createVisitSession("ana", "2026-10-25", Date.now(), "ck-1");
    expect(readVisitSession(ana.value)).toMatchObject({ mid: "ana", cid: "ck-1", date: "2026-10-25" });
    const vis = createVisitSession(null, "2026-10-25", Date.now(), "ck-2");
    const c = `${VISIT_COOKIE}=${encodeURIComponent(vis.value)}`;
    expect(visitFromRequest(req(c))).toMatchObject({ mid: null, cid: "ck-2" });
    expect(hasVisitSession(req(c), "ana", "2026-10-25")).toBe(false);
    // Trocar o check-in no cookie invalida a assinatura: não dá para fechar a visita de outra pessoa.
    const [, sig] = ana.value.split(".");
    const forged = Buffer.from(JSON.stringify({ mid: "ana", cid: "ck-9", date: "2026-10-25", exp: Date.now() + 1e6 })).toString("base64url");
    expect(readVisitSession(`${forged}.${sig}`)).toBeNull();
  });

  it("cookie antigo, sem o check-in, continua válido", async () => {
    const { createVisitSession, readVisitSession } = await load();
    expect(readVisitSession(createVisitSession("ana", "2026-10-25").value)).toMatchObject({ mid: "ana", date: "2026-10-25" });
  });

  it("expira", async () => {
    const { createVisitSession, readVisitSession } = await load();
    const now = Date.now();
    const { value } = createVisitSession("ana", "2026-10-25", now);
    expect(readVisitSession(value, now + 17 * 3600_000)).not.toBeNull();
    expect(readVisitSession(value, now + 19 * 3600_000)).toBeNull();
  });

  it("cookie httpOnly, SameSite=strict e restrito às rotas de check-in", async () => {
    const { visitCookieOptions } = await load();
    expect(visitCookieOptions(60)).toMatchObject({ httpOnly: true, sameSite: "strict", path: "/api/checkin" });
  });
});
