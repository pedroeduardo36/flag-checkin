"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Shell } from "@/components/Brand";
import { Camera } from "@/components/Camera";
import { brDateToIso, isValidBirthDate, isValidCpf, maskCpf, maskDate } from "@/lib/format";

type Coords = { lat: number; lng: number; accuracy: number };
type Step =
  | { name: "boot" }
  | { name: "intro" }
  | { name: "locating" }
  | { name: "denied" }
  | { name: "outside"; distance: number; radius: number; accuracy: number }
  | { name: "identify" }
  | { name: "selfie"; token: string; firstName: string }
  | { name: "success"; name_: string; photo: string | null; at: string; repeat: boolean };

async function post<T = any>(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

export default function CheckinPage() {
  const [step, setStep] = useState<Step>({ name: "boot" });
  const [testMode, setTestMode] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [cpf, setCpf] = useState("");
  const [birth, setBirth] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ msg: string; code?: string } | null>(null);

  useEffect(() => {
    (async () => {
      // Modo teste (GEOFENCE_DISABLED=true no servidor): pula a etapa de localização.
      const cfg = await fetch("/api/checkin/local").then((r) => r.json()).catch(() => ({}));
      if (cfg.disabled) {
        setTestMode(true);
        return setStep({ name: "identify" });
      }
      setStep({ name: "intro" });
      // Se a permissão já foi dada antes, pula direto para a verificação.
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
    if (!isValidCpf(cpf)) return setError({ msg: "CPF inválido. Confira os números." });
    const birthIso = brDateToIso(birth);
    if (!isValidBirthDate(birthIso)) return setError({ msg: "Data de nascimento inválida. Use DD/MM/AAAA." });
    setBusy(true);
    setError(null);
    const r = await post("/api/checkin/identificar", { cpf, birthDate: birthIso, ...coords });
    setBusy(false);
    if (!r.ok) {
      if (r.data.code === "FORA_DO_LOCAL") return locate();
      return setError({ msg: r.data.error ?? "Erro inesperado.", code: r.data.code });
    }
    if (r.data.alreadyCheckedIn)
      return setStep({ name: "success", name_: r.data.name, photo: r.data.photoUrl, at: r.data.checkedInAt, repeat: true });
    setPhoto(null);
    setStep({ name: "selfie", token: r.data.token, firstName: r.data.firstName });
  }

  async function confirm() {
    if (step.name !== "selfie" || !photo) return;
    setBusy(true);
    setError(null);
    const r = await post("/api/checkin/confirmar", { token: step.token, photo });
    setBusy(false);
    if (!r.ok) {
      if (r.data.code === "TOKEN") {
        setError({ msg: r.data.error });
        return setStep({ name: "identify" });
      }
      return setError({ msg: r.data.error ?? "Erro inesperado." });
    }
    setStep({ name: "success", name_: r.data.name, photo, at: r.data.checkedInAt, repeat: false });
  }

  const errorBox = error && (
    <div className="alert" role="alert">
      {error.msg}
      {error.code === "NAO_ENCONTRADO" && (
        <>
          {" "}
          Ainda não tem cadastro? <Link href="/cadastro">Cadastre-se aqui</Link>.
        </>
      )}
    </div>
  );

  return (
    <Shell compact={step.name === "success"}>
      <Progress step={step.name} />

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
          <Link href="/cadastro" className="link-center">Primeira vez? Faça seu cadastro</Link>
        </>
      )}

      {step.name === "boot" && (
        <div className="center">
          <div className="spinner" aria-hidden />
        </div>
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
        <form onSubmit={identify} noValidate>
          {testMode ? (
            <div className="test-chip">Modo teste · localização desativada</div>
          ) : (
            <div className="ok-chip">✓ Local confirmado</div>
          )}
          <h1>Quem é você?</h1>
          <label className="field">
            <span>CPF</span>
            <input inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" value={cpf}
              onChange={(e) => setCpf(maskCpf(e.target.value))} required />
          </label>
          <label className="field">
            <span>Data de nascimento</span>
            <input inputMode="numeric" autoComplete="bday" placeholder="DD/MM/AAAA" maxLength={10} value={birth}
              onChange={(e) => setBirth(maskDate(e.target.value))} required />
          </label>
          {errorBox}
          <button className="btn" disabled={busy}>{busy ? "Conferindo…" : "Continuar"}</button>
          <Link href="/cadastro" className="link-center">Não tenho cadastro</Link>
        </form>
      )}

      {step.name === "selfie" && (
        <>
          <h1>Oi, {step.firstName}! 👋</h1>
          <p className="lead">Tire uma selfie agora para confirmar que é você mesmo.</p>
          <Camera value={photo} onChange={setPhoto} label="Abrir câmera" />
          {errorBox}
          {photo && (
            <button className="btn" onClick={confirm} disabled={busy}>
              {busy ? "Enviando…" : "Confirmar check-in"}
            </button>
          )}
        </>
      )}

      {step.name === "success" && (
        <div className="center success">
          <div className="success__photo">
            {step.photo ? <img src={step.photo} alt={`Foto de ${step.name_}`} /> : <div className="success__noimg" />}
            <span className="success__badge" aria-hidden>✓</span>
          </div>
          <h1>{step.repeat ? "Check-in já feito!" : "Check-in realizado!"}</h1>
          <p className="success__name">{step.name_}</p>
          <p className="hint">
            {step.repeat ? "Seu check-in de hoje foi registrado às " : "Registrado às "}
            <strong>{fmtTime(step.at)}</strong>. Bom culto! 🙌
          </p>
        </div>
      )}
    </Shell>
  );
}

function Progress({ step }: { step: Step["name"] }) {
  const order = ["local", "dados", "foto", "pronto"];
  const current =
    step === "identify" ? 1 : step === "selfie" ? 2 : step === "success" ? 4 : 0;
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
