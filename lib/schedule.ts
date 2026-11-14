// Service schedule texts (shared by the check-in routes and the dashboard).

/** "sex., 20/11" */
export const shortServiceDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" });

/** Why a leader can't schedule this date (null = it can be scheduled). Today counts: an extra service can start now. */
export function scheduleDateError(date: string, today: string): string | null {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00Z`) : null;
  if (!d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) return "Data inválida.";
  if (date < today) return "Escolha hoje ou uma data futura.";
  const limit = new Date(`${today}T12:00:00Z`);
  limit.setUTCFullYear(limit.getUTCFullYear() + 1);
  if (d > limit) return "Escolha uma data em até 1 ano.";
  return null;
}

/** Message for a check-in attempt on a day without a service. */
export function closedMessage(next: string | null): string {
  return `Hoje não tem encontro da O2, então o check-in está fechado.${next ? ` Próximo encontro: ${shortServiceDate(next)}.` : ""}`;
}
