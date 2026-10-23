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
  photo: Buffer;
};

/** Monta o e-mail (função pura, testada sem enviar nada). A foto vai embutida via Content-ID. */
export function buildCheckinEmail(d: CheckinEmailData) {
  const at = new Date(d.checkedInAt);
  const hora = at.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
  const dia = at.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", timeZone: TZ });
  const teen = firstName(d.teenName);
  const guardian = firstName(d.guardianName);
  const cid = "selfie-checkin@flag-o2";

  const subject = `✅ ${teen} chegou ao culto da O2 · Flag (${hora})`;

  const text = [
    `Olá, ${guardian}!`,
    "",
    `${d.teenName} chegou ao culto da Juventude O2 · Ministério Flag e já fez o check-in.`,
    "",
    `Horário do check-in: ${hora} (${dia})`,
    "",
    "A foto tirada no check-in está anexada a este e-mail.",
    "",
    "Ministério Flag · Juventude O2",
    "Você recebe este aviso porque autorizou o cadastro do(a) adolescente no check-in do ministério.",
  ].join("\n");

  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Check-in O2 · Flag</title></head>
<body style="margin:0;padding:0;background:#f3f8fb;font-family:Montserrat,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0d2230">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f8fb;padding:24px 12px;font-family:Montserrat,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:18px;overflow:hidden">
  <tr><td style="background:#008ec3;padding:22px 24px;color:#ffffff">
    <div style="font-size:30px;font-weight:900;letter-spacing:.06em;line-height:1">FLAG</div>
    <div style="font-size:13px;opacity:.9;margin-top:6px;letter-spacing:.04em">Juventude <b>O2</b></div>
  </td></tr>
  <tr><td style="padding:24px">
    <p style="margin:0 0 6px;font-size:15px;color:#5b6b77">Olá, ${esc(guardian)}!</p>
    <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3">${esc(teen)} chegou ao culto e já fez o check-in ✅</h1>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#e6f5fb;border-radius:12px;margin:0 0 18px">
      <tr><td style="padding:14px 16px">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#006a93">Horário do check-in</div>
        <div style="font-size:28px;font-weight:800;margin-top:2px">${esc(hora)}</div>
        <div style="font-size:14px;color:#5b6b77">${esc(dia)}</div>
      </td></tr>
    </table>
    <p style="margin:0 0 8px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#006a93">Foto do check-in</p>
    <img src="cid:${cid}" alt="Foto de ${esc(teen)} no check-in" width="432" style="display:block;width:100%;max-width:432px;height:auto;border-radius:14px;border:0" />
    <p style="margin:18px 0 0;font-size:14px;line-height:1.5;color:#5b6b77">${esc(d.teenName)} está com a gente na Juventude O2 do Ministério Flag. Bom culto! 🙌</p>
  </td></tr>
  <tr><td style="padding:16px 24px;border-top:1px solid #d9e3ea;font-size:12px;line-height:1.5;color:#5b6b77">
    Você recebe este aviso porque autorizou o cadastro do(a) adolescente no check-in do Ministério Flag.
    Dúvidas ou para deixar de receber, fale com a liderança da Juventude O2.
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

  return {
    subject,
    text,
    html,
    attachments: [{ filename: `checkin-${teen.toLowerCase() || "foto"}.jpg`, content: d.photo, contentType: "image/jpeg", cid }],
  };
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

export type CadastroEmailData = { guardianName: string; teenName: string };

/** Confirmação do cadastro feito pelo responsável (função pura). */
export function buildCadastroEmail(d: CadastroEmailData) {
  const teen = firstName(d.teenName);
  const guardian = firstName(d.guardianName);
  const subject = `✅ Cadastro de ${teen} na O2 · Flag confirmado`;
  const text = [
    `Olá, ${guardian}!`,
    "",
    `O cadastro de ${d.teenName} na Juventude O2 · Ministério Flag foi concluído.`,
    "",
    "Como funciona o check-in:",
    "1. No culto, o adolescente abre o check-in pelo QR code e informa nome completo e data de nascimento.",
    "2. No primeiro check-in, tira uma foto do rosto para completar o cadastro.",
    "3. Dentro do culto, tira uma foto criativa, que conclui o check-in.",
    "",
    "A cada check-in você recebe um e-mail com o horário e a foto.",
    "Se este e-mail caiu no spam, marque como \"Não é spam\" para os próximos avisos chegarem na caixa de entrada.",
    "",
    "Ministério Flag · Juventude O2",
  ].join("\n");
  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Cadastro O2 · Flag</title></head>
<body style="margin:0;padding:0;background:#f3f8fb;font-family:Montserrat,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0d2230">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f8fb;padding:24px 12px;font-family:Montserrat,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:18px;overflow:hidden">
  <tr><td style="background:#008ec3;padding:22px 24px;color:#ffffff">
    <div style="font-size:30px;font-weight:900;letter-spacing:.06em;line-height:1">FLAG</div>
    <div style="font-size:13px;opacity:.9;margin-top:6px;letter-spacing:.04em">Juventude <b>O2</b></div>
  </td></tr>
  <tr><td style="padding:24px">
    <p style="margin:0 0 6px;font-size:15px;color:#5b6b77">Olá, ${esc(guardian)}!</p>
    <h1 style="margin:0 0 14px;font-size:22px;line-height:1.3">Cadastro de ${esc(teen)} confirmado ✅</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.5">${esc(d.teenName)} já pode fazer check-in nos cultos da Juventude O2.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#e6f5fb;border-radius:12px;margin:0 0 16px">
      <tr><td style="padding:14px 16px;font-size:14px;line-height:1.6">
        <b>Como funciona o check-in</b><br/>
        1. No culto, o adolescente abre o check-in pelo QR code e informa <b>nome completo</b> e <b>data de nascimento</b>.<br/>
        2. No primeiro check-in, tira uma <b>foto do rosto</b> para completar o cadastro.<br/>
        3. Dentro do culto, tira uma <b>foto criativa</b>, que conclui o check-in.
      </td></tr>
    </table>
    <p style="margin:0 0 12px;font-size:14px;line-height:1.5">A cada check-in você recebe um e-mail com o <b>horário</b> e a <b>foto</b>.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#fff4d6;border-radius:12px">
      <tr><td style="padding:12px 16px;font-size:14px;line-height:1.5;color:#5c3d00">
        📬 Se este e-mail caiu no <b>spam</b>, marque como <b>"Não é spam"</b>: assim os avisos de check-in chegam na caixa de entrada.
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:16px 24px;border-top:1px solid #d9e3ea;font-size:12px;line-height:1.5;color:#5b6b77">
    Você recebe este e-mail porque cadastrou o(a) adolescente no check-in do Ministério Flag.
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
  return { subject, text, html };
}

/** Envia a confirmação do cadastro. Nunca lança erro. */
export async function sendCadastroEmail(recipients: (string | null | undefined)[], d: CadastroEmailData): Promise<EmailStatus> {
  const list = [...new Set(recipients.map((e) => e?.trim().toLowerCase()).filter(Boolean) as string[])];
  if (!list.length) return "sem_email";
  if (!emailConfigured()) return "sem_config";
  try {
    await transport().sendMail({ from: process.env.EMAIL_FROM, to: list.join(", "), ...buildCadastroEmail(d) });
    return "enviado";
  } catch (err) {
    console.error("Falha ao enviar e-mail de cadastro:", err instanceof Error ? err.message : err);
    return "falhou";
  }
}
