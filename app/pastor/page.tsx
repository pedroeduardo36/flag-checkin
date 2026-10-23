"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Brand } from "@/components/Brand";
import { CadastroForm } from "@/components/CadastroForm";
import { PastorDashboard } from "@/components/PastorDashboard";

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

type Auth = "checking" | "login" | "in";
type Tab = "feed" | "dashboard" | "cadastro";

const POLL_MS = 4000;
const FULL_RELOAD_MS = 30 * 60 * 1000; // renova as URLs assinadas das fotos (valem 1 h)

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

export default function PastorPage() {
  const [auth, setAuth] = useState<Auth>("checking");
  const [tab, setTab] = useState<Tab>("feed");

  useEffect(() => {
    fetch("/api/pastor/sessao")
      .then((r) => r.json())
      .then((d) => setAuth(d.ok ? "in" : "login"))
      .catch(() => setAuth("login"));
  }, []);

  async function logout() {
    await fetch("/api/pastor/sessao", { method: "DELETE" }).catch(() => {});
    setAuth("login");
  }

  if (auth === "checking")
    return (
      <main className="shell">
        <Brand compact />
        <section className="card center"><div className="spinner" aria-hidden /></section>
      </main>
    );

  if (auth === "login") return <Login onOk={() => setAuth("in")} />;

  return (
    <main className="shell pastor">
      <div className="pastor__top">
        <Brand compact />
        <button className="pastor__logout" onClick={logout}>Sair</button>
      </div>

      <nav className="tabs" role="tablist" aria-label="Área do pastor">
        <button role="tab" aria-selected={tab === "feed"} className={tab === "feed" ? "on" : ""} onClick={() => setTab("feed")}>
          <span className="live-dot" aria-hidden /> Ao vivo
        </button>
        <button role="tab" aria-selected={tab === "dashboard"} className={tab === "dashboard" ? "on" : ""} onClick={() => setTab("dashboard")}>
          📊 Dashboard
        </button>
        <button role="tab" aria-selected={tab === "cadastro"} className={tab === "cadastro" ? "on" : ""} onClick={() => setTab("cadastro")}>
          ＋ Cadastrar
        </button>
      </nav>

      {/* O feed continua montado (e atualizando) enquanto o pastor cadastra alguém. */}
      <div hidden={tab !== "feed"}>
        <Feed onUnauthorized={() => setAuth("login")} />
      </div>
      {tab === "dashboard" && <PastorDashboard onUnauthorized={() => setAuth("login")} />}
      {tab === "cadastro" && (
        <section className="card">
          <CadastroForm mode="pastor" onSessionExpired={() => setAuth("login")} />
        </section>
      )}
      <footer className="foot">Ministério Flag · Juventude O2 · área do pastor</footer>
    </main>
  );
}

function Login({ onOk }: { onOk: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) return setError("Digite a senha.");
    setBusy(true);
    setError(null);
    const r = await fetch("/api/pastor/sessao", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    }).catch(() => null);
    setBusy(false);
    if (r?.ok) return onOk();
    setPassword("");
    setError(r?.status === 401 ? "Senha incorreta." : "Não foi possível entrar. Tente de novo.");
  }

  return (
    <main className="shell">
      <Brand />
      <section className="card">
        <form onSubmit={submit} noValidate>
          <div className="lock" aria-hidden>🔒</div>
          <h1>Área do pastor</h1>
          <p className="lead">Acompanhamento ao vivo dos check-ins e cadastro de adolescentes.</p>
          <label className="field">
            <span>Senha</span>
            <input type="password" autoComplete="current-password" autoFocus value={password}
              onChange={(e) => setPassword(e.target.value)} />
          </label>
          {error && <div className="alert" role="alert">{error}</div>}
          <button className="btn" disabled={busy}>{busy ? "Entrando…" : "Entrar"}</button>
        </form>
      </section>
      <footer className="foot">Ministério Flag · Juventude O2</footer>
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
          <Post key={it.id} it={it} now={now} isNew={fresh.has(it.id)} />
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

function Post({ it, now, isNew = false, example = false }: { it: Item; now: number; isNew?: boolean; example?: boolean }) {
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
          </li>
  );
}
