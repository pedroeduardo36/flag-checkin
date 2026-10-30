import { describe, expect, it } from "vitest";
import { buildDashboard, type CheckinRow } from "@/lib/stats";

const m = (member_id: string, service_date: string): CheckinRow => ({ member_id, service_date, visitor_phone: null });
const v = (visitor_phone: string, service_date: string): CheckinRow => ({ member_id: null, service_date, visitor_phone });

// 4 Sundays: Ana came to all of them; Bia to the first 3; Caio only from the 3rd; visitors on the last two.
const rows: CheckinRow[] = [
  m("ana", "2026-09-27"), m("bia", "2026-09-27"),
  m("ana", "2026-10-04"), m("bia", "2026-10-04"),
  m("ana", "2026-10-11"), m("bia", "2026-10-11"), m("caio", "2026-10-11"), v("61911111111", "2026-10-11"),
  m("ana", "2026-10-18"), m("caio", "2026-10-18"), v("61911111111", "2026-10-18"), v("61922222222", "2026-10-18"),
];

describe("pastor dashboard", () => {
  const d = buildDashboard(rows);

  it("per-service trend, in order, splitting registered members and visitors", () => {
    expect(d.trend.map((s) => [s.date, s.registered, s.visitors, s.total])).toEqual([
      ["2026-09-27", 2, 0, 2],
      ["2026-10-04", 2, 0, 2],
      ["2026-10-11", 3, 1, 4],
      ["2026-10-18", 2, 2, 4],
    ]);
  });

  it("KPIs: services, average, latest vs. previous, unique people", () => {
    expect(d.kpis).toMatchObject({ services: 4, avgPerService: 3, uniqueMembers: 3, uniqueVisitors: 2 });
    expect(d.kpis.latest?.date).toBe("2026-10-18");
    expect(d.kpis.previous?.date).toBe("2026-10-11");
  });

  it("ranking by attendance, with % since the first check-in and the current streak", () => {
    expect(d.ranking.map((r) => [r.memberId, r.attendances, r.possible, r.percent, r.streak])).toEqual([
      ["ana", 4, 4, 100, 4],
      ["bia", 3, 4, 75, 0], // missed the latest one → streak resets
      ["caio", 2, 2, 100, 2], // joined later: 2 out of 2 possible
    ]);
  });

  it("limits the ranking and the trend", () => {
    const small = buildDashboard(rows, { rankingSize: 1, trendSize: 2 });
    expect(small.ranking).toHaveLength(1);
    expect(small.trend.map((s) => s.date)).toEqual(["2026-10-11", "2026-10-18"]);
  });

  it("no check-ins: everything zero, no error", () => {
    const empty = buildDashboard([]);
    expect(empty.kpis).toMatchObject({ services: 0, avgPerService: 0, latest: null, previous: null });
    expect(empty.ranking).toEqual([]);
  });
});
