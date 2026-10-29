"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Shell } from "@/components/Brand";
import { RETENTION } from "@/lib/privacy";

type Info = { teenFirstName: string; guardianFirstName: string; primary: boolean };
type State =
  | { name: "carregando" }
  | { name: "invalido"; msg: string }
  | { name: "pergunta"; info: Info }
  | { name: "confirmado"; info: Info }
  | { name: "recusado"; info: Info };

async function call(token: string, body: Record<string, unknown>) {
  const r = await fetch("/api/cadastro/verificar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, ...body }),
  }).catch(() => null);
  return { ok: !!r?.ok, data: (r ? await r.json().catch(() => ({})) : {}) as Record<string, any> };
}

/**
 * Link do e-mail de confirmação. O token vem no fragmento (#t=…): não vai para logs de servidor.
 * O responsável lê a explicação e decide; abrir a página sozinha não confirma nada (filtros de e-mail
 * que abrem links não aprovam o cadastro por ninguém).
 */
export default function ConfirmarPage() {
  const [token, setToken] = useState("");
  const [state, setState] = useState<State>({ name: "carregando" });
  const [consent, setConsent] = useState(false);
  const [biometric, setBiometric] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = new URLSearchParams(window.location.hash.slice(1)).get("t") ?? "";
    setToken(t);
    history.replaceState(null, "", window.location.pathname); // tira o token da barra de endereço
    call(t, { action: "ver" }).then(({ ok, data }) =>
      setState(ok ? { name: "pergunta", info: data as Info } : { name: "invalido", msg: data.error ?? "Link inválido." }),
    );
  }, []);

  async function decide(action: "confirmar" | "recusar", info: Info) {
    if (action === "recusar") {
      const ask = info.primary
        ? `Não autorizar? O cadastro de ${info.teenFirstName} é apagado agora, com tudo o que já foi guardado.`
        : "Não receber os avisos? Este e-mail sai do cadastro.";
      if (!window.confirm(ask)) return;
    }
    setBusy(true);
    setError(null);
    const r = await call(token, { action, consent, consentBiometric: biometric });
    setBusy(false);
    if (!r.ok) {
      if (r.data.code === "SEM_CONSENTIMENTO") return setError(r.data.error);
      return setState({ name: "invalido", msg: r.data.error ?? "Não foi possível concluir." });
    }
    setState(action === "confirmar" ? { name: "confirmado", info } : { name: "recusado", info });
  }

  return (
    <Shell>
      {state.name === "carregando" && <div className="center"><div className="spinner" aria-hidden /></div>}

      {state.name === "invalido" && (
        <>
          <h1>Link inválido</h1>
          <p className="lead">{state.msg}</p>
        </>
      )}

      {state.name === "pergunta" && state.info.primary && (
        <>
          <h1>Confirme o cadastro de {state.info.teenFirstName}</h1>
          <p className="lead">
            Leia como funciona e decida. Só depois da sua confirmação o check-in de {state.info.teenFirstName} funciona.
          </p>
          <div className="info">
            <span aria-hidden>🔍</span>
            <span>
              <strong>Reconhecimento facial:</strong> no primeiro check-in, {state.info.teenFirstName} tira uma foto do rosto.
              O sistema guarda essa foto e uma lista de números que descreve o rosto (dado biométrico). Nos check-ins
              seguintes, a foto do culto é comparada com esses números para confirmar que é a mesma pessoa. Nada disso é
              compartilhado nem usado para outra coisa.
            </span>
          </div>
          <div className="info">
            <span aria-hidden>📷</span>
            <span>
              <strong>Fotos e avisos:</strong> a foto criativa do culto pode ter amigos junto. Só os líderes veem, e ela é
              apagada em {RETENTION.checkinPhotoDays} dias. Você recebe um aviso <b>só com o horário</b>, sem foto, a cada check-in.
            </span>
          </div>
          <p className="hint">
            Detalhes, prazos e como pedir para ver, corrigir ou apagar os dados: <Link href="/privacidade" target="_blank">página de privacidade</Link>.
          </p>
          <label className="check">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>
              Sou o responsável legal por {state.info.teenFirstName} e autorizo o Ministério Flag a guardar os dados do cadastro,
              as presenças e as fotos do check-in, e a me enviar os avisos de check-in por e-mail.
            </span>
          </label>
          <label className="check check--strong">
            <input type="checkbox" checked={biometric} onChange={(e) => setBiometric(e.target.checked)} />
            <span>
              Autorizo, de forma específica, o <b>reconhecimento facial</b> de {state.info.teenFirstName} no check-in: criar e
              guardar os dados do rosto a partir da foto de registro e compará-los com as fotos dos check-ins.
            </span>
          </label>
          {error && <div className="alert" role="alert">{error}</div>}
          <button className="btn" disabled={busy || !consent || !biometric} onClick={() => decide("confirmar", state.info)}>
            {busy ? "Confirmando…" : "Confirmar e autorizar"}
          </button>
          <button className="btn btn--ghost" disabled={busy} onClick={() => decide("recusar", state.info)}>
            Não autorizo: apagar o cadastro
          </button>
        </>
      )}

      {state.name === "pergunta" && !state.info.primary && (
        <>
          <h1>Avisos de check-in de {state.info.teenFirstName}</h1>
          <p className="lead">
            {state.info.guardianFirstName || "O responsável"} indicou este e-mail para receber um aviso, só com o horário, a cada
            check-in de {state.info.teenFirstName} na Juventude O2.
          </p>
          <p className="hint"><Link href="/privacidade" target="_blank">Como cuidamos dos dados</Link></p>
          <button className="btn" disabled={busy} onClick={() => decide("confirmar", state.info)}>
            {busy ? "Confirmando…" : "Quero receber os avisos"}
          </button>
          <button className="btn btn--ghost" disabled={busy} onClick={() => decide("recusar", state.info)}>
            Não quero: tirar este e-mail
          </button>
        </>
      )}

      {state.name === "confirmado" && (
        <>
          <div className="center">
            <div className="success__photo success__photo--icon" aria-hidden>✓</div>
            <h1>Confirmado!</h1>
            <p className="lead">
              {state.info.primary
                ? `${state.info.teenFirstName} já pode fazer check-in nos cultos da O2.`
                : `Este e-mail vai receber os avisos de check-in de ${state.info.teenFirstName}.`}
            </p>
          </div>
          <p className="hint">Você pode retirar a autorização quando quiser: veja como na <Link href="/privacidade">página de privacidade</Link>.</p>
        </>
      )}

      {state.name === "recusado" && (
        <>
          <h1>{state.info.primary ? "Cadastro apagado" : "E-mail retirado"}</h1>
          <p className="lead">
            {state.info.primary
              ? `O cadastro de ${state.info.teenFirstName} e tudo o que estava guardado foram apagados.`
              : "Este e-mail não vai receber nenhum aviso."}
          </p>
        </>
      )}
    </Shell>
  );
}
