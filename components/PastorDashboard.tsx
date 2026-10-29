"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Encontro = { date: string; cadastrados: number; visitantes: number; total: number; saidas?: number };
type Rank = {
  memberId: string;
  name: string;
  avatarUrl: string | null;
  presencas: number;
  possiveis: number;
  percentual: number;
  ultimaPresenca: string;
  sequencia: number;
};
type Dash = {
  kpis: {
    encontros: number;
    mediaPorEncontro: number;
    ultimo: Encontro | null;
    anterior: Encontro | null;
    adolescentesUnicos: number;
    visitantesUnicos: number;
  };
  evolucao: Encontro[];
  ranking: Rank[];
};

const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const longDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const fmt = (n: number) => n.toLocaleString("pt-BR");

export function PastorDashboard({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [data, setData] = useState<Dash | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/pastor/dashboard", { cache: "no-store" });
      if (r.status === 401) return onUnauthorized();
      if (!r.ok) throw new Error();
      setData(await r.json());
    } catch {
      setError("Não foi possível carregar o dashboard. Tente de novo.");
    } finally {
      setLoading(false);
    }
  }, [onUnauthorized]);

  useEffect(() => {
    load();
  }, [load]);

  if (!data)
    return (
      <div className="card center">
        {error ? (
          <>
            <p className="hint">{error}</p>
            <button className="btn" onClick={load}>Tentar de novo</button>
          </>
        ) : (
          <div className="spinner" aria-hidden />
        )}
      </div>
    );

  const { kpis, evolucao, ranking } = data;
  const delta = kpis.ultimo && kpis.anterior ? kpis.ultimo.total - kpis.anterior.total : null;

  if (!kpis.encontros)
    return (
      <div className="card center empty">
        <div className="empty__icon" aria-hidden>📊</div>
        <h2>Ainda não há encontros</h2>
        <p className="hint">Os números aparecem aqui depois do primeiro culto com check-ins.</p>
      </div>
    );

  return (
    <section className="dash" aria-label="Dashboard de frequência">
      <div className="dash__head">
        <h2>Visão geral</h2>
        <button className="dash__refresh" onClick={load} disabled={loading}>{loading ? "Atualizando…" : "↻ Atualizar"}</button>
      </div>

      <div className="kpis">
        <Kpi label="Encontros" value={fmt(kpis.encontros)} />
        <Kpi label="Média por encontro" value={kpis.mediaPorEncontro.toLocaleString("pt-BR")} />
        <Kpi
          label={kpis.ultimo ? `Último encontro · ${ddmm(kpis.ultimo.date)}` : "Último encontro"}
          value={fmt(kpis.ultimo?.total ?? 0)}
          note={
            delta === null ? "primeiro encontro" : delta === 0 ? "igual ao anterior" : `${delta > 0 ? "▲" : "▼"} ${fmt(Math.abs(delta))} vs. anterior`
          }
        />
        <Kpi label="Adolescentes diferentes" value={fmt(kpis.adolescentesUnicos)} note={kpis.visitantesUnicos ? `+ ${fmt(kpis.visitantesUnicos)} visitante(s)` : undefined} />
        {kpis.ultimo && (
          <Kpi
            wide
            label={`Saída confirmada · ${ddmm(kpis.ultimo.date)}`}
            value={`${fmt(kpis.ultimo.saidas ?? 0)} de ${fmt(kpis.ultimo.total)}`}
            note={
              kpis.ultimo.total - (kpis.ultimo.saidas ?? 0)
                ? `${fmt(kpis.ultimo.total - (kpis.ultimo.saidas ?? 0))} sem saída registrada (pelo adolescente ou por um líder)`
                : "todas as saídas registradas"
            }
          />
        )}
      </div>

      <div className="card dash__card">
        <h3>Frequência por encontro</h3>
        <p className="hint dash__sub">Presentes em cada culto{evolucao.length < kpis.encontros ? ` · últimos ${evolucao.length}` : ""}</p>
        <EvolutionChart data={evolucao} />
      </div>

      <div className="card dash__card">
        <h3>Ranking de frequência</h3>
        <p className="hint dash__sub">Adolescentes que mais vieram · % de presença desde o 1º check-in</p>
        <ol className="rank">
          {ranking.map((r, i) => (
            <li key={r.memberId} className="rank__row">
              <span className="rank__pos">{i + 1}º</span>
              {r.avatarUrl ? (
                <img className="rank__avatar" src={r.avatarUrl} alt="" />
              ) : (
                <span className="rank__avatar rank__avatar--empty" aria-hidden>{r.name.charAt(0)}</span>
              )}
              <div className="rank__body">
                <div className="rank__top">
                  <strong className="rank__name" title={r.name}>{r.name}</strong>
                  {r.sequencia >= 2 && <span className="rank__streak">🔥 {r.sequencia} seguidos</span>}
                </div>
                <div className="rank__bar" aria-hidden>
                  <span style={{ width: `${Math.max(4, (r.presencas / ranking[0].presencas) * 100)}%` }} />
                </div>
                <div className="rank__meta">
                  <span><strong className="rank__value">{r.presencas} {r.presencas === 1 ? "presença" : "presenças"}</strong> · {r.percentual}% dos encontros</span>
                  <span>{r.presencas} de {r.possiveis}</span>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Kpi({ label, value, note, wide }: { label: string; value: string; note?: string; wide?: boolean }) {
  return (
    <div className={`kpi ${wide ? "kpi--wide" : ""}`}>
      <div className="kpi__label">{label}</div>
      <div className="kpi__value">{value}</div>
      {note && <div className="kpi__note">{note}</div>}
    </div>
  );
}

/** Colunas empilhadas: cadastrados (base) + visitantes (topo), um eixo, rótulos só no último e no maior. */
function EvolutionChart({ data }: { data: Encontro[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const H = 220;
  const m = { top: 22, right: 6, bottom: 26, left: 30 };
  const iw = width - m.left - m.right;
  const ih = H - m.top - m.bottom;
  const maxTotal = Math.max(1, ...data.map((d) => d.total));
  const step = niceStep(maxTotal / 4);
  const yMax = Math.ceil(maxTotal / step) * step;
  const y = (v: number) => m.top + ih - (v / yMax) * ih;
  const band = iw / data.length;
  const bw = Math.min(36, band * 0.62);
  const ticks = Array.from({ length: Math.round(yMax / step) + 1 }, (_, i) => i * step);
  const every = Math.ceil(data.length / Math.max(1, Math.floor(iw / 44)));
  const maxIdx = data.reduce((best, d, i) => (d.total > data[best].total ? i : best), 0);
  const labelIdx = new Set([data.length - 1, maxIdx]);
  const hasVisitors = data.some((d) => d.visitantes > 0);
  const GAP = 2;

  return (
    <div className="viz">
      <div className="viz__bar">
        <ul className="legend" aria-label="Legenda">
          <li><span className="legend__sw legend__sw--1" /> Cadastrados</li>
          {hasVisitors && <li><span className="legend__sw legend__sw--2" /> Visitantes</li>}
        </ul>
        <button className="linklike viz__toggle" onClick={() => setAsTable((v) => !v)}>{asTable ? "Ver gráfico" : "Ver tabela"}</button>
      </div>

      {asTable ? (
        <table className="viz__table">
          <thead><tr><th>Encontro</th><th>Cadastrados</th><th>Visitantes</th><th>Total</th><th>Saídas</th></tr></thead>
          <tbody>
            {[...data].reverse().map((d) => (
              <tr key={d.date}><td>{longDate(d.date)}</td><td>{d.cadastrados}</td><td>{d.visitantes}</td><td><strong>{d.total}</strong></td><td>{d.saidas ?? 0}</td></tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="viz__plot" ref={box} onMouseLeave={() => setHover(null)}>
          <svg width={width} height={H} role="img"
            aria-label={`Frequência em ${data.length} encontros. Último: ${data.at(-1)?.total ?? 0} presentes; maior: ${data[maxIdx]?.total ?? 0}.`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} className={t === 0 ? "viz__base" : "viz__grid"} />
                <text x={m.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="viz__tick">{t}</text>
              </g>
            ))}
            {data.map((d, i) => {
              const cx = m.left + band * i + band / 2;
              const x = cx - bw / 2;
              const yc = y(d.cadastrados);
              const yt = y(d.total);
              const topIsVisitors = d.visitantes > 0;
              return (
                <g key={d.date}>
                  {hover === i && <rect x={m.left + band * i} y={m.top} width={band} height={ih} className="viz__hoverband" />}
                  {d.cadastrados > 0 && (
                    <path className="viz__s1" d={topIsVisitors ? rectPath(x, yc, bw, y(0) - yc) : roundTopPath(x, yc, bw, y(0) - yc, 4)} />
                  )}
                  {topIsVisitors && (
                    <path className="viz__s2"
                      d={roundTopPath(x, yt, bw, Math.max(0, yc - yt - (d.cadastrados > 0 ? GAP : 0)), 4)} />
                  )}
                  {labelIdx.has(i) && (
                    <text x={cx} y={yt - 6} textAnchor="middle" className="viz__label">{d.total}</text>
                  )}
                  {i % every === 0 || i === data.length - 1 ? (
                    <text x={cx} y={H - 8} textAnchor="middle" className="viz__tick">{ddmm(d.date)}</text>
                  ) : null}
                  <rect x={m.left + band * i} y={m.top} width={band} height={ih + m.bottom} fill="transparent"
                    onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
                </g>
              );
            })}
          </svg>
          {hover !== null && data[hover] && (
            <div className="viz__tip" role="status"
              style={{ left: Math.min(Math.max(m.left + band * hover + band / 2, 70), width - 70) }}>
              <strong>{longDate(data[hover].date)}</strong>
              <span><i className="legend__sw legend__sw--1" /> Cadastrados <b>{data[hover].cadastrados}</b></span>
              {hasVisitors && <span><i className="legend__sw legend__sw--2" /> Visitantes <b>{data[hover].visitantes}</b></span>}
              <span>Total <b>{data[hover].total}</b></span>
              <span>Saída confirmada <b>{data[hover].saidas ?? 0}</b></span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function niceStep(raw: number) {
  if (raw <= 1) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
const rectPath = (x: number, y: number, w: number, h: number) => `M${x},${y}h${w}v${h}h${-w}Z`;
function roundTopPath(x: number, y: number, w: number, h: number, r: number) {
  if (h <= 0) return "";
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}
