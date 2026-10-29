// Cálculos do dashboard do pastor (função pura, testada sem banco).

export type CheckinRow = { service_date: string; member_id: string | null; visitor_phone: string | null; checked_out_at?: string | null };

/** saidas: presenças com a saída confirmada (pelo participante ou por um líder). */
export type Encontro = { date: string; cadastrados: number; visitantes: number; total: number; saidas: number };

export type RankingRow = {
  memberId: string;
  presencas: number;
  /** encontros que aconteceram desde a 1ª presença do adolescente (inclusive) */
  possiveis: number;
  percentual: number;
  ultimaPresenca: string;
  /** encontros seguidos, contando do último encontro para trás */
  sequencia: number;
};

export function buildDashboard(rows: CheckinRow[], { rankingSize = 10, evolucaoSize = 20 } = {}) {
  const byDate = new Map<string, Encontro>();
  const byMember = new Map<string, Set<string>>();
  const visitantes = new Set<string>();

  for (const r of rows) {
    const e = byDate.get(r.service_date) ?? { date: r.service_date, cadastrados: 0, visitantes: 0, total: 0, saidas: 0 };
    if (r.member_id) {
      e.cadastrados++;
      const s = byMember.get(r.member_id) ?? new Set<string>();
      s.add(r.service_date);
      byMember.set(r.member_id, s);
    } else {
      e.visitantes++;
      if (r.visitor_phone) visitantes.add(r.visitor_phone);
    }
    e.total++;
    if (r.checked_out_at) e.saidas++;
    byDate.set(r.service_date, e);
  }

  const encontros = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const datas = encontros.map((e) => e.date);
  const ultimo = encontros.at(-1) ?? null;
  const anterior = encontros.at(-2) ?? null;
  const soma = encontros.reduce((acc, e) => acc + e.total, 0);

  const ranking: RankingRow[] = [...byMember.entries()]
    .map(([memberId, dias]) => {
      const sorted = [...dias].sort();
      const possiveis = datas.filter((d) => d >= sorted[0]).length;
      let sequencia = 0;
      for (let i = datas.length - 1; i >= 0 && dias.has(datas[i]); i--) sequencia++;
      return {
        memberId,
        presencas: dias.size,
        possiveis,
        percentual: possiveis ? Math.round((dias.size / possiveis) * 100) : 0,
        ultimaPresenca: sorted.at(-1)!,
        sequencia,
      };
    })
    .sort((a, b) => b.presencas - a.presencas || b.percentual - a.percentual || b.ultimaPresenca.localeCompare(a.ultimaPresenca))
    .slice(0, rankingSize);

  return {
    kpis: {
      encontros: encontros.length,
      mediaPorEncontro: encontros.length ? Math.round((soma / encontros.length) * 10) / 10 : 0,
      ultimo,
      anterior,
      adolescentesUnicos: byMember.size,
      visitantesUnicos: visitantes.size,
    },
    evolucao: encontros.slice(-evolucaoSize),
    ranking,
  };
}
