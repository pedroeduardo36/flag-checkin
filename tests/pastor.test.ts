import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  process.env.CHECKIN_SECRET = "b".repeat(64);
  process.env.PASTOR_PASSWORD = "O2Pastor";
});
const load = () => import("@/lib/server/pastor");
const req = (cookie?: string) => new Request("http://x/api/pastor/feed", { headers: cookie ? { cookie } : {} });

describe("sessão da área do pastor", () => {
  it("confere a senha do pastor (sensível a maiúsculas)", async () => {
    const { checkPastorPassword } = await load();
    expect(checkPastorPassword("O2Pastor")).toBe(true);
    expect(checkPastorPassword("o2pastor")).toBe(false);
    expect(checkPastorPassword(undefined)).toBe(false);
  });

  it("cookie assinado vale por 12 h", async () => {
    const { createPastorSession, isValidPastorSession } = await load();
    const now = Date.now();
    const s = createPastorSession(now);
    expect(s.maxAge).toBe(12 * 3600);
    expect(isValidPastorSession(s.value, now + 11 * 3600_000)).toBe(true);
    expect(isValidPastorSession(s.value, now + 13 * 3600_000)).toBe(false);
  });

  it("recusa cookie forjado ou com validade alterada", async () => {
    const { createPastorSession, isValidPastorSession } = await load();
    const [, sig] = createPastorSession().value.split(".");
    expect(isValidPastorSession(`${Date.now() + 9e9}.${sig}`)).toBe(false);
    expect(isValidPastorSession("9999999999999.assinaturafalsa")).toBe(false);
    expect(isValidPastorSession("")).toBe(false);
  });

  it("lê o cookie do cabeçalho da requisição", async () => {
    const { PASTOR_COOKIE, createPastorSession, isPastorRequest } = await load();
    const { value } = createPastorSession();
    expect(isPastorRequest(req(`outro=1; ${PASTOR_COOKIE}=${encodeURIComponent(value)}`))).toBe(true);
    expect(isPastorRequest(req())).toBe(false);
    expect(isPastorRequest(req(`${PASTOR_COOKIE}=x.y`))).toBe(false);
  });

  it("cookie httpOnly, SameSite=strict e no caminho raiz", async () => {
    const { cookieOptions } = await load();
    expect(cookieOptions(60)).toMatchObject({ httpOnly: true, sameSite: "strict", path: "/", maxAge: 60 });
  });
});
