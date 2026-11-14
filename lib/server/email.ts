import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { firstName } from "@/lib/format";

/**
 * Guardian notices by email over SMTP (Gmail, Brevo, Resend… any SMTP provider).
 * Variables: SMTP_HOST, SMTP_PORT (465 = SSL, 587 = STARTTLS), SMTP_USER, SMTP_PASS, EMAIL_FROM.
 * Email copy is written for Brazilian families, so it stays in Portuguese.
 */

/** Stored as-is in the *_email_status columns. */
export type EmailStatus = "enviado" | "falhou" | "sem_email" | "sem_config" | "desligado";

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

/** Shared email frame (brand header and footer). */
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
 * Check-in notice (pure function, tested without sending anything). TEXT ONLY: the creative photo may
 * show other teens, so it never leaves the app by email. Leaders see it in the feed; it's deleted after 30 days.
 */
export function buildCheckinEmail(d: CheckinEmailData) {
  const at = new Date(d.checkedInAt);
  const time = at.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
  const day = at.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", timeZone: TZ });
  const teen = firstName(d.teenName);
  const guardian = firstName(d.guardianName);

  const subject = `✅ ${teen} chegou ao culto da O2 · Flag (${time})`;
  const footer = "Você recebe este aviso porque confirmou o cadastro do(a) adolescente no check-in do Ministério Flag.";

  const text = [
    `Olá, ${guardian}!`,
    "",
    `${d.teenName} chegou ao culto da Juventude O2 · Ministério Flag e já fez o check-in.`,
    "",
    `Horário do check-in: ${time} (${day})`,
    "",
    "Ministério Flag · Juventude O2",
    footer,
    "Para deixar de receber ou pedir a exclusão dos dados, responda a este e-mail ou fale com a liderança da O2.",
  ].join("\n");

  const html = layout(
    "Check-in O2 · Flag",
    `<p style="margin:0 0 6px;font-size:15px;color:#5b6b77">Olá, ${esc(guardian)}!</p>
    <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3">${esc(teen)} chegou ao culto e já fez o check-in ✅</h1>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#e6f5fb;border-radius:12px;margin:0 0 18px">
      <tr><td style="padding:14px 16px">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#006a93">Horário do check-in</div>
        <div style="font-size:28px;font-weight:800;margin-top:2px">${esc(time)}</div>
        <div style="font-size:14px;color:#5b6b77">${esc(day)}</div>
      </td></tr>
    </table>
    <p style="margin:0;font-size:14px;line-height:1.5;color:#5b6b77">${esc(d.teenName)} está com a gente na Juventude O2 do Ministério Flag. Bom culto! 🙌</p>`,
    `${footer} Para deixar de receber ou pedir a exclusão dos dados, responda a este e-mail ou fale com a liderança da Juventude O2.`,
  );

  return { subject, text, html };
}

/** The guardian's emails, without duplicates or blanks. */
function recipientList(recipients: string | null | undefined | (string | null | undefined)[]): string[] {
  return [...new Set((Array.isArray(recipients) ? recipients : [recipients]).map((e) => e?.trim().toLowerCase()).filter(Boolean) as string[])];
}

/** Sends a notice (all recipients on one message). Never throws: returns the status to store. */
async function sendNotice(
  recipients: string | null | undefined | (string | null | undefined)[],
  message: { subject: string; text: string; html: string },
  kind: string,
): Promise<EmailStatus> {
  const list = recipientList(recipients);
  if (!list.length) return "sem_email";
  if (!emailConfigured()) return "sem_config";
  try {
    await transport().sendMail({ from: process.env.EMAIL_FROM, to: list.join(", "), ...message });
    return "enviado";
  } catch (err) {
    console.error(`Failed to send ${kind} email:`, err instanceof Error ? err.message : err);
    return "falhou";
  }
}

/** Sends the check-in notice to one or more of the guardian's emails. */
export const sendCheckinEmail = (
  recipients: string | null | undefined | (string | null | undefined)[],
  d: CheckinEmailData,
) => sendNotice(recipients, buildCheckinEmail(d), "check-in");

export type CheckoutEmailData = {
  guardianName: string;
  teenName: string;
  checkedOutAt: string | Date;
  /** "lider": a leader recorded the checkout (the teen forgot to confirm it). */
  by: "participante" | "lider";
};

/** Checkout notice (pure function). Text only, like the check-in notice. */
export function buildCheckoutEmail(d: CheckoutEmailData) {
  const at = new Date(d.checkedOutAt);
  const time = at.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
  const day = at.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", timeZone: TZ });
  const teen = firstName(d.teenName);
  const guardian = firstName(d.guardianName);
  const who = d.by === "lider"
    ? `A saída de ${d.teenName} foi registrada por um líder da O2.`
    : `${d.teenName} confirmou a saída pelo celular.`;

  const subject = `👋 ${teen} saiu do culto da O2 · Flag (${time})`;
  const footer = "Você recebe este aviso porque confirmou o cadastro do(a) adolescente no check-in do Ministério Flag.";

  const text = [
    `Olá, ${guardian}!`,
    "",
    who,
    "",
    `Horário da saída: ${time} (${day})`,
    "",
    "Ministério Flag · Juventude O2",
    footer,
    "Para deixar de receber ou pedir a exclusão dos dados, responda a este e-mail ou fale com a liderança da O2.",
  ].join("\n");

  const html = layout(
    "Saída O2 · Flag",
    `<p style="margin:0 0 6px;font-size:15px;color:#5b6b77">Olá, ${esc(guardian)}!</p>
    <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3">${esc(teen)} saiu do culto 👋</h1>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#e6f5fb;border-radius:12px;margin:0 0 18px">
      <tr><td style="padding:14px 16px">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#006a93">Horário da saída</div>
        <div style="font-size:28px;font-weight:800;margin-top:2px">${esc(time)}</div>
        <div style="font-size:14px;color:#5b6b77">${esc(day)}</div>
      </td></tr>
    </table>
    <p style="margin:0;font-size:14px;line-height:1.5;color:#5b6b77">${esc(who)}</p>`,
    `${footer} Para deixar de receber ou pedir a exclusão dos dados, responda a este e-mail ou fale com a liderança da Juventude O2.`,
  );

  return { subject, text, html };
}

/** Checkout notice. CHECKOUT_NOTICE=false turns it off (the time is still stored and visible to leaders). */
export function sendCheckoutEmail(
  recipients: string | null | undefined | (string | null | undefined)[],
  d: CheckoutEmailData,
): Promise<EmailStatus> {
  if (process.env.CHECKOUT_NOTICE === "false") return Promise.resolve("desligado");
  return sendNotice(recipients, buildCheckoutEmail(d), "checkout");
}

/** Sender address (from EMAIL_FROM), so the guardian knows who the email will come from. */
export function senderAddress(): string | null {
  const from = process.env.EMAIL_FROM ?? "";
  return /<([^>]+)>/.exec(from)?.[1] ?? (from.includes("@") ? from.trim() : null);
}

export type VerificationEmailData = {
  guardianName: string;
  teenName: string;
  link: string;
  /** true: primary email (gives consent). false: second email (only confirms it wants the notices). */
  primary: boolean;
  validDays: number;
};

/** Registration confirmation request (pure function). Without confirmation there's no check-in and the registration is deleted. */
export function buildVerificationEmail(d: VerificationEmailData) {
  const teen = firstName(d.teenName);
  const guardian = firstName(d.guardianName);
  const subject = d.primary ? `Confirme o cadastro de ${teen} na O2 · Flag` : `Confirme este e-mail para os avisos de ${teen} na O2 · Flag`;
  const intro = d.primary
    ? `Recebemos o cadastro de ${d.teenName} no check-in da Juventude O2 · Ministério Flag, com este e-mail como contato do responsável.`
    : `${d.guardianName || "O responsável"} cadastrou ${d.teenName} no check-in da Juventude O2 · Ministério Flag e indicou este e-mail para receber os avisos de check-in.`;
  const ask = d.primary
    ? "Abra o link, leia como usamos os dados (inclusive o reconhecimento facial) e confirme. Só depois disso o check-in funciona."
    : "Abra o link para confirmar que quer receber os avisos.";
  const ignore = d.primary
    ? `Se não foi você, ignore: sem confirmação, o cadastro é apagado em ${d.validDays} dias.`
    : `Se não foi você, ignore: este e-mail não recebe nenhum aviso sem confirmação.`;

  const text = [
    `Olá${d.primary && guardian ? `, ${guardian}` : ""}!`,
    "",
    intro,
    "",
    ask,
    d.link,
    `O link vale ${d.validDays} dias e funciona uma vez.`,
    "",
    ignore,
    "",
    "Ministério Flag · Juventude O2",
  ].join("\n");

  const html = layout(
    "Cadastro O2 · Flag",
    `<p style="margin:0 0 6px;font-size:15px;color:#5b6b77">Olá${d.primary && guardian ? `, ${esc(guardian)}` : ""}!</p>
    <h1 style="margin:0 0 14px;font-size:22px;line-height:1.3">${esc(subject)}</h1>
    <p style="margin:0 0 12px;font-size:15px;line-height:1.5">${esc(intro)}</p>
    <p style="margin:0 0 18px;font-size:15px;line-height:1.5">${esc(ask)}</p>
    <a href="${esc(d.link)}" style="display:inline-block;background:#008ec3;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px">${d.primary ? "Ler e confirmar o cadastro" : "Confirmar este e-mail"}</a>
    <p style="margin:18px 0 0;font-size:13px;line-height:1.5;color:#5b6b77">O link vale ${d.validDays} dias e funciona uma vez. ${esc(ignore)}</p>`,
    "Este e-mail foi enviado porque alguém informou este endereço no cadastro do check-in do Ministério Flag.",
  );
  return { subject, text, html };
}

/** Sends the confirmation request. Never throws. */
export async function sendVerificationEmail(to: string, d: VerificationEmailData): Promise<EmailStatus> {
  if (!to) return "sem_email";
  if (!emailConfigured()) return "sem_config";
  try {
    await transport().sendMail({ from: process.env.EMAIL_FROM, to, ...buildVerificationEmail(d) });
    return "enviado";
  } catch (err) {
    console.error("Failed to send confirmation email:", err instanceof Error ? err.message : err);
    return "falhou";
  }
}
