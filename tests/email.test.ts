import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMail = vi.fn();
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail }) } }));

const SMTP = { SMTP_HOST: "smtp.exemplo.com", SMTP_USER: "user", SMTP_PASS: "pass", EMAIL_FROM: "Check-in O2 <checkin@exemplo.com>" };
const dados = {
  guardianName: "Maria Souza",
  teenName: "Ana <b>Beatriz</b> Souza",
  checkedInAt: "2026-10-18T22:47:00Z", // 19:47 em Brasília
};

beforeEach(() => {
  vi.resetModules();
  sendMail.mockReset();
  for (const k of Object.keys(SMTP)) delete process.env[k];
});
afterEach(() => vi.restoreAllMocks());
const load = () => import("@/lib/server/email");

describe("modelo do e-mail de check-in", () => {
  it("traz nome e horário de Brasília, SÓ TEXTO: nenhuma foto sai por e-mail", async () => {
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

describe("e-mail de confirmação do cadastro (verificação do responsável)", () => {
  const base = { guardianName: "Maria Souza", teenName: "Ana <i>Beatriz</i> Souza", link: "https://app.exemplo/confirmar#t=abc", validDays: 7 };

  it("e-mail principal: pede para ler e confirmar, explica o prazo e escapa HTML", async () => {
    const { buildVerificationEmail } = await load();
    const e = buildVerificationEmail({ ...base, primary: true });
    expect(e.subject).toBe("Confirme o cadastro de Ana na O2 · Flag");
    expect(e.text).toContain("reconhecimento facial");
    expect(e.text).toContain("https://app.exemplo/confirmar#t=abc");
    expect(e.text).toContain("apagado em 7 dias");
    expect(e.html).toContain('href="https://app.exemplo/confirmar#t=abc"');
    expect(e.html).not.toContain("<i>Beatriz</i>");
  });

  it("segundo e-mail: só confirma que quer os avisos", async () => {
    const { buildVerificationEmail } = await load();
    const e = buildVerificationEmail({ ...base, primary: false });
    expect(e.subject).toContain("Confirme este e-mail");
    expect(e.text).toContain("indicou este e-mail");
  });

  it("envia para um endereço por vez (cada um tem o próprio link)", async () => {
    Object.assign(process.env, SMTP);
    sendMail.mockResolvedValue({ messageId: "1" });
    const { sendVerificationEmail } = await load();
    expect(await sendVerificationEmail("mae@exemplo.com", { ...base, primary: true })).toBe("enviado");
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "mae@exemplo.com" }));
  });

  it("extrai o endereço do remetente de EMAIL_FROM", async () => {
    Object.assign(process.env, SMTP);
    const { senderAddress } = await load();
    expect(senderAddress()).toBe("checkin@exemplo.com");
  });
});

describe("aviso de saída", () => {
  const saida = { guardianName: "Maria Souza", teenName: "Ana <b>Beatriz</b> Souza", checkedOutAt: "2026-10-19T00:15:00Z", by: "participante" as const };

  it("só texto, com o horário de Brasília e quem confirmou", async () => {
    const { buildCheckoutEmail } = await load();
    const e = buildCheckoutEmail(saida);
    expect(e.subject).toContain("saiu do culto");
    expect(e.subject).toContain("21:15");
    expect(e.text).toContain("Horário da saída: 21:15");
    expect(e.text).toContain("confirmou a saída pelo celular");
    expect(e.html).not.toMatch(/<img|cid:/);
    expect(e.html).toContain("&lt;b&gt;Beatriz&lt;/b&gt;");
    expect(buildCheckoutEmail({ ...saida, by: "lider" }).text).toContain("registrada por um líder");
  });

  it("CHECKOUT_NOTICE=false desliga o aviso de saída", async () => {
    Object.assign(process.env, SMTP, { CHECKOUT_NOTICE: "false" });
    const { sendCheckoutEmail } = await load();
    expect(await sendCheckoutEmail("mae@exemplo.com", saida)).toBe("desligado");
    expect(sendMail).not.toHaveBeenCalled();
    delete process.env.CHECKOUT_NOTICE;
  });

  it("configurado → envia para os e-mails do responsável", async () => {
    Object.assign(process.env, SMTP);
    sendMail.mockResolvedValue({ messageId: "1" });
    const { sendCheckoutEmail } = await load();
    expect(await sendCheckoutEmail(["mae@exemplo.com", "MAE@exemplo.com", null], saida)).toBe("enviado");
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "mae@exemplo.com" }));
  });
});
