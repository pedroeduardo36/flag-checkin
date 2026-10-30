"use client";

import { useEffect, useState } from "react";
import { Brand } from "@/components/Brand";

export type AuthStep = "login" | "code" | "activate" | "enroll" | "recoveryCodes";

type Props = { initial: AuthStep; onDone: () => void };

async function call(path: string, method: string, body?: unknown) {
  const r = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => null);
  const data = r ? await r.json().catch(() => ({})) : {};
  return { status: r?.status ?? 0, data: data as Record<string, any> };
}

const errorOf = (r: { status: number; data: Record<string, any> }) =>
  r.status === 0 ? "Sem conexão. Tente de novo." : r.data.error ?? "Não foi possível continuar. Tente de novo.";

/**
 * Leader access: email + password → authenticator app code. First access (or access reset by another
 * leader): activation code → new password → authenticator enrollment → recovery codes.
 * There is no SMS or email fallback.
 */
export function LeaderAuth({ initial, onDone }: Props) {
  const [step, setStep] = useState<AuthStep>(initial);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  const enrolled = (codes: string[]) => {
    setRecoveryCodes(codes);
    setStep("recoveryCodes");
  };

  return (
    <main className="shell">
      <Brand />
      <section className="card">
        {step === "login" && <Login onNext={() => setStep("code")} onActivate={() => setStep("activate")} />}
        {step === "code" && <Code onOk={onDone} onEnroll={() => setStep("enroll")} onRestart={() => setStep("login")} />}
        {step === "activate" && <Activate onNext={() => setStep("enroll")} onBack={() => setStep("login")} />}
        {step === "enroll" && <Enroll onDone={enrolled} onExpired={() => setStep("login")} />}
        {step === "recoveryCodes" && <RecoveryCodes codes={recoveryCodes} onContinue={onDone} />}
      </section>
      <footer className="foot">Ministério Flag · Juventude O2 · área dos líderes</footer>
    </main>
  );
}

function Login({ onNext, onActivate }: { onNext: () => void; onActivate: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) return setError("Informe e-mail e senha.");
    setBusy(true);
    setError(null);
    const r = await call("/api/lider/entrar", "POST", { email, password });
    setBusy(false);
    if (r.status === 200) return onNext();
    setPassword("");
    setError(errorOf(r));
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="lock" aria-hidden>🔒</div>
      <h1>Área dos líderes</h1>
      <p className="lead">Check-ins ao vivo, dashboard e cadastro. Cada líder entra com a própria conta.</p>
      <label className="field">
        <span>E-mail</span>
        <input type="email" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus
          value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="field">
        <span>Senha</span>
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error && <div className="alert" role="alert">{error}</div>}
      <button className="btn" disabled={busy}>{busy ? "Conferindo…" : "Continuar"}</button>
      <p className="hint center-text">
        Primeiro acesso ou acesso redefinido?{" "}
        <button type="button" className="linklike" onClick={onActivate}>Ativar conta</button>
      </p>
    </form>
  );
}

function Code({ onOk, onEnroll, onRestart }: { onOk: () => void; onEnroll: () => void; onRestart: () => void }) {
  const [mode, setMode] = useState<"app" | "recovery">("app");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await call("/api/lider/verificar", "POST", mode === "app" ? { code } : { recoveryCode: code });
    setBusy(false);
    if (r.status === 200) return r.data.stage === "cadastro_totp" ? onEnroll() : onOk();
    setCode("");
    if (r.status === 401 && /Comece de novo/.test(r.data.error ?? "")) return onRestart();
    if (r.status === 429) {
      setError(errorOf(r));
      return setTimeout(onRestart, 2500);
    }
    setError(errorOf(r));
  }

  async function restart() {
    await call("/api/lider/verificar", "DELETE");
    onRestart();
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="lock" aria-hidden>📱</div>
      {mode === "app" ? (
        <>
          <h1>Código do autenticador</h1>
          <p className="lead">Abra o app autenticador no seu celular e digite o código de 6 dígitos de <b>Flag O2</b>.</p>
          <label className="field">
            <span>Código</span>
            <input className="otp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} autoFocus
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
          </label>
        </>
      ) : (
        <>
          <h1>Código de recuperação</h1>
          <p className="lead">
            Perdeu o celular? Use um dos códigos de recuperação que você guardou. Cada código vale uma vez, e em seguida você
            cadastra o autenticador num aparelho novo.
          </p>
          <label className="field">
            <span>Código de recuperação</span>
            <input className="otp otp--text" autoCapitalize="characters" autoComplete="off" spellCheck={false} autoFocus
              placeholder="XXXXX-XXXXX" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 11))} />
          </label>
        </>
      )}
      {error && <div className="alert" role="alert">{error}</div>}
      <button className="btn" disabled={busy || (mode === "app" ? code.length !== 6 : code.replace(/-/g, "").length !== 10)}>
        {busy ? "Conferindo…" : "Entrar"}
      </button>
      <p className="hint center-text">
        {mode === "app" ? (
          <button type="button" className="linklike" onClick={() => { setMode("recovery"); setCode(""); setError(null); }}>Perdi o celular</button>
        ) : (
          <button type="button" className="linklike" onClick={() => { setMode("app"); setCode(""); setError(null); }}>Usar o app autenticador</button>
        )}
        {" · "}
        <button type="button" className="linklike" onClick={restart}>Voltar</button>
      </p>
      {mode === "recovery" && (
        <p className="hint">Sem códigos de recuperação? Peça a outro líder para <b>redefinir o seu acesso</b> na aba Líderes.</p>
      )}
    </form>
  );
}

function Activate({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError("As duas senhas não são iguais.");
    setBusy(true);
    setError(null);
    const r = await call("/api/lider/ativar", "POST", { email, setupCode, password });
    setBusy(false);
    if (r.status === 200) return onNext();
    setError(errorOf(r));
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="lock" aria-hidden>🔑</div>
      <h1>Ativar conta</h1>
      <p className="lead">Use o código de ativação que outro líder te entregou. Depois você cadastra o app autenticador.</p>
      <label className="field">
        <span>E-mail</span>
        <input type="email" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus
          value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="field">
        <span>Código de ativação</span>
        <input className="otp otp--text" autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="XXXX-XXXX-XXXX"
          value={setupCode} onChange={(e) => setSetupCode(e.target.value.toUpperCase().slice(0, 14))} />
      </label>
      <label className="field">
        <span>Crie sua senha</span>
        <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <p className="hint field-hint">Pelo menos 10 caracteres. Uma frase curta é fácil de lembrar e difícil de adivinhar.</p>
      <label className="field">
        <span>Repita a senha</span>
        <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </label>
      {error && <div className="alert" role="alert">{error}</div>}
      <button className="btn" disabled={busy}>{busy ? "Ativando…" : "Ativar e continuar"}</button>
      <p className="hint center-text">
        <button type="button" className="linklike" onClick={onBack}>Voltar para o login</button>
      </p>
    </form>
  );
}

type Setup = { qr: string; uri: string; secret: string; email: string };

function Enroll({ onDone, onExpired }: { onDone: (codes: string[]) => void; onExpired: () => void }) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    call("/api/lider/autenticador", "GET").then((r) => {
      if (r.status === 401) return onExpired();
      if (r.status !== 200) return setError(errorOf(r));
      setSetup(r.data as Setup);
    });
  }, [onExpired]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await call("/api/lider/autenticador", "POST", { code });
    setBusy(false);
    if (r.status === 200) return onDone(r.data.recoveryCodes ?? []);
    if (r.status === 401) return onExpired();
    setCode("");
    setError(errorOf(r));
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="lock" aria-hidden>🛡️</div>
      <h1>Cadastre o app autenticador</h1>
      <p className="lead">Obrigatório para todos os líderes. Use Google Authenticator, Microsoft Authenticator, 1Password ou outro app de códigos.</p>
      <ol className="steps">
        <li><span>No app autenticador, toque em <b>+</b> e escaneie o QR code.</span></li>
        <li><span>Digite abaixo o código de 6 dígitos que aparecer.</span></li>
      </ol>
      {setup ? (
        <>
          <img className="qr-box" src={setup.qr} alt="QR code para o app autenticador" width={200} height={200} />
          <details className="secret">
            <summary>Está no mesmo celular? Digite a chave</summary>
            <p className="hint">Conta: {setup.email}</p>
            <code>{setup.secret}</code>
            <a className="btn btn--ghost" href={setup.uri}>Abrir no app autenticador</a>
          </details>
        </>
      ) : (
        !error && <div className="center"><div className="spinner" aria-hidden /></div>
      )}
      <label className="field">
        <span>Código de 6 dígitos</span>
        <input className="otp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6}
          value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
      </label>
      {error && <div className="alert" role="alert">{error}</div>}
      <button className="btn" disabled={busy || !setup || code.length !== 6}>{busy ? "Conferindo…" : "Confirmar"}</button>
    </form>
  );
}

function RecoveryCodes({ codes, onContinue }: { codes: string[]; onContinue: () => void }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = `Flag O2 · códigos de recuperação (cada um vale uma vez)\n\n${codes.join("\n")}`;

  async function copy() {
    await navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(true);
  }

  return (
    <div>
      <div className="lock" aria-hidden>🧾</div>
      <h1>Guarde seus códigos de recuperação</h1>
      <p className="lead">
        Se perder o celular, cada código substitui o app autenticador <b>uma vez</b>. Eles aparecem só agora. Guarde num
        gerenciador de senhas ou num papel em lugar seguro, longe do celular.
      </p>
      <ul className="codes" aria-label="Códigos de recuperação">
        {codes.map((c) => <li key={c}><code>{c}</code></li>)}
      </ul>
      <button type="button" className="btn btn--ghost" onClick={copy}>{copied ? "Copiado ✓" : "Copiar códigos"}</button>
      <label className="check">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <span>Guardei os códigos num lugar seguro</span>
      </label>
      <button className="btn" disabled={!saved} onClick={onContinue}>Entrar na área dos líderes</button>
    </div>
  );
}
