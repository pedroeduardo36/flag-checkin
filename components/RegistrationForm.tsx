"use client";

import Link from "next/link";
import { useState } from "react";
import { RETENTION } from "@/lib/privacy";
import { brDateToIso, isValidBirthDate, isValidEmail, isValidPhone, maskDate, maskPhone, nameTokens } from "@/lib/format";

type Form = {
  name: string;
  phone: string;
  birthDate: string;
  guardianName: string;
  guardianPhone: string;
  guardianEmail: string;
  guardianEmail2: string;
  consent: boolean;
  consentBiometric: boolean;
  website: string; // bot trap (kept hidden)
};

const empty: Form = { name: "", phone: "", birthDate: "", guardianName: "", guardianPhone: "", guardianEmail: "", guardianEmail2: "", consent: false, consentBiometric: false, website: "" };

function validate(f: Form) {
  const e: Record<string, string> = {};
  if (nameTokens(f.name).length < 2) e.name = "Informe nome e sobrenome do adolescente.";
  if (f.phone && !isValidPhone(f.phone)) e.phone = "Telefone do adolescente inválido.";
  if (!isValidBirthDate(brDateToIso(f.birthDate))) e.birthDate = "Data inválida. Use DD/MM/AAAA.";
  if (nameTokens(f.guardianName).length < 2) e.guardianName = "Informe seu nome e sobrenome.";
  if (!isValidPhone(f.guardianPhone)) e.guardianPhone = "Seu telefone está inválido.";
  if (!isValidEmail(f.guardianEmail)) e.guardianEmail = "Seu e-mail está inválido.";
  if (f.guardianEmail2) {
    if (!isValidEmail(f.guardianEmail2)) e.guardianEmail2 = "Este e-mail está inválido.";
    else if (f.guardianEmail2.toLowerCase() === f.guardianEmail.toLowerCase()) e.guardianEmail2 = "Use um e-mail diferente do primeiro.";
  }
  if (!f.consent) e.consent = "É preciso autorizar o uso dos dados.";
  if (!f.consentBiometric) e.consentBiometric = "É preciso autorizar o reconhecimento facial para usar o check-in.";
  return e;
}

type Mode = "guardian" | "pastor";

/**
 * Teen registration, without photo or password.
 * - guardian: the parent or guardian fills it in before the service (/cadastro).
 * - pastor: the same form inside the pastor area, with "register another".
 * The reference photo is taken by the teen at their first check-in.
 */
export function RegistrationForm({ mode, onSessionExpired }: { mode: Mode; onSessionExpired?: () => void }) {
  const [f, setF] = useState<Form>(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<false | { confirmationSent: boolean; sender: string | null }>(false);
  const [showEmail2, setShowEmail2] = useState(false);
  const pastor = mode === "pastor";

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((p) => ({ ...p, [k]: v }));
    if (errors[k]) setErrors(({ [k]: _, ...rest }) => rest);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = validate(f);
    setErrors(v);
    if (Object.keys(v).length) {
      setMsg("Corrija os campos destacados.");
      document.querySelector(`[data-field="${Object.keys(v)[0]}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/cadastro", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...f, birthDate: brDateToIso(f.birthDate) }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (res?.ok) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return setDone({ confirmationSent: !!data.confirmationSent, sender: data.sender ?? null });
    }
    if (pastor && res?.status === 401) return onSessionExpired?.();
    setMsg(data.error ?? "Erro ao salvar. Tente de novo.");
    if (data.errors) setErrors(data.errors);
  }

  const reset = () => {
    setF(empty);
    setErrors({});
    setMsg(null);
    setDone(false);
    setShowEmail2(false);
  };

  if (done) {
    const teen = nameTokens(f.name).length ? f.name.trim().split(/\s+/)[0] : "O adolescente";
    const emails = [f.guardianEmail, f.guardianEmail2].filter(Boolean);
    const rows: [string, string][] = [
      ["Nome", f.name.trim()],
      ["Nascimento", f.birthDate],
      ...(f.phone ? ([["Celular", f.phone]] as [string, string][]) : []),
    ];
    const guardianRows: [string, string][] = [
      ["Nome", f.guardianName.trim()],
      ["Telefone", f.guardianPhone],
      ...emails.map((e, i) => [emails.length > 1 ? `E-mail ${i + 1}` : "E-mail", e] as [string, string]),
    ];
    return (
      <div className="success-cadastro">
        <div className="center">
          <div className="success__photo success__photo--icon" aria-hidden>✓</div>
          <h1>Falta {pastor ? "o responsável" : "você"} confirmar</h1>
          <p className="lead">
            {pastor ? "O responsável precisa" : "Você precisa"} abrir o e-mail de confirmação e autorizar. Só depois disso {teen} consegue
            fazer check-in. Sem confirmação em {RETENTION.confirmDays} dias, o cadastro é apagado.
          </p>
        </div>

        <div className="spam-alert" role="status">
          <div className="spam-alert__icon" aria-hidden>📬</div>
          <div>
            <strong>Confira também a caixa de spam!</strong>
            <p>
              {done.confirmationSent ? "Enviamos agora o link de confirmação" : "O link de confirmação é enviado"}
              {done.sender ? <> de <b>{done.sender}</b></> : null} para {emails.length > 1 ? "cada e-mail cadastrado" : "o e-mail cadastrado"}.
              Se não estiver na caixa de entrada, procure em <b>Spam</b> ou <b>Lixo eletrônico</b> e marque como{" "}
              <b>&quot;Não é spam&quot;</b>. Assim os avisos de cada check-in {pastor ? "chegam ao responsável" : "do seu filho(a) chegam certinho"}.
            </p>
          </div>
        </div>

        <div className="summary">
          <h2>Dados cadastrados</h2>
          <div className="summary__group">
            <div className="summary__title">Adolescente</div>
            <dl>{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          </div>
          <div className="summary__group">
            <div className="summary__title">Responsável</div>
            <dl>{guardianRows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          </div>
          <p className="hint summary__note">
            No culto, {teen} faz o check-in com <strong>nome completo</strong> e <strong>data de nascimento</strong>. No
            primeiro, tira uma foto do rosto e depois a foto criativa. Algum dado errado? Fale com a liderança da O2.
          </p>
        </div>

        <button type="button" className="btn" onClick={reset}>
          {pastor ? "Cadastrar outro adolescente" : "Cadastrar outro filho(a)"}
        </button>
      </div>
    );
  }


  const field = (k: keyof Form, label: string, input: React.ReactNode, hint?: string) => (
    <label className={`field ${errors[k] ? "field--error" : ""}`} data-field={k}>
      <span>{label}</span>
      {input}
      {hint && !errors[k] && <em className="field__hint">{hint}</em>}
      {errors[k] && <small>{errors[k]}</small>}
    </label>
  );

  return (
    <>
      <h1>{pastor ? "Novo cadastro" : "Cadastro do adolescente"}</h1>
      <p className="lead">
        {pastor
          ? "Cadastro feito pelo pastor. A foto é tirada pelo adolescente no primeiro check-in."
          : "Para pais, mães e responsáveis. Faça antes do culto: primeiro os dados do seu filho ou filha, depois os seus."}
      </p>

      <form onSubmit={submit} noValidate>
        <fieldset className="section section--teen">
          <legend>
            <span className="section__step">1</span> {pastor ? "Adolescente" : "Dados do seu filho(a)"}
          </legend>
          {!pastor && <p className="section__who">Preencha com os dados do <strong>adolescente</strong>, não os seus.</p>}
          {field("name", "Nome completo do adolescente", (
            <input autoComplete="off" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Ex.: Ana Beatriz Souza" />
          ), "É com esse nome que ele(a) vai fazer o check-in.")}
          {field("birthDate", "Data de nascimento do adolescente", (
            <input inputMode="numeric" autoComplete="off" placeholder="DD/MM/AAAA" maxLength={10} value={f.birthDate}
              onChange={(e) => set("birthDate", maskDate(e.target.value))} />
          ))}
          {field("phone", "Celular do adolescente (opcional)", (
            <input type="tel" inputMode="tel" autoComplete="off" placeholder="(00) 00000-0000" value={f.phone}
              onChange={(e) => set("phone", maskPhone(e.target.value))} />
          ))}
        </fieldset>

        <fieldset className="section section--guardian">
          <legend>
            <span className="section__step">2</span> {pastor ? "Responsável" : "Seus dados (responsável)"}
          </legend>
          {!pastor && <p className="section__who">Agora sim, os <strong>seus</strong> dados: pai, mãe ou responsável.</p>}
          {field("guardianName", pastor ? "Nome do responsável" : "Seu nome completo", (
            <input autoComplete={pastor ? "off" : "name"} value={f.guardianName} onChange={(e) => set("guardianName", e.target.value)} />
          ))}
          {field("guardianPhone", pastor ? "Telefone do responsável" : "Seu telefone (WhatsApp)", (
            <input type="tel" inputMode="tel" autoComplete={pastor ? "off" : "tel"} placeholder="(00) 00000-0000" value={f.guardianPhone}
              onChange={(e) => set("guardianPhone", maskPhone(e.target.value))} />
          ))}
          {field("guardianEmail", pastor ? "E-mail do responsável" : "Seu e-mail", (
            <input type="email" inputMode="email" autoComplete={pastor ? "off" : "email"} autoCapitalize="none" spellCheck={false}
              placeholder="nome@email.com" value={f.guardianEmail} onChange={(e) => set("guardianEmail", e.target.value.trim())} />
          ), "Você recebe um link para confirmar o cadastro e, depois, um aviso só com o horário a cada check-in.")}

          {showEmail2 ? (
            <div className="email2" data-field="guardianEmail2">
              {field("guardianEmail2", "Outro e-mail (opcional)", (
                <input type="email" inputMode="email" autoComplete="off" autoCapitalize="none" spellCheck={false} autoFocus
                  placeholder="ex.: e-mail do pai ou da mãe" value={f.guardianEmail2} onChange={(e) => set("guardianEmail2", e.target.value.trim())} />
              ), "Este e-mail também recebe um link e só passa a receber os avisos depois de confirmar.")}
              <button type="button" className="email2__remove" onClick={() => { set("guardianEmail2", ""); setShowEmail2(false); }}>
                Remover
              </button>
            </div>
          ) : (
            <button type="button" className="add-email" onClick={() => setShowEmail2(true)}>+ Adicionar outro e-mail</button>
          )}

          <div className="info consent-info">
            <span aria-hidden>🔍</span>
            <span>
              <strong>Como funciona o reconhecimento facial:</strong> no primeiro check-in o adolescente tira uma foto do
              rosto. O sistema guarda essa foto e uma lista de números que descreve o rosto (dado biométrico) e, nos
              check-ins seguintes, compara a foto do culto com ela para confirmar que é a mesma pessoa. As fotos do culto
              podem ter amigos junto: só os líderes veem, e elas são apagadas em {RETENTION.checkinPhotoDays} dias.{" "}
              <Link href="/privacidade" target="_blank">Tudo sobre os dados</Link>
            </span>
          </div>
          <label className={`check ${errors.consent ? "field--error" : ""}`} data-field="consent">
            <input type="checkbox" checked={f.consent} onChange={(e) => set("consent", e.target.checked)} />
            <span>
              Como responsável, autorizo o Ministério Flag a guardar estes dados, as presenças e as fotos tiradas pelo
              adolescente no check-in, usados só para o controle de presença nos cultos, e a me enviar avisos de check-in
              por e-mail (LGPD, art. 14).
            </span>
          </label>
          {errors.consent && <small className="err">{errors.consent}</small>}
          <label className={`check check--strong ${errors.consentBiometric ? "field--error" : ""}`} data-field="consentBiometric">
            <input type="checkbox" checked={f.consentBiometric} onChange={(e) => set("consentBiometric", e.target.checked)} />
            <span>
              Autorizo, de forma específica, o <b>reconhecimento facial</b> do adolescente no check-in: criar e guardar os
              dados do rosto a partir da foto de registro e compará-los com as fotos dos check-ins (LGPD, art. 11).
            </span>
          </label>
          {errors.consentBiometric && <small className="err">{errors.consentBiometric}</small>}
          <p className="hint">Você confirma estas autorizações de novo pelo link que vai chegar no seu e-mail.</p>
        </fieldset>

        {/* Bot trap: invisible to people */}
        <input className="hp" tabIndex={-1} autoComplete="off" aria-hidden name="website" value={f.website}
          onChange={(e) => set("website", e.target.value)} />

        {msg && <div className="alert" role="alert">{msg}</div>}
        <button className="btn" disabled={busy}>{busy ? "Salvando…" : "Concluir cadastro"}</button>
      </form>
    </>
  );
}
