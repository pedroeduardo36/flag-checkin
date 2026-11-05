// Pastor dashboard calculations (pure function, tested without a database).

export type CheckinRow = { service_date: string; member_id: string | null; visitor_phone: string | null; checked_out_at?: string | null };

/** checkouts: attendances whose checkout was confirmed (by the participant or by a leader). */
export type Service = { date: string; registered: number; visitors: number; total: number; checkouts: number };

export type RankingRow = {
  memberId: string;
  attendances: number;
  /** services held since the teen's first attendance (inclusive) */
  possible: number;
  percent: number;
  lastAttendance: string;
  /** consecutive services, counting back from the latest one */
  streak: number;
};

export function buildDashboard(rows: CheckinRow[], { rankingSize = 10, trendSize = 20 } = {}) {
  const byDate = new Map<string, Service>();
  const byMember = new Map<string, Set<string>>();
  const visitors = new Set<string>();

  for (const r of rows) {
    const s = byDate.get(r.service_date) ?? { date: r.service_date, registered: 0, visitors: 0, total: 0, checkouts: 0 };
    if (r.member_id) {
      s.registered++;
      const dates = byMember.get(r.member_id) ?? new Set<string>();
      dates.add(r.service_date);
      byMember.set(r.member_id, dates);
    } else {
      s.visitors++;
      if (r.visitor_phone) visitors.add(r.visitor_phone);
    }
    s.total++;
    if (r.checked_out_at) s.checkouts++;
    byDate.set(r.service_date, s);
  }

  const services = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const dates = services.map((s) => s.date);
  const latest = services.at(-1) ?? null;
  const previous = services.at(-2) ?? null;
  const sum = services.reduce((acc, s) => acc + s.total, 0);

  const ranking: RankingRow[] = [...byMember.entries()]
    .map(([memberId, days]) => {
      const sorted = [...days].sort();
      const possible = dates.filter((d) => d >= sorted[0]).length;
      let streak = 0;
      for (let i = dates.length - 1; i >= 0 && days.has(dates[i]); i--) streak++;
      return {
        memberId,
        attendances: days.size,
        possible,
        percent: possible ? Math.round((days.size / possible) * 100) : 0,
        lastAttendance: sorted.at(-1)!,
        streak,
      };
    })
    .sort((a, b) => b.attendances - a.attendances || b.percent - a.percent || b.lastAttendance.localeCompare(a.lastAttendance))
    .slice(0, rankingSize);

  return {
    kpis: {
      services: services.length,
      avgPerService: services.length ? Math.round((sum / services.length) * 10) / 10 : 0,
      latest,
      previous,
      uniqueMembers: byMember.size,
      uniqueVisitors: visitors.size,
    },
    trend: services.slice(-trendSize),
    ranking,
  };
}
