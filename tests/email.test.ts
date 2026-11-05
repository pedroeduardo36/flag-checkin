import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMail = vi.fn();
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail }) } }));

const SMTP = { SMTP_HOST: "smtp.exemplo.com", SMTP_USER: "user", SMTP_PASS: "pass", EMAIL_FROM: "Check-in O2 <checkin@exemplo.com>" };
const dados = {
  guardianName: "Maria Souza",
  teenName: "Ana <b>Beatriz</b> Souza",
  checkedInAt: "2026-10-18T22:47:00Z", // 19:47 Brasília time
};

beforeEach(() => {
  vi.resetModules();
  sendMail.mockReset();
  for (const k of Object.keys(SMTP)) delete process.env[k];
});
afterEach(() => vi.restoreAllMocks());
const load = () => import("@/lib/server/email");

describe("check-in email template", () => {
  it("includes the name and Brasília time, TEXT ONLY: no photo leaves by email", async () => {
    const { buildCheckinEmail } = await load();
    const e = buildCheckinEmail(dados);
    expect(e.subject).toContain("19:47");
    expect(e.subject).toContain("O2 · Flag");
    expect(e.text).toContain("Olá, Maria!");
    expect(e.text).toContain("Horário do check-in: 19:47");
    expect(e.html).toContain("19:47");
    expect(e.html).not.toMatch(/<img|cid:/);
    expect(e).not.toHaveProperty("attachments");
    expect(e.text).toContain("exclusão dos dados");
  });

  it("escapes HTML coming from the registration", async () => {
    const { buildCheckinEmail } = await load();
    const { html } = buildCheckinEmail(dados);
    expect(html).not.toContain("<b>Beatriz</b>");
    expect(html).toContain("&lt;b&gt;Beatriz&lt;/b&gt;");
  });
});

describe("sending", () => {
  it("no registered email → sem_email", async () => {
    const { sendCheckinEmail } = await load();
    expect(await sendCheckinEmail(null, dados)).toBe("sem_email");
  });

  it("SMTP not configured → sem_config (doesn't try to send)", async () => {
    const { sendCheckinEmail } = await load();
    expect(await sendCheckinEmail("mae@exemplo.com", dados)).toBe("sem_config");
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("configured → sends from the sender to the guardian", async () => {
    Object.assign(process.env, SMTP);
    sendMail.mockResolvedValue({ messageId: "1" });
    const { sendCheckinEmail } = await load();
    expect(await sendCheckinEmail("mae@exemplo.com", dados)).toBe("enviado");
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "mae@exemplo.com", from: SMTP.EMAIL_FROM }));
  });

  it("sends to both guardian emails, without duplicates and ignoring blanks", async () => {
    Object.assign(process.env, SMTP);
    sendMail.mockResolvedValue({ messageId: "1" });
    const { sendCheckinEmail } = await load();
    expect(await sendCheckinEmail(["mae@exemplo.com", "PAI@exemplo.com", null, "mae@exemplo.com"], dados)).toBe("enviado");
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "mae@exemplo.com, pai@exemplo.com" }));
  });

  it("list without any email → sem_email", async () => {
    const { sendCheckinEmail } = await load();
    expect(await sendCheckinEmail([null, ""], dados)).toBe("sem_email");
  });

  it("SMTP server error → falhou (the check-in doesn't break)", async () => {
    Object.assign(process.env, SMTP);
    sendMail.mockRejectedValue(new Error("535 auth failed"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { sendCheckinEmail } = await load();
    expect(await sendCheckinEmail("mae@exemplo.com", dados)).toBe("falhou");
  });
});

describe("registration confirmation email (guardian verification)", () => {
  const base = { guardianName: "Maria Souza", teenName: "Ana <i>Beatriz</i> Souza", link: "https://app.exemplo/confirmar#t=abc", validDays: 7 };

  it("primary email: asks to read and confirm, explains the deadline and escapes HTML", async () => {
    const { buildVerificationEmail } = await load();
    const e = buildVerificationEmail({ ...base, primary: true });
    expect(e.subject).toBe("Confirme o cadastro de Ana na O2 · Flag");
    expect(e.text).toContain("reconhecimento facial");
    expect(e.text).toContain("https://app.exemplo/confirmar#t=abc");
    expect(e.text).toContain("apagado em 7 dias");
    expect(e.html).toContain('href="https://app.exemplo/confirmar#t=abc"');
    expect(e.html).not.toContain("<i>Beatriz</i>");
  });

  it("second email: only confirms it wants the notices", async () => {
    const { buildVerificationEmail } = await load();
    const e = buildVerificationEmail({ ...base, primary: false });
    expect(e.subject).toContain("Confirme este e-mail");
    expect(e.text).toContain("indicou este e-mail");
  });

  it("sends to one address at a time (each has its own link)", async () => {
    Object.assign(process.env, SMTP);
    sendMail.mockResolvedValue({ messageId: "1" });
    const { sendVerificationEmail } = await load();
    expect(await sendVerificationEmail("mae@exemplo.com", { ...base, primary: true })).toBe("enviado");
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "mae@exemplo.com" }));
  });

  it("extracts the sender address from EMAIL_FROM", async () => {
    Object.assign(process.env, SMTP);
    const { senderAddress } = await load();
    expect(senderAddress()).toBe("checkin@exemplo.com");
  });
});

describe("checkout notice", () => {
  const checkout = { guardianName: "Maria Souza", teenName: "Ana <b>Beatriz</b> Souza", checkedOutAt: "2026-10-19T00:15:00Z", by: "participante" as const };

  it("text only, with the Brasília time and who confirmed", async () => {
    const { buildCheckoutEmail } = await load();
    const e = buildCheckoutEmail(checkout);
    expect(e.subject).toContain("saiu do culto");
    expect(e.subject).toContain("21:15");
    expect(e.text).toContain("Horário da saída: 21:15");
    expect(e.text).toContain("confirmou a saída pelo celular");
    expect(e.html).not.toMatch(/<img|cid:/);
    expect(e.html).toContain("&lt;b&gt;Beatriz&lt;/b&gt;");
    expect(buildCheckoutEmail({ ...checkout, by: "lider" }).text).toContain("registrada por um líder");
  });

  it("CHECKOUT_NOTICE=false turns off the checkout notice", async () => {
    Object.assign(process.env, SMTP, { CHECKOUT_NOTICE: "false" });
    const { sendCheckoutEmail } = await load();
    expect(await sendCheckoutEmail("mae@exemplo.com", checkout)).toBe("desligado");
    expect(sendMail).not.toHaveBeenCalled();
    delete process.env.CHECKOUT_NOTICE;
  });

  it("configured → sends to the guardian's emails", async () => {
    Object.assign(process.env, SMTP);
    sendMail.mockResolvedValue({ messageId: "1" });
    const { sendCheckoutEmail } = await load();
    expect(await sendCheckoutEmail(["mae@exemplo.com", "MAE@exemplo.com", null], checkout)).toBe("enviado");
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "mae@exemplo.com" }));
  });
});
