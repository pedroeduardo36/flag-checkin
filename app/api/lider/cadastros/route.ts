import { NextResponse } from "next/server";
import { withErrors } from "@/lib/server/http";
import { db } from "@/lib/server/supabase";
import { adminAudit, requireLeader, unauthorized } from "@/lib/server/leader";
import { CONSENT_VERSION, appUrl, checkinAllowed, deleteMember, revokeBiometrics, sendVerifications } from "@/lib/server/guardian";
import { nameMatchScore, nameTokens } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Pedidos das famílias (docs/privacidade/pedidos-das-familias.md), atendidos por um líder logado:
 *   GET ?q=nome            → busca (até 20) · GET ?pendentes=1 → aguardando confirmação do responsável
 *   GET ?exportar=<id>     → todos os dados do cadastro em JSON (pedido de acesso)
 *   PATCH { id, action }   → reenviar (novo link de confirmação) | revogar_biometria
 *   DELETE { id, reason }  → apaga o cadastro inteiro (exclusão ou retirada do consentimento)
 * Tudo vai para o registro de ações, sem o nome do adolescente (o id basta).
 */

const LIST_COLS =
  "id, name, birth_date, guardian_name, created_at, guardian_email_verified_at, biometric_consent_at, consent_version, verify_by, face_descriptor";

type Row = {
  id: string; name: string; birth_date: string; guardian_name: string | null; created_at: string;
  guardian_email_verified_at: string | null; biometric_consent_at: string | null; consent_version: string | null;
  verify_by: string | null; face_descriptor: unknown;
};

const view = (m: Row) => ({
  id: m.id,
  name: m.name,
  birthDate: m.birth_date,
  guardianName: m.guardian_name,
  createdAt: m.created_at,
  confirmed: !!m.guardian_email_verified_at && !!m.biometric_consent_at,
  canCheckin: checkinAllowed(m),
  legacy: !m.consent_version,
  confirmBy: m.guardian_email_verified_at ? null : m.verify_by ?? new Date(Date.parse(m.created_at) + 7 * 86400_000).toISOString().slice(0, 10),
  hasBiometrics: !!m.face_descriptor,
});

export const GET = withErrors(async (req: Request) => {
  const s = await requireLeader(req);
  if (!s) return unauthorized();
  const url = new URL(req.url);
  const noStore = { headers: { "Cache-Control": "no-store" } };

  const exportId = url.searchParams.get("exportar");
  if (exportId) {
    const { data: m, error } = await db().from("members").select("*").eq("id", exportId).maybeSingle();
    if (error) throw error;
    if (!m) return NextResponse.json({ error: "Cadastro não encontrado." }, { status: 404 });
    const { data: cks } = await db()
      .from("checkins")
      .select("service_date, checked_in_at, distance_m, photo_kind, photo_path, guardian_email_status")
      .eq("member_id", exportId)
      .order("service_date");
    const { face_descriptor, photo_path, possible_duplicate_of, ...dados } = m;
    await adminAudit(req, { actor: s.leader, action: "dados_exportados", outcome: "ok", targetType: "cadastro", targetId: exportId });
    return NextResponse.json(
      {
        geradoEm: new Date().toISOString(),
        observacao:
          "Cópia dos dados do cadastro para o responsável. Os dados do rosto (128 números) existem só para o reconhecimento facial; as fotos podem ser enviadas à parte pela liderança.",
        cadastro: dados,
        biometria: { fotoDeRegistro: !!photo_path, dadosDoRosto: Array.isArray(face_descriptor) || !!face_descriptor },
        presencas: (cks ?? []).map(({ photo_path: p, ...c }) => ({ ...c, foto: !!p })),
      },
      noStore,
    );
  }

  if (url.searchParams.get("pendentes")) {
    const { data, error } = await db().from("members").select(LIST_COLS).is("guardian_email_verified_at", null).order("created_at").limit(200);
    if (error) throw error;
    return NextResponse.json({ items: (data as Row[]).map(view) }, noStore);
  }

  const q = String(url.searchParams.get("q") ?? "").trim().slice(0, 80);
  if (nameTokens(q).length < 1) return NextResponse.json({ items: [] }, noStore);
  const first = nameTokens(q)[0];
  // Poucas centenas de cadastros: a comparação de nomes (sem acento, "de/da") é feita aqui, não no banco.
  const { data, error } = await db().from("members").select(LIST_COLS).limit(5000);
  if (error) throw error;
  const items = (data as Row[])
    .map((m) => ({ m, score: nameTokens(q).length > 1 ? Math.max(nameMatchScore(q, m.name), nameMatchScore(m.name, q)) : nameTokens(m.name).some((t) => t.startsWith(first)) ? 1 : 0 }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.m.name.localeCompare(b.m.name))
    .slice(0, 20)
    .map((x) => view(x.m));
  return NextResponse.json({ items }, noStore);
});

export const PATCH = withErrors(async (req: Request) => {
  const s = await requireLeader(req);
  if (!s) return unauthorized();
  const b = await req.json().catch(() => null);
  if (typeof b?.id !== "string" || !["reenviar", "revogar_biometria"].includes(b?.action))
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });

  if (b.action === "revogar_biometria") {
    if (!(await revokeBiometrics(b.id))) return NextResponse.json({ error: "Cadastro não encontrado." }, { status: 404 });
    await adminAudit(req, { actor: s.leader, action: "biometria_revogada", outcome: "ok", targetType: "cadastro", targetId: b.id, details: { versao: CONSENT_VERSION } });
    return NextResponse.json({ ok: true });
  }

  const { data: m } = await db()
    .from("members")
    .select("id, name, guardian_name, guardian_email, guardian_email2, guardian_email_verified_at, guardian_email2_verified_at, consent_version, verify_by")
    .eq("id", b.id)
    .maybeSingle();
  if (!m) return NextResponse.json({ error: "Cadastro não encontrado." }, { status: 404 });
  const sent = await sendVerifications(m, appUrl(req));
  // Cadastro novo que perdeu o prazo de 7 dias ganha mais 7 a partir do reenvio.
  if (sent && m.consent_version && !m.guardian_email_verified_at)
    await db().from("members").update({ verify_by: new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10) }).eq("id", m.id);
  await adminAudit(req, { actor: s.leader, action: "confirmacao_reenviada", outcome: sent ? "ok" : "erro", targetType: "cadastro", targetId: m.id, details: { emails: sent } });
  if (!sent) return NextResponse.json({ error: "Nada a reenviar (e-mails já confirmados) ou falha no envio." }, { status: 409 });
  return NextResponse.json({ ok: true, sent });
});

export const DELETE = withErrors(async (req: Request) => {
  const s = await requireLeader(req);
  if (!s) return unauthorized();
  const b = await req.json().catch(() => null);
  const reason = String(b?.reason ?? "").trim().replace(/\s+/g, " ").slice(0, 200);
  if (typeof b?.id !== "string") return NextResponse.json({ error: "Cadastro inválido." }, { status: 400 });
  if (reason.length < 5) return NextResponse.json({ error: "Escreva o motivo (ex.: pedido do responsável por e-mail em 30/10)." }, { status: 400 });
  const r = await deleteMember(b.id);
  if (!r.deleted) return NextResponse.json({ error: "Cadastro não encontrado." }, { status: 404 });
  await adminAudit(req, { actor: s.leader, action: "cadastro_apagado", outcome: "ok", targetType: "cadastro", targetId: b.id, details: { motivo: reason, fotos: r.photos } });
  return NextResponse.json({ ok: true, photos: r.photos });
});
