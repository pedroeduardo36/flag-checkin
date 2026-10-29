import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { firstName } from "@/lib/format";

/**
 * Aviso ao responsável por e-mail via SMTP (Gmail, Brevo, Resend… qualquer provedor SMTP).
 * Variáveis: SMTP_HOST, SMTP_PORT (465 = SSL, 587 = STARTTLS), SMTP_USER, SMTP_PASS, EMAIL_FROM.
 */

export type EmailStatus = "enviado" | "falhou" | "sem_email" | "sem_config";

export function emailConfigured(): boolean {
  return ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "EMAIL_FROM"].every((k) => !!process.env[k]);
}

let transporter: Transporter | null = null;
function transport(): Transporter {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT ?? 465);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }
  return transporter;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const TZ = "America/Sao_Paulo";

export type CheckinEmailData = {
  guardianName: string;
  teenName: string;
  checkedInAt: string | Date;
};

/** Moldura comum dos e-mails (cabeçalho da marca e rodapé). */
function layout(title: string, body: string, footer: string) {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f3f8fb;font-family:Montserrat,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0d2230">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f8fb;padding:24px 12px;font-family:Montserrat,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:18px;overflow:hidden">
  <tr><td style="background:#008ec3;padding:22px 24px;color:#ffffff">
    <div style="font-size:30px;font-weight:900;letter-spacing:.06em;line-height:1">FLAG</div>
    <div style="font-size:13px;opacity:.9;margin-top:6px;letter-spacing:.04em">Juventude <b>O2</b></div>
  </td></tr>
  <tr><td style="padding:24px">${body}</td></tr>
  <tr><td style="padding:16px 24px;border-top:1px solid #d9e3ea;font-size:12px;line-height:1.5;color:#5b6b77">${footer}</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

/**
 * Aviso de check-in (função pura, testada sem enviar nada). SÓ TEXTO: a foto criativa pode ter outros
 * adolescentes e não sai do app por e-mail. Os líderes veem a foto no feed; ela é apagada em 30 dias.
 */
export function buildCheckinEmail(d: CheckinEmailData) {
  const at = new Date(d.checkedInAt);
  const hora = at.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
  const dia = at.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", timeZone: TZ });
  const teen = firstName(d.teenName);
  const guardian = firstName(d.guardianName);

  const subject = `✅ ${teen} chegou ao culto da O2 · Flag (${hora})`;
  const rodape = "Você recebe este aviso porque confirmou o cadastro do(a) adolescente no check-in do Ministério Flag.";

  const text = [
    `Olá, ${guardian}!`,
    "",
    `${d.teenName} chegou ao culto da Juventude O2 · Ministério Flag e já fez o check-in.`,
    "",
    `Horário do check-in: ${hora} (${dia})`,
    "",
    "Ministério Flag · Juventude O2",
    rodape,
    "Para deixar de receber ou pedir a exclusão dos dados, responda a este e-mail ou fale com a liderança da O2.",
  ].join("\n");

  const html = layout(
    "Check-in O2 · Flag",
    `<p style="margin:0 0 6px;font-size:15px;color:#5b6b77">Olá, ${esc(guardian)}!</p>
    <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3">${esc(teen)} chegou ao culto e já fez o check-in ✅</h1>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#e6f5fb;border-radius:12px;margin:0 0 18px">
      <tr><td style="padding:14px 16px">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#006a93">Horário do check-in</div>
        <div style="font-size:28px;font-weight:800;margin-top:2px">${esc(hora)}</div>
        <div style="font-size:14px;color:#5b6b77">${esc(dia)}</div>
      </td></tr>
    </table>
    <p style="margin:0;font-size:14px;line-height:1.5;color:#5b6b77">${esc(d.teenName)} está com a gente na Juventude O2 do Ministério Flag. Bom culto! 🙌</p>`,
    `${rodape} Para deixar de receber ou pedir a exclusão dos dados, responda a este e-mail ou fale com a liderança da Juventude O2.`,
  );

  return { subject, text, html };
}

/**
 * Envia o aviso para um ou mais e-mails do responsável (todos na mesma mensagem).
 * Nunca lança erro: devolve o status para gravar no check-in.
 */
export async function sendCheckinEmail(
  recipients: string | null | undefined | (string | null | undefined)[],
  d: CheckinEmailData,
): Promise<EmailStatus> {
  const list = [...new Set((Array.isArray(recipients) ? recipients : [recipients]).map((e) => e?.trim().toLowerCase()).filter(Boolean) as string[])];
  if (!list.length) return "sem_email";
  const to = list.join(", ");
  if (!emailConfigured()) return "sem_config";
  try {
    await transport().sendMail({ from: process.env.EMAIL_FROM, to, ...buildCheckinEmail(d) });
    return "enviado";
  } catch (err) {
    console.error("Falha ao enviar e-mail de check-in:", err instanceof Error ? err.message : err);
    return "falhou";
  }
}

/** Endereço do remetente (de EMAIL_FROM), para avisar o responsável de quem esperar o e-mail. */
export function senderAddress(): string | null {
  const from = process.env.EMAIL_FROM ?? "";
  return /<([^>]+)>/.exec(from)?.[1] ?? (from.includes("@") ? from.trim() : null);
}

export type VerificationEmailData = {
  guardianName: string;
  teenName: string;
  link: string;
  /** true: e-mail principal (dá o consentimento). false: segundo e-mail (só confirma que quer os avisos). */
  primary: boolean;
  validDays: number;
};

/** Pedido de confirmação do cadastro (função pura). Sem confirmar, não há check-in e o cadastro é apagado. */
export function buildVerificationEmail(d: VerificationEmailData) {
  const teen = firstName(d.teenName);
  const guardian = firstName(d.guardianName);
  const subject = d.primary ? `Confirme o cadastro de ${teen} na O2 · Flag` : `Confirme este e-mail para os avisos de ${teen} na O2 · Flag`;
  const intro = d.primary
    ? `Recebemos o cadastro de ${d.teenName} no check-in da Juventude O2 · Ministério Flag, com este e-mail como contato do responsável.`
    : `${d.guardianName || "O responsável"} cadastrou ${d.teenName} no check-in da Juventude O2 · Ministério Flag e indicou este e-mail para receber os avisos de check-in.`;
  const pedido = d.primary
    ? "Abra o link, leia como usamos os dados (inclusive o reconhecimento facial) e confirme. Só depois disso o check-in funciona."
    : "Abra o link para confirmar que quer receber os avisos.";
  const ignorar = d.primary
    ? `Se não foi você, ignore: sem confirmação, o cadastro é apagado em ${d.validDays} dias.`
    : `Se não foi você, ignore: este e-mail não recebe nenhum aviso sem confirmação.`;

  const text = [
    `Olá${d.primary && guardian ? `, ${guardian}` : ""}!`,
    "",
    intro,
    "",
    pedido,
    d.link,
    `O link vale ${d.validDays} dias e funciona uma vez.`,
    "",
    ignorar,
    "",
    "Ministério Flag · Juventude O2",
  ].join("\n");

  const html = layout(
    "Cadastro O2 · Flag",
    `<p style="margin:0 0 6px;font-size:15px;color:#5b6b77">Olá${d.primary && guardian ? `, ${esc(guardian)}` : ""}!</p>
    <h1 style="margin:0 0 14px;font-size:22px;line-height:1.3">${esc(subject)}</h1>
    <p style="margin:0 0 12px;font-size:15px;line-height:1.5">${esc(intro)}</p>
    <p style="margin:0 0 18px;font-size:15px;line-height:1.5">${esc(pedido)}</p>
    <a href="${esc(d.link)}" style="display:inline-block;background:#008ec3;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px">${d.primary ? "Ler e confirmar o cadastro" : "Confirmar este e-mail"}</a>
    <p style="margin:18px 0 0;font-size:13px;line-height:1.5;color:#5b6b77">O link vale ${d.validDays} dias e funciona uma vez. ${esc(ignorar)}</p>`,
    "Este e-mail foi enviado porque alguém informou este endereço no cadastro do check-in do Ministério Flag.",
  );
  return { subject, text, html };
}

/** Envia o pedido de confirmação. Nunca lança erro. */
export async function sendVerificationEmail(to: string, d: VerificationEmailData): Promise<EmailStatus> {
  if (!to) return "sem_email";
  if (!emailConfigured()) return "sem_config";
  try {
    await transport().sendMail({ from: process.env.EMAIL_FROM, to, ...buildVerificationEmail(d) });
    return "enviado";
  } catch (err) {
    console.error("Falha ao enviar e-mail de confirmação:", err instanceof Error ? err.message : err);
    return "falhou";
  }
}
