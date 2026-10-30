import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMail = vi.fn();
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail }) } }));

const SMTP = { SMTP_HOST: "smtp.exemplo.com", SMTP_USER: "user", SMTP_PASS: "pass", EMAIL_FROM: "Check-in O2 <checkin@exemplo.com>" };
const data = {
  guardianName: "Maria Souza",
  teenName: "Ana <b>Beatriz</b> Souza",
  checkedInAt: "2026-10-18T22:47:00Z", // 19:47 Brasília time
  photo: Buffer.from("fake-jpeg"),
};

beforeEach(() => {
  vi.resetModules();
  sendMail.mockReset();
  for (const k of Object.keys(SMTP)) delete process.env[k];
});
afterEach(() => vi.restoreAllMocks());
const load = () => import("@/lib/server/email");

describe("check-in email template", () => {
  it("includes the name, Brasília time and the embedded photo (cid)", async () => {
    const { buildCheckinEmail } = await load();
    const e = buildCheckinEmail(data);
    expect(e.subject).toContain("19:47");
    expect(e.subject).toContain("O2 · Flag");
    expect(e.text).toContain("Olá, Maria!");
    expect(e.text).toContain("Horário do check-in: 19:47");
    expect(e.html).toContain("19:47");
    expect(e.html).toMatch(/<img src="cid:selfie-checkin@flag-o2"/);
    expect(e.attachments[0]).toMatchObject({ cid: "selfie-checkin@flag-o2", contentType: "image/jpeg", content: data.photo });
  });

  it("escapes HTML coming from the registration", async () => {
    const { buildCheckinEmail } = await load();
    const { html } = buildCheckinEmail(data);
    expect(html).not.toContain("<b>Beatriz</b>");
    expect(html).toContain("&lt;b&gt;Beatriz&lt;/b&gt;");
  });
});

describe("sending", () => {
  it("no registered email → sem_email", async () => {
    const { sendCheckinEmail } = await load();
    expect(await sendCheckinEmail(null, data)).toBe("sem_email");
  });

  it("SMTP not configured → sem_config (doesn't try to send)", async () => {
    const { sendCheckinEmail } = await load();
    expect(await sendCheckinEmail("mae@exemplo.com", data)).toBe("sem_config");
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("configured → sends from the sender to the guardian", async () => {
    Object.assign(process.env, SMTP);
    sendMail.mockResolvedValue({ messageId: "1" });
    const { sendCheckinEmail } = await load();
    expect(await sendCheckinEmail("mae@exemplo.com", data)).toBe("enviado");
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "mae@exemplo.com", from: SMTP.EMAIL_FROM }));
  });

  it("sends to both guardian emails, without repeats and ignoring blanks", async () => {
    Object.assign(process.env, SMTP);
    sendMail.mockResolvedValue({ messageId: "1" });
    const { sendCheckinEmail } = await load();
    expect(await sendCheckinEmail(["mae@exemplo.com", "PAI@exemplo.com", null, "mae@exemplo.com"], data)).toBe("enviado");
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "mae@exemplo.com, pai@exemplo.com" }));
  });

  it("list with no email → sem_email", async () => {
    const { sendCheckinEmail } = await load();
    expect(await sendCheckinEmail([null, ""], data)).toBe("sem_email");
  });

  it("SMTP server error → falhou (the check-in doesn't break)", async () => {
    Object.assign(process.env, SMTP);
    sendMail.mockRejectedValue(new Error("535 auth failed"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { sendCheckinEmail } = await load();
    expect(await sendCheckinEmail("mae@exemplo.com", data)).toBe("falhou");
  });
});

describe("registration confirmation email", () => {
  it("subject with the first name, check-in steps and a spam notice", async () => {
    const { buildRegistrationEmail } = await load();
    const e = buildRegistrationEmail({ guardianName: "Maria Souza", teenName: "Ana <i>Beatriz</i> Souza" });
    expect(e.subject).toBe("✅ Cadastro de Ana na O2 · Flag confirmado");
    expect(e.text).toContain("nome completo e data de nascimento");
    expect(e.html).toContain("Não é spam");
    expect(e.html).not.toContain("<i>Beatriz</i>");
  });

  it("sends to both registration emails", async () => {
    Object.assign(process.env, SMTP);
    sendMail.mockResolvedValue({ messageId: "1" });
    const { sendRegistrationEmail } = await load();
    expect(await sendRegistrationEmail(["mae@exemplo.com", "pai@exemplo.com"], { guardianName: "Maria", teenName: "Ana Souza" })).toBe("enviado");
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "mae@exemplo.com, pai@exemplo.com" }));
  });

  it("extracts the sender address from EMAIL_FROM", async () => {
    Object.assign(process.env, SMTP);
    const { senderAddress } = await load();
    expect(senderAddress()).toBe("checkin@exemplo.com");
  });
});
