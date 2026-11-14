import { withErrors } from "@/lib/server/http";
import { NextResponse, after } from "next/server";
import { db } from "@/lib/server/supabase";
import { emailConfigured, sendRegistrationEmail, senderAddress } from "@/lib/server/email";
import { isValidBirthDate, isValidEmail, isValidPhone, nameTokens, onlyDigits } from "@/lib/format";
import { findDuplicate } from "@/lib/duplicates";

const clean = (v: unknown, max = 120) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);

type Registration = {
  name: string; phone: string | null; birth_date: string; guardian_name: string; guardian_phone: string;
  guardian_email: string; guardian_email2: string | null;
};

/**
 * Decides "new / possible duplicate / resubmission" from the same-day registrations, then inserts through
 * cadastrar_membro(), which refuses (40001) if a same-day registration appeared after this read. Two
 * simultaneous submissions therefore never both insert unflagged: the second one reads again and becomes
 * a resubmission (nothing stored) or a flagged possible duplicate.
 */
async function register(data: Registration, attempts = 3): Promise<"created" | "resubmission"> {
  for (let attempt = 1; ; attempt++) {
    const { data: sameDay, error: findError } = await db()
      .from("members")
      .select("id, name, guardian_email, guardian_email2, created_at")
      .eq("birth_date", data.birth_date)
      .order("created_at");
    if (findError) throw findError;
    const match = findDuplicate(data, sameDay ?? []);
    if (match?.resubmission) return "resubmission";

    const { error } = await db().rpc("cadastrar_membro", {
      p_dados: data,
      p_vistos: (sameDay ?? []).map((m) => m.id),
      p_duplicado_de: match?.id ?? null,
    });
    if (!error) return "created";
    if (error.code !== "40001" || attempt >= attempts) throw error;
  }
}

/**
 * Registration made by the GUARDIAN before the service (/cadastro page) or by the pastor.
 * No photo and no door-keeper password: the reference photo is taken at the first check-in.
 * No CPF: check-in uses name + birth date, and attendances point to the registration's internal id.
 * A registration similar to an existing one is stored flagged as a "possible duplicate" for a leader to review.
 */
export const POST = withErrors(async (req: Request) => {
  const b = await req.json().catch(() => null);
  if (!b) return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  // Field invisible to people: only bots fill it in.
  if (b.website) return NextResponse.json({ ok: true });

  const data = {
    name: clean(b.name),
    phone: onlyDigits(b.phone) || null,
    birth_date: String(b.birthDate ?? ""),
    guardian_name: clean(b.guardianName),
    guardian_phone: onlyDigits(b.guardianPhone),
    guardian_email: String(b.guardianEmail ?? "").trim().toLowerCase(),
    guardian_email2: String(b.guardianEmail2 ?? "").trim().toLowerCase() || null,
  };

  const errors: Record<string, string> = {};
  if (nameTokens(data.name).length < 2) errors.name = "Informe nome e sobrenome do adolescente.";
  if (data.phone && !isValidPhone(data.phone)) errors.phone = "Telefone do adolescente inválido.";
  if (!isValidBirthDate(data.birth_date)) errors.birthDate = "Data de nascimento inválida.";
  if (nameTokens(data.guardian_name).length < 2) errors.guardianName = "Informe seu nome e sobrenome.";
  if (!isValidPhone(data.guardian_phone)) errors.guardianPhone = "Seu telefone está inválido.";
  if (!isValidEmail(data.guardian_email)) errors.guardianEmail = "Seu e-mail está inválido.";
  if (data.guardian_email2 && !isValidEmail(data.guardian_email2)) errors.guardianEmail2 = "O segundo e-mail está inválido.";
  else if (data.guardian_email2 && data.guardian_email2 === data.guardian_email) errors.guardianEmail2 = "Use um e-mail diferente do primeiro.";
  if (b.consent !== true) errors.consent = "É preciso autorizar o uso dos dados.";
  if (Object.keys(errors).length)
    return NextResponse.json({ error: "Corrija os campos destacados.", errors }, { status: 400 });

  // A resubmission by the same guardian stores nothing, but gets the same response and email as a new
  // registration, so the form doesn't reveal whether someone is already registered.
  await register(data);
  // Confirmation email after the response: the guardian can already check their spam folder.
  after(() => sendRegistrationEmail([data.guardian_email, data.guardian_email2], { guardianName: data.guardian_name, teenName: data.name }));

  return NextResponse.json({ ok: true, confirmationSent: emailConfigured(), sender: senderAddress() });
});
