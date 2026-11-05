// Checkout rules (pure functions, tested without a database).

/** Stored as-is in checkins.checkout_by: participant or leader. */
export type CheckoutBy = "participante" | "lider";

/**
 * Time a leader enters when fixing a forgotten checkout ("HH:MM", Brasília time) → instant. Brasília
 * has had no daylight saving time since 2019, so the offset is always -03:00. A service that runs past
 * midnight accepts a time on the next day. The checkout must fall between the arrival and now.
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
  // Arrivals are stored with seconds: 19:42 is valid for someone who arrived at 19:42:30.
  if (at.getTime() + 60_000 <= arrival) at = new Date(at.getTime() + 86_400_000);
  if (at.getTime() < arrival) at = new Date(arrival);
  if (at.getTime() > now.getTime()) return { error: "A saída não pode ser num horário que ainda não chegou." };
  if (at.getTime() - arrival > 18 * 3600_000) return { error: "A saída precisa ser no mesmo culto da chegada." };
  return { at };
}

/** Short checkout status text, the same in the teen's app and in the leaders' feed. */
export function checkoutLabel(checkedOutAt: string | null, by: CheckoutBy | null): string {
  if (!checkedOutAt) return "Saída não registrada";
  const time = new Date(checkedOutAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
  return by === "lider" ? `Saída às ${time} · registrada por um líder` : `Saída às ${time}`;
}
