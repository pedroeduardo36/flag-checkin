// Teste ponta a ponta contra o Supabase real: cadastro → check-in → limpeza.
// Uso (com o "npm run dev" rodando):  npm run test:fluxo  [-- http://localhost:3000]
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const BASE = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const env = { ...Object.fromEntries(
  readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i), l.slice(i + 1).trim()];
  })), ...(process.env.E2E_EMAIL ? { E2E_EMAIL: process.env.E2E_EMAIL } : {}) };

function cpfAleatorio() {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  for (const len of [9, 10]) {
    const s = n.reduce((acc, d, i) => acc + d * (len + 1 - i), 0);
    const r = (s * 10) % 11;
    n.push(r === 10 ? 0 : r);
  }
  return n.join("");
}

const post = async (path, body) => {
  const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};

let falhas = 0;
const check = (nome, cond, extra) => {
  console.log(`${cond ? "✅" : "❌"} ${nome}${!cond && extra ? ` → ${JSON.stringify(extra)}` : ""}`);
  if (!cond) falhas++;
};

const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
// Rostos sintéticos (StyleGAN2): nenhuma pessoa real.
const foto = (nome) => "data:image/jpeg;base64," + readFileSync(`tests/fixtures/${nome}.jpg`).toString("base64");
const photo = foto("pessoa-a-cadastro");
const cpf = cpfAleatorio();
const extrasCpf = [];
const nasc = "2010-05-20";
const dentro = { lat: Number(env.CHURCH_LAT), lng: Number(env.CHURCH_LNG), accuracy: 15 };
const geoOff = env.GEOFENCE_DISABLED === "true";
if (geoOff) console.log("⚠️  GEOFENCE_DISABLED=true — verificação de localização DESLIGADA (modo teste)\n");
const fora = { lat: dentro.lat + 0.05, lng: dentro.lng, accuracy: 15 };

try {
  const h = await fetch(`${BASE}/api/health`).then((r) => r.json());
  check("health: variáveis, tabelas e bucket", h.ok, h.checks);
  if (!h.ok) throw new Error("Corrija o /api/health antes de continuar.");

  const cad = {
    name: "Teste Automático Flag", cpf, phone: "61999990000", birthDate: nasc,
    guardianName: "Responsável Teste", guardianPhone: "61988880000", guardianEmail: env.E2E_EMAIL || env.SMTP_USER || "responsavel.teste@example.com", consent: true, photo,
  };
  let r = await post("/api/cadastro", { ...cad, password: "senha-errada" });
  check("cadastro com senha errada é recusado (401)", r.status === 401, r);
  r = await post("/api/cadastro", { ...cad, guardianEmail: "email-invalido", password: env.REGISTRATION_PASSWORD });
  check("cadastro com e-mail do responsável inválido é recusado (400)", r.status === 400 && !!r.data.errors?.guardianEmail, r);
  r = await post("/api/cadastro", { ...cad, photo: foto("sem-rosto"), password: env.REGISTRATION_PASSWORD });
  check("cadastro com foto sem rosto é recusado (422 SEM_ROSTO)", r.status === 422 && r.data.code === "SEM_ROSTO", r);
  r = await post("/api/cadastro", { ...cad, photo: foto("duas-pessoas"), password: env.REGISTRATION_PASSWORD });
  check("cadastro com duas pessoas é recusado (422 VARIOS_ROSTOS)", r.status === 422 && r.data.code === "VARIOS_ROSTOS", r);
  r = await post("/api/cadastro", { ...cad, password: env.REGISTRATION_PASSWORD });
  check("cadastro válido (200)", r.status === 200, r);
  r = await post("/api/cadastro", { ...cad, password: env.REGISTRATION_PASSWORD });
  check("CPF duplicado é recusado (409)", r.status === 409, r);

  r = await post("/api/checkin/local", fora);
  if (geoOff) check("[modo teste] fora do raio é aceito", r.data.ok === true && r.data.disabled === true, r);
  else check("fora do raio → ok:false", r.status === 200 && r.data.ok === false, r);
  r = await post("/api/checkin/local", dentro);
  check("dentro do raio → ok:true", r.data.ok === true, r);

  r = await post("/api/checkin/identificar", { ...dentro, cpf, birthDate: "2011-01-01" });
  check("data de nascimento errada (404)", r.status === 404, r);
  if (geoOff) {
    r = await post("/api/checkin/identificar", { cpf, birthDate: "2011-01-01" });
    check("[modo teste] identificar sem localização é aceito (só falha pela data)", r.status === 404, r);
  } else {
    r = await post("/api/checkin/identificar", { ...fora, cpf, birthDate: nasc });
    check("identificar fora do local (403)", r.status === 403, r);
  }
  // No modo teste, faz o check-in completo SEM enviar localização (como no celular fora da igreja).
  r = await post("/api/checkin/identificar", geoOff ? { cpf, birthDate: nasc } : { ...dentro, cpf, birthDate: nasc });
  check("identificar com dados certos → token", r.status === 200 && !!r.data.token, r);

  const token = r.data.token;
  let f = await post("/api/checkin/confirmar", { token, photo: foto("sem-rosto") });
  check("selfie sem rosto é recusada (422 SEM_ROSTO)", f.status === 422 && f.data.code === "SEM_ROSTO", f);
  f = await post("/api/checkin/confirmar", { token, photo: foto("pessoa-b") });
  check("selfie de OUTRA pessoa é recusada (403 ROSTO_NAO_CONFERE)", f.status === 403 && f.data.code === "ROSTO_NAO_CONFERE", f);
  const conf = await post("/api/checkin/confirmar", { token, photo: foto("pessoa-a-selfie") });
  check("selfie da MESMA pessoa (outro ângulo/luz) é aceita (200)", conf.status === 200 && conf.data.ok, conf);
  // O e-mail é enviado depois da resposta (after): espera o status ser gravado.
  let aviso = null;
  for (let i = 0; i < 20 && !aviso; i++) {
    await new Promise((res) => setTimeout(res, 1000));
    const { data: ck } = await sb.from("checkins").select("guardian_email_status, members!inner(cpf)").eq("members.cpf", cpf).maybeSingle();
    aviso = ck?.guardian_email_status ?? null;
  }
  const esperado = env.E2E_EMAIL ? ["enviado"] : ["enviado", "falhou", "sem_config"];
  check(`aviso ao responsável registrado (${aviso})`, esperado.includes(aviso), aviso);

  const dup = await post("/api/checkin/confirmar", { token, photo: foto("pessoa-a-selfie") });
  check("segundo check-in no mesmo dia é recusado (409)", dup.status === 409, dup);

  r = await post("/api/checkin/identificar", { ...dentro, cpf, birthDate: nasc });
  check("identificar de novo → já fez check-in", r.data.alreadyCheckedIn === true, r);
  const img = r.data.photoUrl ? await fetch(r.data.photoUrl) : null;
  check("selfie acessível por URL assinada", img?.status === 200, img?.status);

  // Área do pastor: senha, feed ao vivo e cadastro sem a senha do fiscal.
  const semSessao = await fetch(`${BASE}/api/pastor/feed`);
  check("feed do pastor sem sessão é bloqueado (401)", semSessao.status === 401, semSessao.status);
  const loginErrado = await post("/api/pastor/sessao", { password: "errada" });
  check("senha do pastor errada é recusada (401)", loginErrado.status === 401, loginErrado);
  const login = await fetch(`${BASE}/api/pastor/sessao`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: env.PASTOR_PASSWORD }) });
  const pastorCookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
  check("login do pastor define cookie httpOnly", login.status === 200 && /httponly/i.test(login.headers.get("set-cookie") ?? ""), login.status);
  const feed = await fetch(`${BASE}/api/pastor/feed`, { headers: { cookie: pastorCookie } }).then((x) => x.json());
  const meu = feed.items?.find((i) => i.name === cad.name);
  check("check-in aparece no feed do pastor com selfie e foto do cadastro", !!meu?.selfieUrl && !!meu?.avatarUrl, meu);
  const desde = await fetch(`${BASE}/api/pastor/feed?since=${encodeURIComponent(meu?.checkedInAt ?? "")}`, { headers: { cookie: pastorCookie } }).then((x) => x.json());
  check("feed incremental (since) não repete o que já foi visto", Array.isArray(desde.items) && !desde.items.some((i) => i.id === meu?.id), desde.items?.length);
  const cpf2 = cpfAleatorio();
  const r2 = await fetch(`${BASE}/api/cadastro`, { method: "POST", headers: { "Content-Type": "application/json", cookie: pastorCookie }, body: JSON.stringify({ ...cad, cpf: cpf2, name: "Teste Automático Pastor" }) });
  check("pastor cadastra sem a senha do fiscal (200)", r2.status === 200, r2.status);
  extrasCpf.push(cpf2);

  const { data: pres } = await sb.from("presencas").select("nome, distancia_rosto").eq("nome", cad.name);
  check("aparece na view presencas com a distância do rosto", pres?.length === 1 && pres[0].distancia_rosto > 0, pres);
} catch (e) {
  console.error("⚠️ ", e.message);
  falhas++;
} finally {
  // Limpeza: apaga os adolescentes de teste (check-ins caem em cascata) e as fotos.
  for (const doc of [cpf, ...extrasCpf]) {
  const { data: m } = await sb.from("members").select("id, photo_path").eq("cpf", doc).maybeSingle();
  if (m) {
    const { data: cks } = await sb.from("checkins").select("photo_path").eq("member_id", m.id);
    await sb.storage.from("fotos").remove([m.photo_path, ...(cks ?? []).map((c) => c.photo_path)]);
    await sb.from("members").delete().eq("id", m.id);
    console.log("🧹 dados de teste removidos");
  }
  }
}
console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo funcionando! 🎉");
process.exit(falhas ? 1 : 0);
