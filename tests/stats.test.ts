import { describe, expect, it } from "vitest";
import { buildDashboard, type CheckinRow } from "@/lib/stats";

const m = (member_id: string, service_date: string): CheckinRow => ({ member_id, service_date, visitor_phone: null });
const v = (visitor_phone: string, service_date: string): CheckinRow => ({ member_id: null, service_date, visitor_phone });

// 4 domingos: Ana foi em todos; Bia nos 3 primeiros; Caio só a partir do 3º; visitantes nos dois últimos.
const rows: CheckinRow[] = [
  m("ana", "2026-09-27"), m("bia", "2026-09-27"),
  m("ana", "2026-10-04"), m("bia", "2026-10-04"),
  m("ana", "2026-10-11"), m("bia", "2026-10-11"), m("caio", "2026-10-11"), v("61911111111", "2026-10-11"),
  m("ana", "2026-10-18"), m("caio", "2026-10-18"), v("61911111111", "2026-10-18"), v("61922222222", "2026-10-18"),
];

describe("dashboard do pastor", () => {
  const d = buildDashboard(rows);

  it("evolução por encontro, em ordem, separando cadastrados e visitantes", () => {
    expect(d.evolucao.map((e) => [e.date, e.cadastrados, e.visitantes, e.total])).toEqual([
      ["2026-09-27", 2, 0, 2],
      ["2026-10-04", 2, 0, 2],
      ["2026-10-11", 3, 1, 4],
      ["2026-10-18", 2, 2, 4],
    ]);
  });

  it("indicadores: encontros, média, último x anterior, únicos", () => {
    expect(d.kpis).toMatchObject({ encontros: 4, mediaPorEncontro: 3, adolescentesUnicos: 3, visitantesUnicos: 2 });
    expect(d.kpis.ultimo?.date).toBe("2026-10-18");
    expect(d.kpis.anterior?.date).toBe("2026-10-11");
  });

  it("ranking por presenças, com % desde o 1º check-in e sequência atual", () => {
    expect(d.ranking.map((r) => [r.memberId, r.presencas, r.possiveis, r.percentual, r.sequencia])).toEqual([
      ["ana", 4, 4, 100, 4],
      ["bia", 3, 4, 75, 0], // faltou no último → sequência zera
      ["caio", 2, 2, 100, 2], // chegou depois: 2 de 2 possíveis
    ]);
  });

  it("limita o ranking e a evolução", () => {
    const small = buildDashboard(rows, { rankingSize: 1, evolucaoSize: 2 });
    expect(small.ranking).toHaveLength(1);
    expect(small.evolucao.map((e) => e.date)).toEqual(["2026-10-11", "2026-10-18"]);
  });

  it("sem check-ins: tudo zerado, sem erro", () => {
    const empty = buildDashboard([]);
    expect(empty.kpis).toMatchObject({ encontros: 0, mediaPorEncontro: 0, ultimo: null, anterior: null });
    expect(empty.ranking).toEqual([]);
  });
});

describe("saídas no dashboard", () => {
  it("conta por encontro as presenças com saída confirmada", () => {
    const d = buildDashboard([
      { ...m("ana", "2026-10-25"), checked_out_at: "2026-10-26T00:15:00Z" },
      m("bia", "2026-10-25"),
      { ...v("61911111111", "2026-10-25"), checked_out_at: "2026-10-26T00:20:00Z" },
    ]);
    expect(d.kpis.ultimo).toMatchObject({ total: 3, saidas: 2 });
  });
});
