"use client";

import Link from "next/link";
import { useState } from "react";
import { Camera } from "@/components/Camera";
import { brDateToIso, isValidBirthDate, isValidCpf, isValidEmail, isValidPhone, maskCpf, maskDate, maskPhone } from "@/lib/format";

type Form = {
  name: string;
  cpf: string;
  phone: string;
  birthDate: string;
  guardianName: string;
  guardianPhone: string;
  guardianEmail: string;
  password: string;
  consent: boolean;
};

const empty: Form = { name: "", cpf: "", phone: "", birthDate: "", guardianName: "", guardianPhone: "", guardianEmail: "", password: "", consent: false };

function validate(f: Form, photo: string | null, mode: Mode) {
  const e: Record<string, string> = {};
  if (f.name.trim().split(/\s+/).length < 2) e.name = "Informe nome e sobrenome.";
  if (!isValidCpf(f.cpf)) e.cpf = "CPF inválido.";
  if (!isValidPhone(f.phone)) e.phone = "Telefone inválido.";
  if (!isValidBirthDate(brDateToIso(f.birthDate))) e.birthDate = "Data inválida. Use DD/MM/AAAA.";
  if (!photo) e.photo = "Tire uma foto do rosto.";
  if (f.guardianName.trim().split(/\s+/).length < 2) e.guardianName = "Informe nome e sobrenome do responsável.";
  if (!isValidPhone(f.guardianPhone)) e.guardianPhone = "Telefone do responsável inválido.";
  if (!isValidEmail(f.guardianEmail)) e.guardianEmail = "E-mail do responsável inválido.";
  if (!f.consent) e.consent = "É preciso a autorização do responsável.";
  if (mode === "fiscal" && !f.password) e.password = "O fiscal precisa digitar a senha.";
  return e;
}

type Mode = "fiscal" | "pastor";

/**
 * Formulário de cadastro do adolescente.
 * - fiscal: pede a senha do fiscal (página pública /cadastro).
 * - pastor: sem senha; a API libera pela sessão da área do pastor.
 */
export function CadastroForm({ mode, onSessionExpired }: { mode: Mode; onSessionExpired?: () => void }) {
  const [f, setF] = useState<Form>(empty);
  const [photo, setPhoto] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((p) => ({ ...p, [k]: v }));
    if (errors[k]) setErrors(({ [k]: _, ...rest }) => rest);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = validate(f, photo, mode);
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
      body: JSON.stringify({ ...f, password: mode === "fiscal" ? f.password : undefined, birthDate: brDateToIso(f.birthDate), photo }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) return setDone(true);
    if (mode === "pastor" && res.status === 401) return onSessionExpired?.();
    setMsg(data.error ?? "Erro ao salvar.");
    if (data.errors) setErrors(data.errors);
    if (data.field) setErrors({ [data.field]: data.error });
  }

  const reset = () => {
    setF(empty);
    setPhoto(null);
    setErrors({});
    setMsg(null);
    setDone(false);
  };

  if (done) {
    return (
        <div className="center success">
          <div className="success__photo">
            {photo && <img src={photo} alt="Foto cadastrada" />}
            <span className="success__badge" aria-hidden>✓</span>
          </div>
          <h1>Cadastro concluído!</h1>
          <p className="success__name">{f.name}</p>
          <p className="hint">Agora é só fazer o check-in com o CPF e a data de nascimento.</p>
          {mode === "pastor" ? (
            <button type="button" className="btn" onClick={reset}>Cadastrar outro adolescente</button>
          ) : (
            <Link href="/checkin" className="btn">Fazer check-in agora</Link>
          )}
        </div>
    );
  }

  const field = (k: keyof Form, label: string, input: React.ReactNode) => (
    <label className={`field ${errors[k] ? "field--error" : ""}`} data-field={k}>
      <span>{label}</span>
      {input}
      {errors[k] && <small>{errors[k]}</small>}
    </label>
  );

  return (
    <>
      <h1>{mode === "pastor" ? "Novo cadastro" : "Cadastro"}</h1>
      <p className="lead">
        {mode === "pastor"
          ? "Cadastro feito pelo pastor: não precisa da senha do fiscal."
          : "Preencha com o adolescente. No final, o fiscal confirma com a senha."}
      </p>

      <form onSubmit={submit} noValidate>
        <fieldset>
          <legend>Adolescente</legend>
          {field("name", "Nome completo", (
            <input autoComplete="name" value={f.name} onChange={(e) => set("name", e.target.value)} />
          ))}
          {field("cpf", "CPF", (
            <input inputMode="numeric" placeholder="000.000.000-00" value={f.cpf} onChange={(e) => set("cpf", maskCpf(e.target.value))} />
          ))}
          {field("phone", "Telefone (WhatsApp)", (
            <input type="tel" inputMode="tel" placeholder="(00) 00000-0000" value={f.phone} onChange={(e) => set("phone", maskPhone(e.target.value))} />
          ))}
          {field("birthDate", "Data de nascimento", (
            <input inputMode="numeric" autoComplete="bday" placeholder="DD/MM/AAAA" maxLength={10} value={f.birthDate} onChange={(e) => set("birthDate", maskDate(e.target.value))} />
          ))}
          <div className={`field ${errors.photo ? "field--error" : ""}`} data-field="photo">
            <span>Foto do rosto</span>
            <Camera value={photo} onChange={(p) => { setPhoto(p); if (p) setErrors(({ photo: _, ...r }) => r); }} />
            {errors.photo && <small>{errors.photo}</small>}
          </div>
        </fieldset>

        <fieldset>
          <legend>Responsável</legend>
          {field("guardianName", "Nome do responsável", (
            <input value={f.guardianName} onChange={(e) => set("guardianName", e.target.value)} />
          ))}
          {field("guardianPhone", "Telefone do responsável", (
            <input type="tel" inputMode="tel" placeholder="(00) 00000-0000" value={f.guardianPhone} onChange={(e) => set("guardianPhone", maskPhone(e.target.value))} />
          ))}
          {field("guardianEmail", "E-mail do responsável", (
            <input type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
              placeholder="nome@email.com" value={f.guardianEmail} onChange={(e) => set("guardianEmail", e.target.value.trim())} />
          ))}
          <p className="hint field-hint">O responsável recebe um e-mail com o horário e a foto a cada check-in.</p>
          <label className={`check ${errors.consent ? "field--error" : ""}`} data-field="consent">
            <input type="checkbox" checked={f.consent} onChange={(e) => set("consent", e.target.checked)} />
            <span>
              O responsável autoriza o Ministério Flag a guardar estes dados e as fotos do adolescente, usados só para o
              controle de presença nos cultos, e a enviar avisos de check-in para o e-mail informado (LGPD, art. 14).
            </span>
          </label>
          {errors.consent && <small className="err">{errors.consent}</small>}
        </fieldset>

        {mode === "fiscal" && (
          <fieldset className="fiscal">
            <legend>Uso do fiscal</legend>
            {field("password", "Senha do fiscal", (
              <input type="password" autoComplete="off" value={f.password} onChange={(e) => set("password", e.target.value)} />
            ))}
          </fieldset>
        )}

        {msg && <div className="alert" role="alert">{msg}</div>}
        <button className="btn" disabled={busy}>{busy ? "Verificando foto…" : "Concluir cadastro"}</button>
        {mode === "fiscal" && <Link href="/checkin" className="link-center">Já tenho cadastro</Link>}
      </form>
    </>
  );
}
