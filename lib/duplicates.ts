import { nameMatchScore, nameTokens } from "@/lib/format";

export type Existing = { id: string; name: string; guardian_email: string | null; guardian_email2: string | null };

/**
 * Procura, entre os nascidos no mesmo dia, um cadastro com nome compatível (o mesmo critério do
 * check-in: acento, "de/da" e nome do meio omitido não diferenciam). Usa só nome, nascimento e
 * e-mail do responsável, que o formulário já pede.
 */
export function findDuplicate(
  data: { name: string; guardian_email: string; guardian_email2: string | null },
  sameDay: Existing[],
): { id: string; resubmission: boolean } | null {
  const tokens = nameTokens(data.name).join(" ");
  const emails = new Set([data.guardian_email, data.guardian_email2].filter(Boolean));
  let best: { id: string; score: number; resubmission: boolean } | null = null;
  for (const m of sameDay) {
    const score = Math.max(nameMatchScore(data.name, m.name), nameMatchScore(m.name, data.name));
    if (!score) continue;
    const resubmission =
      nameTokens(m.name).join(" ") === tokens && [m.guardian_email, m.guardian_email2].some((e) => !!e && emails.has(e));
    if (resubmission) return { id: m.id, resubmission };
    if (!best || score > best.score) best = { id: m.id, score, resubmission };
  }
  return best && { id: best.id, resubmission: false };
}
