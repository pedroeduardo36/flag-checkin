"use client";

import { useCallback, useEffect, useState } from "react";

type LeaderRow = {
  id: string;
  name: string;
  email: string;
  status: "ativo" | "desativado";
  authenticator: boolean;
  pendingActivation: boolean;
  lastLoginAt: string | null;
  activeSessions: number;
  recoveryCodesLeft: number;
};
type AuditRow = {
  id: number;
  at: string;
  actor_name: string | null;
  action: string;
  target_label: string | null;
  outcome: "ok" | "negado" | "bloqueado";
  details: Record<string, unknown> | null;
};
type DupMember = { id: string; name: string; birthDate: string; guardianName: string; createdAt: string; checkins: number; hasPhoto: boolean };
type DupPair = { duplicate: DupMember; original: DupMember; sameGuardian: boolean };
type MemberRow = {
  id: string; name: string; birthDate: string; guardianName: string | null; createdAt: string;
  confirmed: boolean; canCheckin: boolean; legacy: boolean; confirmBy: string | null; hasBiometrics: boolean;
};
type Issued = { name: string; email: string; code: string; expiresAt: string; reason: string };

const ACTION_LABEL: Record<string, string> = {
  login: "Entrou",
  login_codigo: "Código do autenticador",
  logout: "Saiu",
  conta_criada: "Criou conta",
  conta_ativada: "Ativou a conta",
  conta_desativada: "Desativou conta",
  conta_reativada: "Reativou conta",
  acesso_redefinido: "Redefiniu acesso",
  sessoes_revogadas: "Encerrou sessões",
  totp_cadastrado: "Cadastrou autenticador",
  recuperacao_usada: "Usou código de recuperação",
  codigos_recuperacao_gerados: "Gerou códigos de recuperação",
  presenca_removida: "Removeu presença",
  saida_registrada: "Registrou saída",
  saida_desfeita: "Desfez saída",
  duplicado_descartado: "Marcou como pessoas diferentes",
  cadastro_mesclado: "Mesclou cadastros duplicados",
  consentimento_registrado: "Responsável confirmou o cadastro",
  cadastro_apagado: "Apagou cadastro",
  biometria_revogada: "Retirou a biometria",
  dados_exportados: "Exportou dados de um cadastro",
  confirmacao_reenviada: "Reenviou confirmação ao responsável",
  expurgo_retencao: "Limpeza automática por prazo",
};

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

async function send(method: string, path: string, body?: unknown) {
  const r = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => null);
  return { status: r?.status ?? 0, data: (r ? await r.json().catch(() => ({})) : {}) as Record<string, any> };
}

/** "Líderes" tab: accounts, sessions, activation/recovery codes and the action log. */
export function LeadersAdmin({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [me, setMe] = useState<{ id: string } | null>(null);
  const [leaders, setLeaders] = useState<LeaderRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [c, a] = await Promise.all([send("GET", "/api/lider/contas"), send("GET", "/api/lider/auditoria")]);
    if (c.status === 401 || a.status === 401) return onUnauthorized();
    if (c.status !== 200) return setError(c.data.error ?? "Não foi possível carregar os líderes.");
    setMe(c.data.me);
    setLeaders(c.data.leaders);
    setAudit(a.data.items ?? []);
  }, [onUnauthorized]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(l: LeaderRow, action: "desativar" | "reativar" | "redefinir" | "revogar_sessoes") {
    const self = l.id === me?.id;
    const ask: Record<typeof action, string> = {
      desativar: `Desativar a conta de ${l.name}? As sessões abertas dela terminam agora.`,
      reativar: `Reativar a conta de ${l.name}? Ela vai precisar de um novo código de ativação para definir senha e autenticador.`,
      redefinir: `Redefinir o acesso de ${l.name}? Senha, autenticador e códigos de recuperação atuais deixam de valer. Faça isso só depois de confirmar pessoalmente que é ela.`,
      revogar_sessoes: self ? "Encerrar a sua sessão nos outros aparelhos? Este continua conectado." : `Encerrar todas as sessões abertas de ${l.name}?`,
    };
    if (!window.confirm(ask[action])) return;
    setBusy(`${l.id}:${action}`);
    setError(null);
    setNotice(null);
    const r = await send("PATCH", "/api/lider/contas", { id: l.id, action });
    setBusy(null);
    if (r.status === 401) return onUnauthorized();
    if (r.status !== 200) return setError(r.data.error ?? "Não foi possível concluir.");
    if (r.data.setupCode) {
      setIssued({ name: l.name, email: l.email, code: r.data.setupCode, expiresAt: r.data.expiresAt, reason: action === "reativar" ? "Conta reativada" : "Acesso redefinido" });
    } else {
      setNotice(action === "desativar" ? `${l.name} desativado(a). ${r.data.sessionsEnded} sessão(ões) encerrada(s).` : `${r.data.sessionsEnded} sessão(ões) encerrada(s).`);
    }
    load();
  }

  return (
    <section aria-label="Líderes" className="leaders">
      {error && <div className="alert" role="alert">{error}</div>}
      {notice && <div className="info" role="status">{notice}</div>}
      {issued && <IssuedCode issued={issued} onClose={() => setIssued(null)} />}

      <FamilyRequests onUnauthorized={onUnauthorized} onDone={load} />
      <Duplicates onUnauthorized={onUnauthorized} onDone={load} />

      <div className="card dash__card">
        <h3>Líderes</h3>
        <p className="hint dash__sub">Todos os líderes entram com senha e app autenticador.</p>
        <ul className="leader-list">
          {leaders.map((l) => {
            const self = l.id === me?.id;
            return (
              <li key={l.id} className={`leader ${l.status === "desativado" ? "leader--off" : ""}`}>
                <div className="leader__head">
                  <div className="leader__who">
                    <strong>{l.name}{self && " (você)"}</strong>
                    <span>{l.email}</span>
                  </div>
                </div>
                <div className="leader__tags">
                  {l.status === "desativado" ? <span className="tag tag--warn">Desativado</span>
                    : l.authenticator ? <span className="tag tag--ok">✓ Autenticador</span>
                    : <span className="tag tag--warn">{l.pendingActivation ? "Aguardando ativação" : "Sem autenticador"}</span>}
                  {l.status === "ativo" && <span className="tag">{l.activeSessions} sessão(ões) aberta(s)</span>}
                  {l.authenticator && <span className={`tag ${l.recoveryCodesLeft <= 2 ? "tag--warn" : ""}`}>{l.recoveryCodesLeft} códigos de recuperação</span>}
                </div>
                <p className="hint leader__last">{l.lastLoginAt ? `Último acesso: ${fmtWhen(l.lastLoginAt)}` : "Ainda não entrou"}</p>
                <div className="leader__actions">
                  {l.status === "ativo" && l.activeSessions > (self ? 1 : 0) && (
                    <button className="chip" disabled={!!busy} onClick={() => act(l, "revogar_sessoes")}>
                      {self ? "Sair dos outros aparelhos" : "Encerrar sessões"}
                    </button>
                  )}
                  {!self && l.status === "ativo" && (
                    <button className="chip" disabled={!!busy} onClick={() => act(l, "redefinir")}>Redefinir acesso</button>
                  )}
                  {!self && l.status === "ativo" && (
                    <button className="chip chip--danger" disabled={!!busy} onClick={() => act(l, "desativar")}>Desativar</button>
                  )}
                  {!self && l.status === "desativado" && (
                    <button className="chip" disabled={!!busy} onClick={() => act(l, "reativar")}>Reativar</button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <NewLeader onCreated={(i) => { setIssued(i); load(); }} onUnauthorized={onUnauthorized} />
      <MyRecoveryCodes onUnauthorized={onUnauthorized} onDone={load} />

      <div className="card dash__card">
        <h3>Registro de ações</h3>
        <p className="hint dash__sub">Somente leitura: o banco recusa editar ou apagar. Senhas e códigos nunca entram aqui.</p>
        <ol className="audit">
          {audit.map((a) => (
            <li key={a.id} className={`audit__row audit__row--${a.outcome}`}>
              <time dateTime={a.at}>{fmtWhen(a.at)}</time>
              <div>
                <b>{a.actor_name ?? "Sem login"}</b> · {ACTION_LABEL[a.action] ?? a.action}
                {a.target_label && <> · <span className="audit__target">{a.target_label}</span></>}
                {a.outcome !== "ok" && <span className="audit__outcome"> ({a.outcome})</span>}
                {typeof a.details?.motivo === "string" && <div className="hint">Motivo: {a.details.motivo}</div>}
              </div>
            </li>
          ))}
          {!audit.length && <li className="hint">Nenhuma ação registrada ainda.</li>}
        </ol>
      </div>
    </section>
  );
}

const fmtDate = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

/**
 * Family requests: view (export), resend the confirmation, withdraw biometrics and delete.
 * Before acting, confirm the requester is the guardian (docs/privacy/family-requests.md).
 */
function FamilyRequests({ onUnauthorized, onDone }: { onUnauthorized: () => void; onDone: () => void }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<MemberRow[] | null>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function list(path: string, label: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const r = await send("GET", path);
    setBusy(false);
    if (r.status === 401) return onUnauthorized();
    if (r.status !== 200) return setError(r.data.error ?? "Não foi possível buscar.");
    setItems(r.data.items);
    setTitle(label);
  }

  async function exportData(m: MemberRow) {
    const r = await send("GET", `/api/lider/cadastros?exportar=${m.id}`);
    if (r.status === 401) return onUnauthorized();
    if (r.status !== 200) return setError(r.data.error ?? "Não foi possível exportar.");
    const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `dados-${m.name.split(" ")[0].toLowerCase()}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setNotice(`Arquivo com os dados de ${m.name} baixado. Envie só para o responsável e apague a sua cópia depois.`);
    onDone();
  }

  async function act(m: MemberRow, action: "reenviar" | "revogar_biometria" | "apagar") {
    setError(null);
    setNotice(null);
    let r;
    if (action === "apagar") {
      const reason = window.prompt(`Apagar o cadastro de ${m.name}? Saem dados, fotos, dados do rosto e presenças, sem volta.\n\nMotivo (ex.: pedido do responsável por e-mail em 30/10):`);
      if (!reason) return;
      r = await send("DELETE", "/api/lider/cadastros", { id: m.id, reason });
    } else {
      const ask = action === "reenviar"
        ? `Enviar um novo link de confirmação para o(s) e-mail(s) do responsável de ${m.name}?`
        : `Retirar a biometria de ${m.name}? A foto de registro e os dados do rosto são apagados, e o check-in só volta se o responsável confirmar de novo (o cadastro é apagado em 7 dias sem isso).`;
      if (!window.confirm(ask)) return;
      r = await send("PATCH", "/api/lider/cadastros", { id: m.id, action });
    }
    if (r.status === 401) return onUnauthorized();
    if (r.status !== 200) return setError(r.data.error ?? "Não foi possível concluir.");
    setNotice(action === "apagar" ? `Cadastro de ${m.name} apagado.` : action === "reenviar" ? "Link enviado." : "Biometria retirada.");
    setItems((prev) => (action === "apagar" ? prev?.filter((x) => x.id !== m.id) ?? null : prev));
    if (action !== "apagar") list(`/api/lider/cadastros?q=${encodeURIComponent(m.name)}`, title);
    onDone();
  }

  return (
    <div className="card dash__card">
      <h3>Cadastros e pedidos das famílias</h3>
      <p className="hint dash__sub">
        Ver, corrigir, apagar ou retirar a autorização. Antes de atender, confirme que quem pede é o responsável.
      </p>
      <form className="search-row" onSubmit={(e) => { e.preventDefault(); list(`/api/lider/cadastros?q=${encodeURIComponent(q)}`, `Resultado para "${q}"`); }}>
        <input placeholder="Nome do adolescente" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
        <button className="chip" disabled={busy || !q.trim()}>Buscar</button>
      </form>
      <button className="add-email" onClick={() => list("/api/lider/cadastros?pendentes=1", "Aguardando confirmação do responsável")}>
        Ver cadastros aguardando confirmação
      </button>
      {error && <div className="alert" role="alert">{error}</div>}
      {notice && <div className="info" role="status">{notice}</div>}
      {items && (
        <>
          <p className="hint"><b>{title}</b> · {items.length} cadastro(s)</p>
          <ul className="leader-list">
            {items.map((m) => (
              <li key={m.id} className="leader">
                <div className="dup__side">
                  <strong>{m.name}</strong>
                  <span className="hint">Nasc. {fmtDate(m.birthDate)} · resp. {m.guardianName ?? "—"} · cadastrado em {fmtDay(m.createdAt)}</span>
                </div>
                <div className="leader__tags">
                  {m.confirmed ? <span className="tag tag--ok">✓ Confirmado pelo responsável</span>
                    : <span className="tag tag--warn">{m.legacy ? "Cadastro antigo: confirmar" : "Aguardando confirmação"}{m.confirmBy ? ` até ${fmtDate(m.confirmBy)}` : ""}</span>}
                  {!m.canCheckin && <span className="tag tag--warn">Check-in bloqueado</span>}
                  {m.hasBiometrics && <span className="tag">Com dados do rosto</span>}
                </div>
                <div className="leader__actions">
                  <button className="chip" onClick={() => exportData(m)}>Exportar dados</button>
                  {!m.confirmed && <button className="chip" onClick={() => act(m, "reenviar")}>Reenviar confirmação</button>}
                  {(m.hasBiometrics || m.confirmed) && <button className="chip" onClick={() => act(m, "revogar_biometria")}>Retirar biometria</button>}
                  <button className="chip chip--danger" onClick={() => act(m, "apagar")}>Apagar cadastro</button>
                </div>
              </li>
            ))}
          </ul>
          {!items.length && <p className="hint">Nenhum cadastro encontrado.</p>}
        </>
      )}
    </div>
  );
}

/** Similar registrations (same birth date and a compatible name) waiting for a leader's decision. */
function Duplicates({ onUnauthorized, onDone }: { onUnauthorized: () => void; onDone: () => void }) {
  const [pairs, setPairs] = useState<DupPair[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await send("GET", "/api/lider/duplicados");
    if (r.status === 401) return onUnauthorized();
    if (r.status !== 200) return setError(r.data.error ?? "Não foi possível carregar os possíveis duplicados.");
    setPairs(r.data.pairs);
  }, [onUnauthorized]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(p: DupPair, action: "pessoas_diferentes" | "mesclar") {
    const ask =
      action === "mesclar"
        ? `Mesclar os cadastros? As presenças de "${p.duplicate.name}" passam para o cadastro de ${fmtDay(p.original.createdAt)} e o cadastro mais novo é apagado.`
        : `Manter os dois cadastros? "${p.duplicate.name}" e "${p.original.name}" ficam como pessoas diferentes.`;
    if (!window.confirm(ask)) return;
    setBusy(p.duplicate.id);
    setError(null);
    const r = await send("PATCH", "/api/lider/duplicados", { id: p.duplicate.id, action });
    setBusy(null);
    if (r.status === 401) return onUnauthorized();
    if (r.status !== 200) return setError(r.data.error ?? "Não foi possível concluir.");
    load();
    onDone();
  }

  if (!pairs) return error ? <div className="alert" role="alert">{error}</div> : null;
  return (
    <div className="card dash__card">
      <h3>Possíveis cadastros duplicados</h3>
      <p className="hint dash__sub">Mesmo nascimento e nome parecido. Enquanto houver dois cadastros iguais, o check-in pede o nome completo ou um líder.</p>
      {error && <div className="alert" role="alert">{error}</div>}
      {!pairs.length && <p className="hint">Nenhum cadastro para revisar.</p>}
      <ul className="leader-list">
        {pairs.map((p) => (
          <li key={p.duplicate.id} className="leader dup">
            {[["Novo", p.duplicate], ["Existente", p.original]].map(([label, m]) => {
              const x = m as DupMember;
              return (
                <div key={x.id} className="dup__side">
                  <span className="tag">{label as string}</span>
                  <strong>{x.name}</strong>
                  <span className="hint">
                    Nasc. {x.birthDate.split("-").reverse().join("/")} · resp. {x.guardianName} · cadastrado em {fmtDay(x.createdAt)}
                    {" · "}{x.checkins} presença(s){x.hasPhoto ? " · com foto" : ""}
                  </span>
                </div>
              );
            })}
            <div className="leader__tags">
              <span className={`tag ${p.sameGuardian ? "tag--warn" : ""}`}>{p.sameGuardian ? "Mesmo contato do responsável" : "Contatos do responsável diferentes"}</span>
            </div>
            <div className="leader__actions">
              <button className="chip" disabled={!!busy} onClick={() => act(p, "mesclar")}>É a mesma pessoa: mesclar</button>
              <button className="chip" disabled={!!busy} onClick={() => act(p, "pessoas_diferentes")}>São pessoas diferentes</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

function IssuedCode({ issued, onClose }: { issued: Issued; onClose: () => void }) {
  return (
    <div className="card dash__card issued" role="status">
      <h3>{issued.reason}: {issued.name}</h3>
      <p className="hint dash__sub">
        Código de ativação de uso único, válido até {fmtWhen(issued.expiresAt)}. Entregue <b>pessoalmente</b> (não mande por
        grupo). A pessoa abre <b>/pastor → Ativar conta</b>, usa o e-mail {issued.email}, cria a senha e cadastra o autenticador.
      </p>
      <code className="issued__code">{issued.code}</code>
      <p className="hint">Este código não aparece de novo.</p>
      <button className="btn btn--ghost" onClick={onClose}>Já entreguei, fechar</button>
    </div>
  );
}

function NewLeader({ onCreated, onUnauthorized }: { onCreated: (i: Issued) => void; onUnauthorized: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await send("POST", "/api/lider/contas", { name, email });
    setBusy(false);
    if (r.status === 401) return onUnauthorized();
    if (r.status !== 200) return setError(r.data.errors ? Object.values(r.data.errors).join(" ") : r.data.error ?? "Não foi possível criar.");
    onCreated({ name: r.data.name, email: r.data.email, code: r.data.setupCode, expiresAt: r.data.expiresAt, reason: "Conta criada" });
    setName("");
    setEmail("");
    setOpen(false);
  }

  if (!open)
    return <button className="add-email" onClick={() => setOpen(true)}>+ Adicionar líder</button>;
  return (
    <form className="card dash__card" onSubmit={submit} noValidate>
      <h3>Novo líder</h3>
      <p className="hint dash__sub">A pessoa recebe um código de ativação e cria a própria senha. Você não fica sabendo a senha dela.</p>
      <label className="field">
        <span>Nome completo</span>
        <input autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>E-mail (usado para entrar)</span>
        <input type="email" inputMode="email" autoCapitalize="none" spellCheck={false} autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      {error && <div className="alert" role="alert">{error}</div>}
      <button className="btn" disabled={busy}>{busy ? "Criando…" : "Criar conta"}</button>
      <button type="button" className="btn btn--ghost leaders__cancel" onClick={() => setOpen(false)}>Cancelar</button>
    </form>
  );
}

function MyRecoveryCodes({ onUnauthorized, onDone }: { onUnauthorized: () => void; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await send("POST", "/api/lider/recuperacao", { code });
    setBusy(false);
    setCode("");
    if (r.status === 401) return onUnauthorized();
    if (r.status !== 200) return setError(r.data.error ?? "Não foi possível gerar.");
    setCodes(r.data.recoveryCodes);
    onDone();
  }

  if (codes)
    return (
      <div className="card dash__card">
        <h3>Seus novos códigos de recuperação</h3>
        <p className="hint dash__sub">Os anteriores deixaram de valer. Guarde estes agora: eles não aparecem de novo.</p>
        <ul className="codes">{codes.map((c) => <li key={c}><code>{c}</code></li>)}</ul>
        <button className="btn btn--ghost" onClick={() => { setCodes(null); setOpen(false); }}>Guardei, fechar</button>
      </div>
    );
  if (!open) return <button className="add-email" onClick={() => setOpen(true)}>↻ Gerar novos códigos de recuperação (minha conta)</button>;
  return (
    <form className="card dash__card" onSubmit={submit} noValidate>
      <h3>Novos códigos de recuperação</h3>
      <p className="hint dash__sub">Confirme com o código atual do seu app autenticador.</p>
      <label className="field">
        <span>Código de 6 dígitos</span>
        <input className="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
      </label>
      {error && <div className="alert" role="alert">{error}</div>}
      <button className="btn" disabled={busy || code.length !== 6}>{busy ? "Gerando…" : "Gerar códigos"}</button>
      <button type="button" className="btn btn--ghost leaders__cancel" onClick={() => setOpen(false)}>Cancelar</button>
    </form>
  );
}
