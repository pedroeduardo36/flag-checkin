import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db } from "./supabase";
import { PHOTO_BUCKET } from "./env";
import { serviceDate } from "./security";
import { emailConfigured, sendVerificationEmail } from "./email";

/**
 * Responsável e consentimento. O formulário de cadastro é aberto: quem preenche declara ser o
 * responsável, mas isso não prova nada. Por isso o cadastro só vale depois que o DONO do e-mail
 * informado abre o link, lê a explicação e dá o consentimento, incluindo o específico para a
 * biometria facial. Sem isso, o adolescente não faz check-in e o cadastro é apagado no prazo.
 */

/** Versão do texto de consentimento (a página /privacidade e o formulário). Mudou o texto, muda a versão. */
export const CONSENT_VERSION = "2026-10-30";
export const VERIFY_TTL_DAYS = 7;

/** O token só existe no e-mail; o banco guarda o hash (sem chave: o script local gera links que a produção aceita). */
export const verifyTokenHash = (token: string) => createHash("sha256").update(`verificacao:${token}`).digest("hex");

export type ConsentState = {
  guardian_email_verified_at: string | null;
  guardian_email2_verified_at?: string | null;
  biometric_consent_at: string | null;
  consent_version: string | null; // null = consentimento antigo, de antes desta versão
  verify_by: string | null;
};

/** Cadastro antigo (consentimento anterior a esta versão) ainda dentro do prazo para confirmar. */
const inGrace = (m: ConsentState, today: string) =>
  !m.consent_version && !m.guardian_email_verified_at && !!m.verify_by && today <= m.verify_by;

/** O adolescente só faz check-in (e só tem rosto analisado) com consentimento confirmado, ou no prazo de transição. */
export function checkinAllowed(m: ConsentState, today = serviceDate()): boolean {
  return (!!m.guardian_email_verified_at && !!m.biometric_consent_at) || inGrace(m, today);
}

/** Aviso de check-in só para e-mails confirmados (ou do cadastro antigo, até o prazo). */
export function noticeRecipients(
  m: ConsentState & { guardian_email: string | null; guardian_email2: string | null },
  today = serviceDate(),
): string[] {
  const grace = inGrace(m, today);
  return [
    m.guardian_email_verified_at || grace ? m.guardian_email : null,
    m.guardian_email2_verified_at || grace ? m.guardian_email2 : null,
  ].filter((e): e is string => !!e);
}

/** Endereço público do app, para o link do e-mail. */
export function appUrl(req?: Request): string {
  return (process.env.PUBLIC_APP_URL || (req ? new URL(req.url).origin : "http://localhost:3000")).replace(/\/$/, "");
}

type MemberForVerification = {
  id: string;
  name: string;
  guardian_name: string | null;
  guardian_email: string | null;
  guardian_email2: string | null;
  guardian_email_verified_at: string | null;
  guardian_email2_verified_at: string | null;
};

/**
 * Cria um link de uso único (7 dias) para cada e-mail ainda não confirmado e envia.
 * Nunca lança erro: devolve quantos e-mails foram enviados.
 */
export async function sendVerifications(m: MemberForVerification, baseUrl: string): Promise<number> {
  if (!emailConfigured()) return 0;
  const targets = [
    m.guardian_email && !m.guardian_email_verified_at ? { email: m.guardian_email, primary: true } : null,
    m.guardian_email2 && !m.guardian_email2_verified_at ? { email: m.guardian_email2, primary: false } : null,
  ].filter((t): t is { email: string; primary: boolean } => !!t);
  let sent = 0;
  for (const t of targets) {
    const token = randomBytes(32).toString("base64url");
    const { error } = await db().from("guardian_verifications").insert({
      member_id: m.id,
      email: t.email,
      token_hash: verifyTokenHash(token),
      expires_at: new Date(Date.now() + VERIFY_TTL_DAYS * 86400_000).toISOString(),
    });
    if (error) {
      console.error("Falha ao criar link de confirmação:", error.message);
      continue;
    }
    // O token vai no fragmento (#): não aparece em logs de servidor nem no Referer.
    const status = await sendVerificationEmail(t.email, {
      guardianName: m.guardian_name ?? "",
      teenName: m.name,
      link: `${baseUrl}/confirmar#t=${token}`,
      primary: t.primary,
      validDays: VERIFY_TTL_DAYS,
    });
    if (status === "enviado") sent++;
  }
  return sent;
}

/** Apaga o cadastro inteiro: dados, foto de referência, descritor facial, presenças e fotos de check-in. */
export async function deleteMember(id: string): Promise<{ deleted: boolean; photos: number }> {
  const { data: m } = await db().from("members").select("id, photo_path").eq("id", id).maybeSingle();
  if (!m) return { deleted: false, photos: 0 };
  const { data: cks } = await db().from("checkins").select("photo_path").eq("member_id", id);
  const paths = [m.photo_path, ...(cks ?? []).map((c) => c.photo_path)].filter((p): p is string => !!p);
  await db().from("members").update({ possible_duplicate_of: null }).eq("possible_duplicate_of", id);
  const del = await db().from("members").delete().eq("id", id);
  if (del.error) throw del.error;
  if (paths.length) await db().storage.from(PHOTO_BUCKET).remove(paths);
  return { deleted: true, photos: paths.length };
}

/**
 * Retira a biometria: apaga a foto de referência e o descritor. O cadastro volta a "aguardando
 * confirmação": sem novo consentimento em 7 dias, é apagado. Um novo link pode ser reenviado.
 */
export async function revokeBiometrics(id: string): Promise<boolean> {
  const { data: m } = await db().from("members").select("photo_path").eq("id", id).maybeSingle();
  if (!m) return false;
  const upd = await db()
    .from("members")
    .update({
      photo_path: null,
      face_descriptor: null,
      biometric_consent_at: null,
      guardian_email_verified_at: null,
      consent_version: CONSENT_VERSION,
      verify_by: serviceDate(new Date(Date.now() + VERIFY_TTL_DAYS * 86400_000)),
    })
    .eq("id", id);
  if (upd.error) throw upd.error;
  if (m.photo_path) await db().storage.from(PHOTO_BUCKET).remove([m.photo_path]);
  return true;
}
