"use client";

import { useEffect, useState } from "react";
import { Shell } from "@/components/Brand";
import { Camera } from "@/components/Camera";
import { brDateToIso, isValidBirthDate, isValidPhone, maskDate, maskPhone, nameTokens } from "@/lib/format";

type Coords = { lat: number; lng: number; accuracy: number };
type PhotoKind = "registro" | "criativa";
/** Identificação feita na entrada, guardada no celular até a foto (que pode ser já dentro do culto). */
type Pending = { token: string; firstName: string; photoKind: PhotoKind; expiresAt: string };

type Step =
  | { name: "boot" }
  | { name: "intro" }
  | { name: "locating" }
  | { name: "denied" }
  | { name: "outside"; distance: number; radius: number; accuracy: number }
  | { name: "identify" }
  | { name: "explain"; pending: Pending; justRegistered: boolean }
  | { name: "photo"; pending: Pending }
  | { name: "success"; who: string; photo: string | null; at: string | null; repeat: boolean; kind: "registro" | "criativa" | "visitante" };

const PENDING_KEY = "o2_checkin_pendente";

function loadPending(): Pending | null {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "null") as Pending | null;
    return p && new Date(p.expiresAt).getTime() > Date.now() + 60_000 ? p : null;
  } catch {
    return null;
  }
}
const savePending = (p: Pending | null) => {
  try {
    if (p) localStorage.setItem(PENDING_KEY, JSON.stringify(p));
    else localStorage.removeItem(PENDING_KEY);
  } catch {}
};

async function post<T = any>(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

const FACE_CODES = ["ROSTO_NAO_CONFERE", "SEM_ROSTO", "VARIOS_ROSTOS", "ROSTO_PEQUENO", "IMAGEM_INVALIDA"];

export default function CheckinPage() {
  const [step, setStep] = useState<Step>({ name: "boot" });
  const [testMode, setTestMode] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [who, setWho] = useState<"membro" | "visitante">("membro");
  const [name, setName] = useState("");
  const [birth, setBirth] = useState("");
  const [phone, setPhone] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ msg: string; code?: string } | null>(null);

  useEffect(() => {
    (async () => {
      // Já se identificou na entrada? Vai direto para a foto.
      const pending = loadPending();
      if (pending) return setStep({ name: "photo", pending });

      const cfg = await fetch("/api/checkin/local").then((r) => r.json()).catch(() => ({}));
      if (cfg.disabled) {
        setTestMode(true);
        return setStep({ name: "identify" });
      }
      setStep({ name: "intro" });
      const p = await navigator.permissions?.query({ name: "geolocation" as PermissionName }).catch(() => null);
      if (p?.state === "granted") locate();
      if (p?.state === "denied") setStep({ name: "denied" });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function locate() {
    if (!("geolocation" in navigator)) {
      setError({ msg: "Este navegador não oferece localização. Tente pelo Chrome ou Safari." });
      return;
    }
    setError(null);
    setStep({ name: "locating" });
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const c = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) };
        setCoords(c);
        const r = await post("/api/checkin/local", c);
        if (!r.ok) {
          setError({ msg: r.data.error ?? "Erro ao verificar o local." });
          setStep({ name: "intro" });
        } else if (r.data.ok) setStep({ name: "identify" });
        else setStep({ name: "outside", distance: r.data.distance, radius: r.data.radius, accuracy: c.accuracy });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setStep({ name: "denied" });
        else {
          setError({ msg: "Não conseguimos sua localização. Verifique se o GPS está ligado e tente de novo." });
          setStep({ name: "intro" });
        }
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  }

  async function identify(e: React.FormEvent) {
    e.preventDefault();
    if (nameTokens(name).length < 2) return setError({ msg: "Digite seu nome completo (nome e sobrenome)." });
    const birthIso = brDateToIso(birth);
    if (!isValidBirthDate(birthIso)) return setError({ msg: "Data de nascimento inválida. Use DD/MM/AAAA." });
    setBusy(true);
    setError(null);
    const r = await post("/api/checkin/identificar", { name, birthDate: birthIso, ...coords });
    setBusy(false);
    if (!r.ok) {
      if (r.data.code === "FORA_DO_LOCAL") return locate();
      return setError({ msg: r.data.error ?? "Erro inesperado.", code: r.data.code });
    }
    if (r.data.alreadyCheckedIn)
      return setStep({ name: "success", who: r.data.name, photo: r.data.photoUrl, at: r.data.checkedInAt, repeat: true, kind: "criativa" });
    const pending: Pending = { token: r.data.token, firstName: r.data.firstName, photoKind: r.data.photoKind, expiresAt: r.data.expiresAt };
    savePending(pending);
    setPhoto(null);
    // 1º check-in: foto de registro primeiro. Demais: explica a foto criativa antes da câmera.
    setStep(pending.photoKind === "registro" ? { name: "photo", pending } : { name: "explain", pending, justRegistered: false });
  }

  async function confirm(pending: Pending) {
    if (!photo) return;
    setBusy(true);
    setError(null);
    const r = await post("/api/checkin/confirmar", { token: pending.token, photo });
    setBusy(false);
    if (!r.ok) {
      if (r.data.code === "TOKEN") {
        savePending(null);
        setError({ msg: r.data.error });
        return setStep({ name: "intro" });
      }
      if (r.data.code === "DUPLICADO") {
        // Rosto conferido e já havia check-in hoje: mostra o check-in existente.
        savePending(null);
        return setStep({ name: "success", who: r.data.name, photo: r.data.photoUrl, at: r.data.checkedInAt, repeat: true, kind: "criativa" });
      }
      if (FACE_CODES.includes(r.data.code)) setPhoto(null);
      return setError({ msg: r.data.error ?? "Erro inesperado.", code: r.data.code });
    }
    if (r.data.registered) {
      // Foto de registro salva no cadastro. Falta a foto criativa para concluir o check-in.
      const next: Pending = { ...pending, photoKind: "criativa" };
      savePending(next);
      setPhoto(null);
      return setStep({ name: "explain", pending: next, justRegistered: true });
    }
    savePending(null);
    setStep({ name: "success", who: r.data.name, photo, at: r.data.checkedInAt, repeat: false, kind: r.data.photoKind });
  }

  async function visitor(e: React.FormEvent) {
    e.preventDefault();
    if (nameTokens(name).length < 2) return setError({ msg: "Digite seu nome e sobrenome." });
    if (!isValidPhone(phone)) return setError({ msg: "Digite um telefone válido com DDD." });
    setBusy(true);
    setError(null);
    const r = await post("/api/checkin/visitante", { name, phone, photo, ...coords });
    setBusy(false);
    if (!r.ok) {
      if (r.data.code === "FORA_DO_LOCAL") return locate();
      return setError({ msg: r.data.error ?? "Erro inesperado." });
    }
    setStep({ name: "success", who: r.data.name, photo, at: r.data.checkedInAt ?? null, repeat: !!r.data.alreadyCheckedIn, kind: "visitante" });
  }

  const errorBox = error && (
    <div className="alert" role="alert">
      {error.msg}
      {error.code === "NAO_ENCONTRADO" && (
        <>
          {" "}
          Primeira vez na O2?{" "}
          <button type="button" className="linklike" onClick={() => { setWho("visitante"); setError(null); }}>
            Entre como visitante
          </button>
          .
        </>
      )}
    </div>
  );

  return (
    <Shell compact={step.name === "success"}>
      <Progress step={step.name} />

      {step.name === "boot" && (
        <div className="center"><div className="spinner" aria-hidden /></div>
      )}

      {step.name === "intro" && (
        <>
          <h1>Check-in do culto</h1>
          <p className="lead">Primeiro vamos confirmar que você está no local do culto.</p>
          <div className="info">
            <PinIcon />
            <span>
              Quando o celular perguntar, toque em <strong>Permitir</strong>. No iPhone, deixe a{" "}
              <strong>Localização Precisa</strong> ligada.
            </span>
          </div>
          {errorBox}
          <button className="btn" onClick={locate}>Ativar localização</button>
        </>
      )}

      {step.name === "locating" && (
        <div className="center">
          <div className="spinner" aria-hidden />
          <h2>Verificando sua localização…</h2>
          <p className="hint">Isso leva só alguns segundos.</p>
        </div>
      )}

      {step.name === "denied" && (
        <>
          <h1>Localização bloqueada</h1>
          <p className="lead">Sem a localização não dá para confirmar que você está no culto. Para liberar:</p>
          <ul className="steps">
            <li><strong>iPhone:</strong> Ajustes › Privacidade › Serviços de Localização › Safari (ou Chrome) › <em>Ao Usar o App</em> e ligue <em>Localização Precisa</em>.</li>
            <li><strong>Android:</strong> toque no cadeado ao lado do endereço › Permissões › Localização › <em>Permitir</em>.</li>
          </ul>
          <button className="btn" onClick={() => location.reload()}>Já liberei, tentar de novo</button>
        </>
      )}

      {step.name === "outside" && (
        <>
          <h1>Você não está no local</h1>
          <p className="lead">
            Sua localização está a cerca de <strong>{step.distance.toLocaleString("pt-BR")} m</strong> do local do culto
            (limite: {step.radius} m).
          </p>
          {step.accuracy > step.radius && (
            <div className="info">
              <PinIcon />
              <span>
                A precisão do GPS está baixa (±{step.accuracy} m). Ligue a <strong>Localização Precisa</strong> e o Wi-Fi, e
                tente perto de uma janela.
              </span>
            </div>
          )}
          <button className="btn" onClick={locate}>Tentar novamente</button>
        </>
      )}

      {step.name === "identify" && (
        <>
          {testMode ? (
            <div className="test-chip">Modo teste · localização desativada</div>
          ) : (
            <div className="ok-chip">✓ Local confirmado</div>
          )}
          <div className="segmented" role="tablist" aria-label="Tipo de check-in">
            <button role="tab" aria-selected={who === "membro"} className={who === "membro" ? "on" : ""}
              onClick={() => { setWho("membro"); setError(null); }}>Tenho cadastro</button>
            <button role="tab" aria-selected={who === "visitante"} className={who === "visitante" ? "on" : ""}
              onClick={() => { setWho("visitante"); setError(null); setPhoto(null); }}>Sou visitante</button>
          </div>

          {who === "membro" ? (
            <form onSubmit={identify} noValidate>
              <h1>Quem é você?</h1>
              <label className="field">
                <span>Nome completo</span>
                <input autoComplete="name" placeholder="Ex.: Ana Beatriz Souza" value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="field">
                <span>Data de nascimento</span>
                <input inputMode="numeric" autoComplete="bday" placeholder="DD/MM/AAAA" maxLength={10} value={birth}
                  onChange={(e) => setBirth(maskDate(e.target.value))} />
              </label>
              {errorBox}
              <button className="btn" disabled={busy}>{busy ? "Procurando…" : "Continuar"}</button>
            </form>
          ) : (
            <form onSubmit={visitor} noValidate>
              <h1>Bem-vindo(a) à O2! 👋</h1>
              <p className="lead">Que bom ter você aqui. Só precisamos do seu nome e telefone.</p>
              <label className="field">
                <span>Nome e sobrenome</span>
                <input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="field">
                <span>Telefone (WhatsApp)</span>
                <input type="tel" inputMode="tel" autoComplete="tel" placeholder="(00) 00000-0000" value={phone}
                  onChange={(e) => setPhone(maskPhone(e.target.value))} />
              </label>
              <div className="field">
                <span>Foto criativa <em className="field__hint">(opcional)</em></span>
                <Camera value={photo} onChange={setPhoto} label="Tirar foto criativa" />
              </div>
              {errorBox}
              <button className="btn" disabled={busy}>{busy ? "Enviando…" : "Fazer check-in"}</button>
            </form>
          )}
        </>
      )}

      {step.name === "explain" && (
        <div className="explain">
          {step.justRegistered ? (
            <div className="ok-chip">✓ Foto de registro salva: seu cadastro está completo</div>
          ) : (
            <div className="ok-chip">✓ {step.pending.firstName}, você foi identificado(a)</div>
          )}
          <h1>Agora, a foto criativa 📸</h1>
          <p className="lead">É ela que conclui o seu check-in.</p>
          <ul className="explain__list">
            <li><span className="explain__icon" aria-hidden>⛪</span><span>Tire <strong>quando o pastor pedir</strong>, durante o culto.</span></li>
            <li><span className="explain__icon" aria-hidden>🤳</span><span>Vale tudo: <strong>com os amigos, pose ou careta</strong>.</span></li>
            <li><span className="explain__icon" aria-hidden>🙂</span><span>Só precisa <strong>aparecer o seu rosto</strong>.</span></li>
          </ul>
          <button className="btn" onClick={() => setStep({ name: "photo", pending: step.pending })}>Entendi, tirar a foto criativa</button>
          <p className="hint center-text">
            Pode fechar o app enquanto isso: fica guardado neste celular até {fmtTime(step.pending.expiresAt)}.
          </p>
        </div>
      )}

      {step.name === "photo" && step.pending.photoKind === "registro" && (
        <>
          <h1>Oi, {step.pending.firstName}! 👋</h1>
          <div className="info info--first">
            <span aria-hidden>⭐</span>
            <span>
              <strong>Seu primeiro check-in!</strong> Primeiro, uma foto <strong>só do seu rosto</strong>, de frente e com boa
              luz. Ela completa seu cadastro e confirma que é você. Depois vem a foto criativa.
            </span>
          </div>
          <Camera value={photo} onChange={(p) => { setPhoto(p); if (p) setError(null); }} label="Abrir câmera" />
          {errorBox}
          {photo && (
            <button className="btn" onClick={() => confirm(step.pending)} disabled={busy}>
              {busy ? "Verificando rosto…" : "Salvar foto de registro"}
            </button>
          )}
        </>
      )}

      {step.name === "photo" && step.pending.photoKind === "criativa" && (
        <>
          <div className="ok-chip">✓ {step.pending.firstName}, você foi identificado(a)</div>
          <h1>Hora da foto criativa! 📸</h1>
          <p className="lead">
            Quando o pastor pedir, tire sua foto criativa: com os amigos, fazendo pose, careta… vale tudo, só
            precisa aparecer o seu rosto.
          </p>
          <Camera value={photo} onChange={(p) => { setPhoto(p); if (p) setError(null); }} label="Tirar foto criativa" />
          {errorBox}
          {photo && (
            <button className="btn" onClick={() => confirm(step.pending)} disabled={busy}>
              {busy ? "Verificando…" : "Enviar e concluir check-in"}
            </button>
          )}
          {!photo && (
            <p className="hint center-text">
              O pastor ainda não pediu? Pode fechar: sua identificação fica guardada neste celular até {fmtTime(step.pending.expiresAt)}.
            </p>
          )}
        </>
      )}

      {step.name === "success" && (
        <div className="center success">
          <div className="success__photo">
            {step.photo ? <img src={step.photo} alt={`Foto de ${step.who}`} /> : <div className="success__noimg" />}
            <span className="success__badge" aria-hidden>✓</span>
          </div>
          <h1>{step.repeat ? "Check-in já feito!" : "Check-in realizado!"}</h1>
          <p className="success__name">{step.who}</p>
          {step.kind === "visitante" && <span className="tag">Visitante</span>}
          {step.at && (
            <p className="hint">
              {step.repeat ? "Seu check-in de hoje foi registrado às " : "Registrado às "}
              <strong>{fmtTime(step.at)}</strong>. Bom culto! 🙌
            </p>
          )}
        </div>
      )}
    </Shell>
  );
}

function Progress({ step }: { step: Step["name"] }) {
  const order = ["local", "dados", "foto", "pronto"];
  const current = step === "identify" ? 1 : step === "photo" || step === "explain" ? 2 : step === "success" ? 4 : 0;
  return (
    <ol className="progress" aria-label="Etapas do check-in">
      {order.map((label, i) => (
        <li key={label} className={i < current ? "done" : i === current ? "active" : ""}>
          <span>{label}</span>
        </li>
      ))}
    </ol>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}
