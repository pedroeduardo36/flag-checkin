import { NextResponse } from "next/server";
import { withErrors } from "@/lib/server/http";
import { db } from "@/lib/server/supabase";
import { CONSENT_VERSION, deleteMember, verifyTokenHash } from "@/lib/server/guardian";
import { adminAudit } from "@/lib/server/leader";
import { firstName } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Link from the confirmation email (/confirmar page). The token proves whoever is here reads that inbox.
 *   { token, action: "ver" }        → the teen's first name and the link type
 *   { token, action: "confirmar" }  → primary email: requires consent and consentBiometric
 *   { token, action: "recusar" }    → primary: deletes the registration; second email: removes that email from it
 * The link is single-use and valid for 7 days.
 */
export const POST = withErrors(async (req: Request) => {
  const b = await req.json().catch(() => null);
  const token = String(b?.token ?? "");
  const action = String(b?.action ?? "ver");
  const invalid = () =>
    NextResponse.json({ error: "Este link não vale mais. Ele pode ter expirado ou já ter sido usado. Peça um novo a um líder da O2.", code: "LINK_INVALIDO" }, { status: 404 });
  if (token.length < 20 || !["ver", "confirmar", "recusar"].includes(action)) return invalid();

  const { data: v, error } = await db()
    .from("guardian_verifications")
    .select("id, member_id, email, expires_at, used_at, members(id, name, guardian_name, guardian_email, guardian_email2)")
    .eq("token_hash", verifyTokenHash(token))
    .maybeSingle();
  if (error) throw error;
  const m = v && (Array.isArray(v.members) ? v.members[0] : v.members);
  if (!v || !m || v.used_at || Date.parse(v.expires_at) < Date.now()) return invalid();
  const primary = v.email === m.guardian_email;
  if (!primary && v.email !== m.guardian_email2) return invalid(); // the registration's email changed after the link was sent

  if (action === "ver")
    return NextResponse.json({ teenFirstName: firstName(m.name), guardianFirstName: firstName(m.guardian_name ?? ""), primary });

  // Mark the link as used before acting: two simultaneous clicks don't run the action twice.
  const { data: claimed } = await db()
    .from("guardian_verifications")
    .update({ used_at: new Date().toISOString() })
    .eq("id", v.id)
    .is("used_at", null)
    .select("id");
  if (!claimed?.length) return invalid();

  const now = new Date().toISOString();
  if (action === "recusar") {
    if (primary) {
      await deleteMember(m.id);
      await adminAudit(req, { action: "cadastro_apagado", outcome: "ok", targetType: "cadastro", targetId: m.id, details: { origem: "responsavel_recusou" } });
    } else {
      const upd = await db().from("members").update({ guardian_email2: null, guardian_email2_verified_at: null }).eq("id", m.id);
      if (upd.error) throw upd.error;
    }
    return NextResponse.json({ ok: true, removed: primary ? "cadastro" : "email" });
  }

  if (primary) {
    if (b?.consent !== true || b?.consentBiometric !== true) {
      await db().from("guardian_verifications").update({ used_at: null }).eq("id", v.id); // devolve o link
      return NextResponse.json({ error: "Marque as duas autorizações para confirmar, ou escolha não autorizar.", code: "SEM_CONSENTIMENTO" }, { status: 400 });
    }
    const upd = await db()
      .from("members")
      .update({ guardian_email_verified_at: now, guardian_consent_at: now, biometric_consent_at: now, consent_version: CONSENT_VERSION, verify_by: null })
      .eq("id", m.id);
    if (upd.error) throw upd.error;
    // Consent record (no name: the id is enough to prove when and under which version it was given).
    await adminAudit(req, { action: "consentimento_registrado", outcome: "ok", targetType: "cadastro", targetId: m.id, details: { versao: CONSENT_VERSION } });
  } else {
    const upd = await db().from("members").update({ guardian_email2_verified_at: now }).eq("id", m.id);
    if (upd.error) throw upd.error;
  }
  return NextResponse.json({ ok: true, teenFirstName: firstName(m.name), primary });
});
