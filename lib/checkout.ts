// Regras do checkout (funções puras, testadas sem banco).

export type CheckoutBy = "participante" | "lider";

/**
 * Horário informado pelo líder ao corrigir uma saída esquecida ("HH:MM", horário de Brasília) →
 * instante. Brasília não tem horário de verão desde 2019: o fuso é sempre -03:00. Um culto que passa
 * da meia-noite aceita o horário do dia seguinte. A saída precisa ficar entre a chegada e agora.
 */
export function leaderCheckoutTime(
  serviceDate: string,
  hhmm: unknown,
  checkedInAt: string,
  now = new Date(),
): { at: Date } | { error: string } {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm ?? ""));
  if (!m || !/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) return { error: "Informe o horário da saída (HH:MM)." };
  const arrival = new Date(checkedInAt).getTime();
  let at = new Date(`${serviceDate}T${m[1]}:${m[2]}:00-03:00`);
  // A chegada é guardada com segundos: 19:42 vale para quem chegou às 19:42:30.
  if (at.getTime() + 60_000 <= arrival) at = new Date(at.getTime() + 86_400_000);
  if (at.getTime() < arrival) at = new Date(arrival);
  if (at.getTime() > now.getTime()) return { error: "A saída não pode ser num horário que ainda não chegou." };
  if (at.getTime() - arrival > 18 * 3600_000) return { error: "A saída precisa ser no mesmo culto da chegada." };
  return { at };
}

/** Texto curto da situação da saída, igual no app do adolescente e no feed dos líderes. */
export function checkoutLabel(checkedOutAt: string | null, by: CheckoutBy | null): string {
  if (!checkedOutAt) return "Saída não registrada";
  const hora = new Date(checkedOutAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
  return by === "lider" ? `Saída às ${hora} · registrada por um líder` : `Saída às ${hora}`;
}
