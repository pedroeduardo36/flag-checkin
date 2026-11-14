"use client";

import { useState } from "react";
import { shortServiceDate } from "@/lib/schedule";

/** Service schedule on the dashboard: check-in only opens on these days. Leaders add an extra service or remove one. */
export function ScheduleCard({ upcoming, onChange, onUnauthorized }: {
  upcoming: string[]; onChange: () => void; onUnauthorized: () => void;
}) {
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(method: "POST" | "DELETE", d: string) {
    setBusy(true);
    setError(null);
    const r = await fetch("/api/pastor/encontros", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: d }),
    }).catch(() => null);
    setBusy(false);
    if (r?.status === 401) return onUnauthorized();
    if (r?.ok) {
      if (method === "POST") setDate("");
      return onChange();
    }
    setError((await r?.json().catch(() => null))?.error ?? "Não foi possível salvar. Tente de novo.");
  }

  return (
    <div className="card dash__card">
      <h3>Agenda de encontros</h3>
      <p className="hint dash__sub">O check-in só abre nos dias da agenda.</p>
      {upcoming.length ? (
        <ul className="agenda">
          {upcoming.map((d) => (
            <li key={d} className="agenda__row">
              <span>{shortServiceDate(d)}</span>
              <button
                className="chip chip--danger"
                disabled={busy}
                onClick={() => confirm(`Remover o encontro de ${shortServiceDate(d)}? O check-in não abre nesse dia.`) && send("DELETE", d)}
              >
                Remover
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">Nenhum encontro agendado.</p>
      )}
      <form className="agenda__add" onSubmit={(e) => { e.preventDefault(); if (date) send("POST", date); }}>
        <label className="field">
          <span>Encontro extra</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <button className="btn" disabled={busy || !date}>{busy ? "Salvando…" : "Adicionar encontro"}</button>
      </form>
      {error && <div className="alert" role="alert">{error}</div>}
    </div>
  );
}
