import { nameMatchScore, nameTokens } from "@/lib/format";

export type Existing = { id: string; name: string; guardian_email: string | null; guardian_email2: string | null };

/**
 * Among people born on the same day, looks for a registration with a compatible name (the same rule
 * as check-in: accents, "de/da" and an omitted middle name don't count). Uses only the name, birth
 * date and guardian email, which the form already asks for.
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
