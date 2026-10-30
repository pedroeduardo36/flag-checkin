"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Brand } from "@/components/Brand";
import { RegistrationForm } from "@/components/RegistrationForm";
import { PastorDashboard } from "@/components/PastorDashboard";
import { LeaderAuth, type AuthStep } from "@/components/LeaderAuth";
import { LeadersAdmin } from "@/components/LeadersAdmin";

type Item = {
  id: string;
  serviceDate: string;
  name: string;
  firstName: string;
  isVisitor?: boolean;
  photoKind?: "registro" | "criativa" | null;
  isFirst?: boolean;
  checkedInAt: string;
  selfieUrl: string | null;
  avatarUrl: string | null;
  faceDistance: number | null;
  guardianEmailStatus: string | null;
};

type Auth = "checking" | "in" | AuthStep;
type Tab = "feed" | "dashboard" | "registration" | "leaders";

const POLL_MS = 4000;
const FULL_RELOAD_MS = 30 * 60 * 1000; // refreshes the photos' signed URLs (valid for 1 h)

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

function ago(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return "agora";
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  return `há ${h} h${m % 60 ? ` ${m % 60} min` : ""}`;
}

/** Server-side session stage → screen. */
const STEP_OF: Record<string, Auth> = { completa: "in", senha: "code", cadastro_totp: "enroll" };

export default function PastorPage() {
  const [auth, setAuth] = useState<Auth>("checking");
  const [tab, setTab] = useState<Tab>("feed");
  const [name, setName] = useState("");

  const check = useCallback(() => {
    fetch("/api/lider/sessao", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setName(d.leader?.name ?? "");
        setAuth(STEP_OF[d.stage] ?? "login");
      })
      .catch(() => setAuth("login"));
  }, []);
  useEffect(check, [check]);

  const expired = useCallback(() => setAuth("login"), []);

  async function logout() {
    await fetch("/api/lider/sessao", { method: "DELETE" }).catch(() => {});
    setAuth("login");
  }

  if (auth === "checking")
    return (
      <main className="shell">
        <Brand compact />
        <section className="card center"><div className="spinner" aria-hidden /></section>
      </main>
    );

  if (auth !== "in") return <LeaderAuth key={auth} initial={auth} onDone={check} />;

  return (
    <main className="shell pastor">
      <div className="pastor__top">
        <Brand compact />
        <button className="pastor__logout" onClick={logout} title={name ? `Conectado como ${name}` : undefined}>Sair</button>
      </div>

      <nav className="tabs" role="tablist" aria-label="Área dos líderes">
        <button role="tab" aria-selected={tab === "feed"} className={tab === "feed" ? "on" : ""} onClick={() => setTab("feed")}>
          <span className="live-dot" aria-hidden /> Ao vivo
        </button>
        <button role="tab" aria-selected={tab === "dashboard"} className={tab === "dashboard" ? "on" : ""} onClick={() => setTab("dashboard")}>
          Dashboard
        </button>
        <button role="tab" aria-selected={tab === "registration"} className={tab === "registration" ? "on" : ""} onClick={() => setTab("registration")}>
          Cadastrar
        </button>
        <button role="tab" aria-selected={tab === "leaders"} className={tab === "leaders" ? "on" : ""} onClick={() => setTab("leaders")}>
          Líderes
        </button>
      </nav>

      {/* The feed stays mounted (and updating) while the leader uses the other tabs. */}
      <div hidden={tab !== "feed"}>
        <Feed onUnauthorized={expired} />
      </div>
      {tab === "dashboard" && <PastorDashboard onUnauthorized={expired} />}
      {tab === "registration" && (
        <section className="card">
          <RegistrationForm mode="pastor" onSessionExpired={expired} />
        </section>
      )}
      {tab === "leaders" && <LeadersAdmin onUnauthorized={expired} />}
      <footer className="foot">Ministério Flag · Juventude O2 · {name ? `conectado como ${name}` : "área dos líderes"}</footer>
    </main>
  );
}

function Feed({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [examples, setExamples] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [online, setOnline] = useState(true);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  const latest = useRef<string | null>(null);
  const lastFull = useRef(0);
  const loading = useRef(false);

  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    const full = !latest.current || Date.now() - lastFull.current > FULL_RELOAD_MS;
    try {
      const qs = full ? "" : `?since=${encodeURIComponent(latest.current!)}`;
      const r = await fetch(`/api/pastor/feed${qs}`, { cache: "no-store" });
      if (r.status === 401) return onUnauthorized();
      if (!r.ok) throw new Error(String(r.status));
      const d: { total: number; items: Item[]; examples?: Item[] } = await r.json();
      setOnline(true);
      setTotal(d.total);
      if (full) {
        lastFull.current = Date.now();
        setItems(d.items);
        setExamples(d.examples ?? []);
      } else if (d.items.length) {
        setItems((prev) => {
          const known = new Set(prev.map((i) => i.id));
          return [...d.items.filter((i) => !known.has(i.id)), ...prev];
        });
        setFresh((s) => new Set([...s, ...d.items.map((i) => i.id)]));
        setTimeout(() => setFresh((s) => new Set([...s].filter((id) => !d.items.some((i) => i.id === id)))), 6000);
      }
      const newest = d.items[0];
      if (newest) latest.current = newest.checkedInAt;
      else if (full) latest.current = new Date(0).toISOString();
    } catch {
      setOnline(false);
    } finally {
      loading.current = false;
      setLoaded(true);
    }
  }, [onUnauthorized]);

  useEffect(() => {
    load();
    const poll = setInterval(() => document.visibilityState === "visible" && load(), POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const todayRaw = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", timeZone: "America/Sao_Paulo" });
  const today = todayRaw.charAt(0).toUpperCase() + todayRaw.slice(1);

  return (
    <section aria-label="Check-ins ao vivo">
      <div className="feed-stats">
        <div>
          <div className="feed-stats__n">{total}</div>
          <div className="feed-stats__l">{total === 1 ? "adolescente presente" : "adolescentes presentes"}</div>
        </div>
        <div className="feed-stats__r">
          <span className={`live ${online ? "" : "live--off"}`}><span className="live-dot" aria-hidden /> {online ? "Ao vivo" : "Reconectando…"}</span>
          <span className="feed-stats__d">{today}</span>
        </div>
      </div>

      {!loaded && <div className="card center"><div className="spinner" aria-hidden /></div>}

      {loaded && items.length === 0 && (
        <div className="card center empty">
          <div className="empty__icon" aria-hidden>📸</div>
          <h2>Nenhum check-in ainda hoje</h2>
          <p className="hint">Os adolescentes aparecem aqui na hora em que fizerem o check-in.</p>
        </div>
      )}

      <ol className="feed" aria-live="polite">
        {items.map((it) => (
          <Post key={it.id} it={it} now={now} isNew={fresh.has(it.id)}
            onRemoved={() => { setItems((p) => p.filter((x) => x.id !== it.id)); setTotal((t) => Math.max(0, t - 1)); }}
            onUnauthorized={onUnauthorized} />
        ))}
      </ol>

      {examples.length > 0 && (
        <>
          <div className="feed-divider"><span>Exemplo para teste</span></div>
          <ol className="feed">
            {examples.map((it) => (
              <Post key={it.id} it={it} now={now} example />
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

const fmtDay = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "UTC" });

type PostProps = { it: Item; now: number; isNew?: boolean; example?: boolean; onRemoved?: () => void; onUnauthorized?: () => void };

function Post({ it, now, isNew = false, example = false, onRemoved, onUnauthorized }: PostProps) {
  return (
          <li className={`post ${isNew ? "post--new" : ""} ${example ? "post--example" : ""}`}>
            <header className="post__head">
              {it.avatarUrl ? (
                <img className="post__avatar" src={it.avatarUrl} alt="" />
              ) : (
                <span className="post__avatar post__avatar--empty" aria-hidden>{it.firstName.charAt(0).toUpperCase()}</span>
              )}
              <div className="post__who">
                <strong>{it.name}</strong>
                <span>{example ? `culto de ${fmtDay(it.serviceDate)}` : it.isVisitor ? "visitante · chegou ao culto" : "chegou ao culto"} · {fmtTime(it.checkedInAt)}</span>
              </div>
              {example ? (
                <span className="tag tag--example">Exemplo</span>
              ) : (
                <time className="post__ago" dateTime={it.checkedInAt}>{ago(it.checkedInAt, now)}</time>
              )}
            </header>
            {it.selfieUrl ? (
              <img className="post__img" src={it.selfieUrl} alt={`Selfie do check-in de ${it.firstName}`} loading="lazy" />
            ) : (
              <div className="post__img post__img--empty">{it.isVisitor ? "Visitante sem foto" : "Foto indisponível"}</div>
            )}
            <footer className="post__foot">
              <span className="tag tag--ok">✓ Check-in confirmado</span>
              {it.isVisitor && <span className="tag tag--visitor">👋 Visitante</span>}
              {it.isFirst && <span className="tag tag--first">⭐ 1º check-in</span>}
              {it.photoKind === "criativa" && !it.isVisitor && <span className="tag">📸 Foto criativa</span>}
              {it.faceDistance != null && <span className="tag">🙂 Rosto confere</span>}
              {it.guardianEmailStatus === "enviado" && <span className="tag">✉️ Responsável avisado</span>}
              {it.guardianEmailStatus === "falhou" && <span className="tag tag--warn">✉️ E-mail falhou</span>}
            </footer>
            {onRemoved && <Correction it={it} onRemoved={onRemoved} onUnauthorized={onUnauthorized!} />}
          </li>
  );
}

/** Attendance correction: removes a check-in made by mistake, with a reason (it goes to the action log). */
function Correction({ it, onRemoved, onUnauthorized }: { it: Item; onRemoved: () => void; onUnauthorized: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function remove(e: React.FormEvent) {
    e.preventDefault();
    if (reason.trim().length < 5) return setError("Escreva o motivo (ex.: check-in feito por outra pessoa).");
    setBusy(true);
    setError(null);
    const r = await fetch("/api/pastor/checkins", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: it.id, reason }),
    }).catch(() => null);
    setBusy(false);
    if (r?.status === 401) return onUnauthorized();
    if (r?.ok) return onRemoved();
    setError((await r?.json().catch(() => null))?.error ?? "Não foi possível remover.");
  }

  if (!open)
    return (
      <div className="post__fix">
        <button className="linklike" onClick={() => setOpen(true)}>Corrigir presença</button>
      </div>
    );
  return (
    <form className="post__fix post__fix--open" onSubmit={remove} noValidate>
      <label className="field">
        <span>Remover o check-in de {it.firstName}. Motivo:</span>
        <input autoFocus value={reason} maxLength={200} placeholder="Ex.: feito por outra pessoa" onChange={(e) => setReason(e.target.value)} />
      </label>
      {error && <div className="alert" role="alert">{error}</div>}
      <div className="post__fix-actions">
        <button className="chip chip--danger" disabled={busy}>{busy ? "Removendo…" : "Remover presença"}</button>
        <button type="button" className="chip" onClick={() => { setOpen(false); setError(null); }}>Cancelar</button>
      </div>
    </form>
  );
}
