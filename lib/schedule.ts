// Service schedule texts (shared by the check-in routes and the dashboard).

/** "sex., 20/11" */
export const shortServiceDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" });

/** Message for a check-in attempt on a day without a service. */
export function closedMessage(next: string | null): string {
  return `Hoje não tem encontro da O2, então o check-in está fechado.${next ? ` Próximo encontro: ${shortServiceDate(next)}.` : ""}`;
}
