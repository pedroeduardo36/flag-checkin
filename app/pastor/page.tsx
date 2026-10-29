"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Brand } from "@/components/Brand";
import { CadastroForm } from "@/components/CadastroForm";
import { PastorDashboard } from "@/components/PastorDashboard";
import { LeaderAuth, type AuthStep } from "@/components/LeaderAuth";
import { LeadersAdmin } from "@/components/LeadersAdmin";
import { checkoutLabel, type CheckoutBy } from "@/lib/checkout";

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
  checkedOutAt?: string | null;
  checkoutBy?: CheckoutBy | null;
  checkoutEmailStatus?: string | null;
};

type Auth = "checking" | "in" | AuthStep;
type Tab = "feed" | "dashboard" | "cadastro" | "lideres";

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

/** Etapa da sessão no servidor → tela. */
const STEP_OF: Record<string, Auth> = { completa: "in", senha: "codigo", cadastro_totp: "cadastro" };

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
        <button role="tab" aria-selected={tab === "cadastro"} className={tab === "cadastro" ? "on" : ""} onClick={() => setTab("cadastro")}>
          Cadastrar
        </button>
        <button role="tab" aria-selected={tab === "lideres"} className={tab === "lideres" ? "on" : ""} onClick={() => setTab("lideres")}>
          Líderes
        </button>
      </nav>

      {/* O feed continua montado (e atualizando) enquanto o líder usa as outras abas. */}
      <div hidden={tab !== "feed"}>
        <Feed onUnauthorized={expired} />
      </div>
      {tab === "dashboard" && <PastorDashboard onUnauthorized={expired} />}
      {tab === "cadastro" && (
        <section className="card">
          <CadastroForm mode="pastor" onSessionExpired={expired} />
        </section>
      )}
      {tab === "lideres" && <LeadersAdmin onUnauthorized={expired} />}
      <footer className="foot">Ministério Flag · Juventude O2 · {name ? `conectado como ${name}` : "área dos líderes"}</footer>
    </main>
  );
}

function Feed({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [examples, setExamples] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [checkedOut, setCheckedOut] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [online, setOnline] = useState(true);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  const latest = useRef<string | null>(null);
  const itemsRef = useRef<Item[]>([]);
  itemsRef.current = items;
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
      const d: { total: number; checkedOut?: number; cursor?: string; items: Item[]; examples?: Item[] } = await r.json();
      setOnline(true);
      setTotal(d.total);
      setCheckedOut(d.checkedOut ?? 0);
      if (full) {
        lastFull.current = Date.now();
        setItems(d.items);
        setExamples(d.examples ?? []);
      } else if (d.items.length) {
        // Chegadas novas entram no topo; saídas gravadas ou desfeitas atualizam o item que já está na tela.
        const known = new Set(itemsRef.current.map((i) => i.id));
        const arrivals = d.items.filter((i) => !known.has(i.id));
        const changed = new Map(d.items.filter((i) => known.has(i.id)).map((i) => [i.id, i]));
        setItems((prev) => [...arrivals, ...prev.map((i) => changed.get(i.id) ?? i)]);
        if (arrivals.length) {
          setFresh((s) => new Set([...s, ...arrivals.map((i) => i.id)]));
          setTimeout(() => setFresh((s) => new Set([...s].filter((id) => !arrivals.some((i) => i.id === id)))), 6000);
        }
      }
      latest.current = d.cursor ?? d.items[0]?.checkedInAt ?? latest.current ?? new Date(0).toISOString();
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
          {total > 0 && (
            <div className="feed-stats__out">
              {checkedOut} com saída confirmada · {total - checkedOut} sem saída registrada
            </div>
          )}
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
            onRemoved={() => {
              setItems((p) => p.filter((x) => x.id !== it.id));
              setTotal((t) => Math.max(0, t - 1));
              if (it.checkedOutAt) setCheckedOut((n) => Math.max(0, n - 1));
            }}
            onCheckout={(out) => {
              setItems((p) => p.map((x) => (x.id === it.id ? { ...x, ...out } : x)));
              setCheckedOut((n) => Math.max(0, n + (out.checkedOutAt ? 1 : -1)));
            }}
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

type CheckoutState = { checkedOutAt: string | null; checkoutBy: CheckoutBy | null };
type PostProps = {
  it: Item; now: number; isNew?: boolean; example?: boolean;
  onRemoved?: () => void; onCheckout?: (out: CheckoutState) => void; onUnauthorized?: () => void;
};

function Post({ it, now, isNew = false, example = false, onRemoved, onCheckout, onUnauthorized }: PostProps) {
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
              {!example && (
                <span className={`tag ${it.checkedOutAt ? "tag--out" : "tag--warn"}`}>🚪 {checkoutLabel(it.checkedOutAt ?? null, it.checkoutBy ?? null)}</span>
              )}
              {it.checkoutEmailStatus === "enviado" && <span className="tag">✉️ Avisado da saída</span>}
            </footer>
            {onRemoved && onCheckout && <Correction it={it} onRemoved={onRemoved} onCheckout={onCheckout} onUnauthorized={onUnauthorized!} />}
          </li>
  );
}

const nowHHMM = () =>
  new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Sao_Paulo" });

type Fix = "remover" | "registrar_saida" | "desfazer_saida";

/**
 * Correções do líder, sempre com motivo (vão para o registro de ações):
 * remover um check-in feito por engano, registrar a saída de quem esqueceu de confirmar
 * (com o horário) ou desfazer uma saída confirmada por engano. A presença nunca muda com a saída.
 */
function Correction({ it, onRemoved, onCheckout, onUnauthorized }: {
  it: Item; onRemoved: () => void; onCheckout: (out: CheckoutState) => void; onUnauthorized: () => void;
}) {
  const [open, setOpen] = useState<Fix | null>(null);
  const [reason, setReason] = useState("");
  const [time, setTime] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => { setOpen(null); setReason(""); setError(null); };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (reason.trim().length < 5)
      return setError(open === "remover" ? "Escreva o motivo (ex.: check-in feito por outra pessoa)." : "Escreva o motivo (ex.: esqueceu de confirmar a saída).");
    setBusy(true);
    setError(null);
    const r = await fetch("/api/pastor/checkins", {
      method: open === "remover" ? "DELETE" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(open === "remover" ? { id: it.id, reason } : { id: it.id, action: open, reason, time }),
    }).catch(() => null);
    setBusy(false);
    if (r?.status === 401) return onUnauthorized();
    const d = await r?.json().catch(() => null);
    if (r?.ok) {
      if (open === "remover") return onRemoved();
      onCheckout({ checkedOutAt: d.checkedOutAt, checkoutBy: d.checkoutBy });
      return close();
    }
    setError(d?.error ?? "Não foi possível salvar a correção.");
  }

  if (!open)
    return (
      <div className="post__fix">
        {it.checkedOutAt ? (
          <button className="linklike" onClick={() => setOpen("desfazer_saida")}>Desfazer saída</button>
        ) : (
          <button className="linklike" onClick={() => { setTime(nowHHMM()); setOpen("registrar_saida"); }}>Registrar saída</button>
        )}
        <span aria-hidden> · </span>
        <button className="linklike" onClick={() => setOpen("remover")}>Corrigir presença</button>
      </div>
    );
  return (
    <form className="post__fix post__fix--open" onSubmit={submit} noValidate>
      {open === "registrar_saida" && (
        <label className="field">
          <span>Horário em que {it.firstName} saiu</span>
          <input type="time" required value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
      )}
      <label className="field">
        <span>
          {open === "remover" && `Remover o check-in de ${it.firstName}. Motivo:`}
          {open === "registrar_saida" && "Motivo:"}
          {open === "desfazer_saida" && `Desfazer a saída de ${it.firstName} (a presença continua). Motivo:`}
        </span>
        <input autoFocus value={reason} maxLength={200}
          placeholder={open === "remover" ? "Ex.: feito por outra pessoa" : open === "registrar_saida" ? "Ex.: esqueceu de confirmar a saída" : "Ex.: confirmou sem querer, ainda está no culto"}
          onChange={(e) => setReason(e.target.value)} />
      </label>
      {error && <div className="alert" role="alert">{error}</div>}
      <div className="post__fix-actions">
        <button className={`chip ${open === "remover" ? "chip--danger" : ""}`} disabled={busy}>
          {busy ? "Salvando…" : open === "remover" ? "Remover presença" : open === "registrar_saida" ? "Registrar saída" : "Desfazer saída"}
        </button>
        <button type="button" className="chip" onClick={close}>Cancelar</button>
      </div>
    </form>
  );
}
