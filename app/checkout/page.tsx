"use client";

import { useEffect, useState } from "react";
import { Shell } from "@/components/Brand";

type Visit = {
  name: string;
  firstName: string;
  isVisitor: boolean;
  checkedInAt: string;
  checkedOutAt: string | null;
  checkoutBy: "participante" | "lider" | null;
  photoUrl: string | null;
};

type State =
  | { name: "loading" }
  | { name: "none" }
  | { name: "open"; visit: Visit }
  | { name: "done"; visit: Visit; repeat: boolean };

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

/**
 * Location at checkout: optional. Only read if the phone ALREADY granted permission (no new prompt) and
 * never holds the confirmation for more than a few seconds. Without it the checkout counts just the same.
 */
async function optionalCoords(): Promise<{ lat: number; lng: number; accuracy: number } | null> {
  try {
    const p = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
    if (p?.state !== "granted") return null;
    return await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 5000);
      navigator.geolocation.getCurrentPosition(
        (pos) => { clearTimeout(timer); resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) }); },
        () => { clearTimeout(timer); resolve(null); },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 60_000 },
      );
    });
  } catch {
    return null;
  }
}

// Leaving the service: opened from the "Estou indo embora" button, the checkout QR code or an NFC tag.
// Asks for no data again: the visit session the check-in stored on this phone is enough.
export default function CheckoutPage() {
  const [state, setState] = useState<State>({ name: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/checkin/checkout", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { visit: Visit | null }) => {
        if (!d.visit) return setState({ name: "none" });
        setState(d.visit.checkedOutAt ? { name: "done", visit: d.visit, repeat: true } : { name: "open", visit: d.visit });
      })
      .catch(() => {
        setState({ name: "none" });
        setError("Sem conexão. Confira a internet e abra esta página de novo.");
      });
  }, []);

  async function confirm(visit: Visit) {
    setBusy(true);
    setError(null);
    const coords = await optionalCoords();
    const r = await fetch("/api/checkin/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(coords ?? {}),
    }).catch(() => null);
    const d = await r?.json().catch(() => ({}));
    setBusy(false);
    if (!r) return setError("Sem conexão: a saída NÃO foi registrada. Confira a internet e toque de novo.");
    if (r.status === 401) return setState({ name: "none" });
    if (!r.ok) return setError(d?.error ?? "Não foi possível registrar a saída. Tente de novo ou procure um líder.");
    setState({ name: "done", visit: { ...visit, ...d }, repeat: !!d.alreadyCheckedOut });
  }

  return (
    <Shell compact>
      {state.name === "loading" && <div className="center"><div className="spinner" aria-hidden /></div>}

      {state.name === "none" && (
        <>
          <h1>Saída do culto</h1>
          <p className="lead">Não encontramos um check-in de hoje neste celular.</p>
          <ul className="steps">
            <li>Abra esta página <strong>no mesmo celular e no mesmo navegador</strong> em que você fez o check-in.</li>
            <li>Se não der certo, <strong>procure um líder</strong>: ele registra a sua saída.</li>
          </ul>
          {error && <div className="alert" role="alert">{error}</div>}
          <a className="btn btn--ghost" href="/checkin">Ir para o check-in</a>
        </>
      )}

      {state.name === "open" && (
        <div className="center checkout">
          <Avatar visit={state.visit} />
          <h1>Já vai, {state.visit.firstName}?</h1>
          <p className="hint">Check-in às <strong>{fmtTime(state.visit.checkedInAt)}</strong></p>
          <span className="tag tag--warn">Saída não registrada</span>
          {error && <div className="alert" role="alert">{error}</div>}
          <button className="btn" onClick={() => confirm(state.visit)} disabled={busy}>
            {busy ? "Registrando…" : "Confirmar minha saída"}
          </button>
          <p className="hint center-text">
            Toque só quando estiver indo embora. Fechar o navegador ou acabar o culto <strong>não</strong> registra a saída.
            {!state.visit.isVisitor && " Seu responsável pode receber um aviso com o horário."}
          </p>
        </div>
      )}

      {state.name === "done" && (
        <div className="center checkout success">
          <div className="success__photo--icon" aria-hidden>👋</div>
          <h1>{state.repeat ? "Saída já registrada" : "Saída registrada!"}</h1>
          <p className="success__name">{state.visit.name}</p>
          <p className="hint">
            Chegou às <strong>{fmtTime(state.visit.checkedInAt)}</strong> · saiu às{" "}
            <strong>{fmtTime(state.visit.checkedOutAt!)}</strong>
            {state.visit.checkoutBy === "lider" && " (registrada por um líder)"}
          </p>
          <p className="lead center-text">Até a próxima! 🙌</p>
          <p className="hint center-text">Sua presença no culto continua registrada.</p>
        </div>
      )}
    </Shell>
  );
}

function Avatar({ visit }: { visit: Visit }) {
  return (
    <div className="success__photo checkout__photo">
      {visit.photoUrl ? <img src={visit.photoUrl} alt={`Foto de ${visit.firstName}`} /> : <div className="success__noimg" />}
    </div>
  );
}
