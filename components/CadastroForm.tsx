"use client";

import { useState } from "react";
import { brDateToIso, isValidBirthDate, isValidCpf, isValidEmail, isValidPhone, maskCpf, maskDate, maskPhone, nameTokens } from "@/lib/format";

type Form = {
  name: string;
  cpf: string;
  phone: string;
  birthDate: string;
  guardianName: string;
  guardianPhone: string;
  guardianEmail: string;
  guardianEmail2: string;
  consent: boolean;
  website: string; // armadilha para robôs (fica escondido)
};

const empty: Form = { name: "", cpf: "", phone: "", birthDate: "", guardianName: "", guardianPhone: "", guardianEmail: "", guardianEmail2: "", consent: false, website: "" };

function validate(f: Form) {
  const e: Record<string, string> = {};
  if (nameTokens(f.name).length < 2) e.name = "Informe nome e sobrenome do adolescente.";
  if (!isValidCpf(f.cpf)) e.cpf = "CPF do adolescente inválido.";
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
  return e;
}

type Mode = "responsavel" | "pastor";

/**
 * Cadastro do adolescente, sem foto e sem senha.
 * - responsavel: o pai, a mãe ou o responsável preenche antes do culto (/cadastro).
 * - pastor: mesmo formulário dentro da área do pastor, com "cadastrar outro".
 * A foto de referência é tirada pelo próprio adolescente no primeiro check-in.
 */
export function CadastroForm({ mode, onSessionExpired }: { mode: Mode; onSessionExpired?: () => void }) {
  const [f, setF] = useState<Form>(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
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
    if (res?.ok) return setDone(true);
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
    return (
      <div className="center success">
        <div className="success__photo success__photo--icon" aria-hidden>✓</div>
        <h1>Cadastro concluído!</h1>
        <p className="success__name">{f.name}</p>
        <p className="hint">
          No culto, {teen} faz o check-in com <strong>nome completo</strong> e <strong>data de nascimento</strong>. No
          primeiro check-in, tira uma foto do rosto para completar o cadastro.
          {f.guardianEmail && (
            <>
              {" "}A cada check-in, o aviso vai para <strong>{f.guardianEmail}</strong>
              {f.guardianEmail2 && <> e <strong>{f.guardianEmail2}</strong></>}.
            </>
          )}
        </p>
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
          {field("cpf", "CPF do adolescente", (
            <input inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" value={f.cpf} onChange={(e) => set("cpf", maskCpf(e.target.value))} />
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
          ), "Você recebe um e-mail com o horário e a foto a cada check-in.")}

          {showEmail2 ? (
            <div className="email2" data-field="guardianEmail2">
              {field("guardianEmail2", "Outro e-mail (opcional)", (
                <input type="email" inputMode="email" autoComplete="off" autoCapitalize="none" spellCheck={false} autoFocus
                  placeholder="ex.: e-mail do pai ou da mãe" value={f.guardianEmail2} onChange={(e) => set("guardianEmail2", e.target.value.trim())} />
              ), "Os dois e-mails recebem o aviso de cada check-in.")}
              <button type="button" className="email2__remove" onClick={() => { set("guardianEmail2", ""); setShowEmail2(false); }}>
                Remover
              </button>
            </div>
          ) : (
            <button type="button" className="add-email" onClick={() => setShowEmail2(true)}>+ Adicionar outro e-mail</button>
          )}

          <label className={`check ${errors.consent ? "field--error" : ""}`} data-field="consent">
            <input type="checkbox" checked={f.consent} onChange={(e) => set("consent", e.target.checked)} />
            <span>
              Como responsável, autorizo o Ministério Flag a guardar estes dados e as fotos tiradas pelo adolescente no
              check-in, usados só para o controle de presença nos cultos, e a me enviar avisos de check-in por e-mail
              (LGPD, art. 14).
            </span>
          </label>
          {errors.consent && <small className="err">{errors.consent}</small>}
        </fieldset>

        {/* Armadilha para robôs: invisível para pessoas */}
        <input className="hp" tabIndex={-1} autoComplete="off" aria-hidden name="website" value={f.website}
          onChange={(e) => set("website", e.target.value)} />

        {msg && <div className="alert" role="alert">{msg}</div>}
        <button className="btn" disabled={busy}>{busy ? "Salvando…" : "Concluir cadastro"}</button>
      </form>
    </>
  );
}
