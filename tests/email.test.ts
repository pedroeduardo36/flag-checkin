import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMail = vi.fn();
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail }) } }));

const SMTP = { SMTP_HOST: "smtp.exemplo.com", SMTP_USER: "user", SMTP_PASS: "pass", EMAIL_FROM: "Check-in O2 <checkin@exemplo.com>" };
const dados = {
  guardianName: "Maria Souza",
  teenName: "Ana <b>Beatriz</b> Souza",
  checkedInAt: "2026-10-18T22:47:00Z", // 19:47 em Brasília
  photo: Buffer.from("jpeg-falso"),
};

beforeEach(() => {
  vi.resetModules();
  sendMail.mockReset();
  for (const k of Object.keys(SMTP)) delete process.env[k];
});
afterEach(() => vi.restoreAllMocks());
const load = () => import("@/lib/server/email");

describe("modelo do e-mail de check-in", () => {
  it("traz nome, horário de Brasília e a foto embutida (cid)", async () => {
    const { buildCheckinEmail } = await load();
    const e = buildCheckinEmail(dados);
    expect(e.subject).toContain("19:47");
    expect(e.subject).toContain("O2 · Flag");
    expect(e.text).toContain("Olá, Maria!");
    expect(e.text).toContain("Horário do check-in: 19:47");
    expect(e.html).toContain("19:47");
    expect(e.html).toMatch(/<img src="cid:selfie-checkin@flag-o2"/);
    expect(e.attachments[0]).toMatchObject({ cid: "selfie-checkin@flag-o2", contentType: "image/jpeg", content: dados.photo });
  });

  it("escapa HTML vindo do cadastro", async () => {
    const { buildCheckinEmail } = await load();
    const { html } = buildCheckinEmail(dados);
    expect(html).not.toContain("<b>Beatriz</b>");
    expect(html).toContain("&lt;b&gt;Beatriz&lt;/b&gt;");
  });
});

describe("envio", () => {
  it("sem e-mail cadastrado → sem_email", async () => {
    const { sendCheckinEmail } = await load();
    expect(await sendCheckinEmail(null, dados)).toBe("sem_email");
  });

  it("SMTP não configurado → sem_config (não tenta enviar)", async () => {
    const { sendCheckinEmail } = await load();
    expect(await sendCheckinEmail("mae@exemplo.com", dados)).toBe("sem_config");
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("configurado → envia do remetente para o responsável", async () => {
    Object.assign(process.env, SMTP);
    sendMail.mockResolvedValue({ messageId: "1" });
    const { sendCheckinEmail } = await load();
    expect(await sendCheckinEmail("mae@exemplo.com", dados)).toBe("enviado");
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "mae@exemplo.com", from: SMTP.EMAIL_FROM }));
  });

  it("envia para os dois e-mails do responsável, sem repetir e ignorando vazios", async () => {
    Object.assign(process.env, SMTP);
    sendMail.mockResolvedValue({ messageId: "1" });
    const { sendCheckinEmail } = await load();
    expect(await sendCheckinEmail(["mae@exemplo.com", "PAI@exemplo.com", null, "mae@exemplo.com"], dados)).toBe("enviado");
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "mae@exemplo.com, pai@exemplo.com" }));
  });

  it("lista sem nenhum e-mail → sem_email", async () => {
    const { sendCheckinEmail } = await load();
    expect(await sendCheckinEmail([null, ""], dados)).toBe("sem_email");
  });

  it("erro do servidor SMTP → falhou (o check-in não quebra)", async () => {
    Object.assign(process.env, SMTP);
    sendMail.mockRejectedValue(new Error("535 auth failed"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { sendCheckinEmail } = await load();
    expect(await sendCheckinEmail("mae@exemplo.com", dados)).toBe("falhou");
  });
});

describe("e-mail de confirmação do cadastro", () => {
  it("assunto com o primeiro nome, passo a passo do check-in e aviso de spam", async () => {
    const { buildCadastroEmail } = await load();
    const e = buildCadastroEmail({ guardianName: "Maria Souza", teenName: "Ana <i>Beatriz</i> Souza" });
    expect(e.subject).toBe("✅ Cadastro de Ana na O2 · Flag confirmado");
    expect(e.text).toContain("nome completo e data de nascimento");
    expect(e.html).toContain("Não é spam");
    expect(e.html).not.toContain("<i>Beatriz</i>");
  });

  it("envia para os dois e-mails do cadastro", async () => {
    Object.assign(process.env, SMTP);
    sendMail.mockResolvedValue({ messageId: "1" });
    const { sendCadastroEmail } = await load();
    expect(await sendCadastroEmail(["mae@exemplo.com", "pai@exemplo.com"], { guardianName: "Maria", teenName: "Ana Souza" })).toBe("enviado");
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "mae@exemplo.com, pai@exemplo.com" }));
  });

  it("extrai o endereço do remetente de EMAIL_FROM", async () => {
    Object.assign(process.env, SMTP);
    const { senderAddress } = await load();
    expect(senderAddress()).toBe("checkin@exemplo.com");
  });
});
