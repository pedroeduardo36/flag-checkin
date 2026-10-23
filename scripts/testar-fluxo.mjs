// Teste ponta a ponta contra o Supabase real (com limpeza no final).
// Uso (com o servidor rodando):  npm run test:fluxo  [-- https://flag-checkin.vercel.app]
// E2E_EMAIL=voce@email.com envia o aviso de check-in para esse endereço.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const BASE = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const env = {
  ...Object.fromEntries(
    readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^"(.*)"$/, "$1")]),
  ),
  ...(process.env.E2E_EMAIL ? { E2E_EMAIL: process.env.E2E_EMAIL } : {}),
};
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function cpfAleatorio() {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  for (const len of [9, 10]) {
    const s = n.reduce((acc, d, i) => acc + d * (len + 1 - i), 0);
    const r = (s * 10) % 11;
    n.push(r === 10 ? 0 : r);
  }
  return n.join("");
}
const telAleatorio = () => "619" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");

const post = async (path, body, headers = {}) => {
  const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => ({})), headers: r.headers };
};

let falhas = 0;
const check = (nome, cond, extra) => {
  console.log(`${cond ? "✅" : "❌"} ${nome}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra).slice(0, 300)}` : ""}`);
  if (!cond) falhas++;
};

// Rostos sintéticos (StyleGAN2): nenhuma pessoa real.
const foto = (nome) => "data:image/jpeg;base64," + readFileSync(`tests/fixtures/${nome}.jpg`).toString("base64");
const geoOff = env.GEOFENCE_DISABLED === "true";
if (geoOff) console.log("⚠️  GEOFENCE_DISABLED=true — verificação de localização DESLIGADA (modo teste)\n");
const dentro = { lat: Number(env.CHURCH_LAT), lng: Number(env.CHURCH_LNG), accuracy: 15 };
const fora = { lat: dentro.lat + 0.05, lng: dentro.lng, accuracy: 15 };

const cpf = cpfAleatorio();
const cpfsCriados = [cpf];
const telsVisitantes = [telAleatorio(), telAleatorio()];
const nasc = "2010-05-20";
const cad = {
  name: "Teste Automático de Souza Flag", cpf, phone: "", birthDate: nasc,
  guardianName: "Responsável Teste", guardianPhone: "61988880000",
  guardianEmail: env.E2E_EMAIL || env.SMTP_USER || "responsavel.teste@example.com",
  // Segundo e-mail: mesmo endereço com "+responsavel2" (o Gmail entrega na mesma caixa, sem devolução).
  guardianEmail2: (env.E2E_EMAIL || env.SMTP_USER || "responsavel.teste@example.com").replace("@", "+responsavel2@"),
  consent: true,
};
const esperaAviso = async (memberCpf) => {
  for (let i = 0; i < 20; i++) {
    await new Promise((res) => setTimeout(res, 1000));
    const { data } = await sb.from("checkins").select("guardian_email_status, members!inner(cpf)").eq("members.cpf", memberCpf).maybeSingle();
    if (data?.guardian_email_status) return data.guardian_email_status;
  }
  return null;
};

try {
  const h = await fetch(`${BASE}/api/health`).then((r) => r.json());
  check("health: variáveis, tabelas, bucket e reconhecimento facial", h.ok, h.checks);
  if (!h.ok) throw new Error("Corrija o /api/health antes de continuar.");

  // ---------- Cadastro pelo responsável: sem foto e sem senha ----------
  let r = await post("/api/cadastro", { ...cad, guardianEmail2: "invalido" });
  check("segundo e-mail inválido é recusado (400)", r.status === 400 && !!r.data.errors?.guardianEmail2, r.data);
  r = await post("/api/cadastro", { ...cad, guardianEmail2: cad.guardianEmail.toUpperCase() });
  check("segundo e-mail igual ao primeiro é recusado (400)", r.status === 400 && !!r.data.errors?.guardianEmail2, r.data);
  r = await post("/api/cadastro", { ...cad, guardianEmail: "email-invalido" });
  check("cadastro com e-mail do responsável inválido é recusado (400)", r.status === 400 && !!r.data.errors?.guardianEmail, r);
  r = await post("/api/cadastro", cad);
  check("responsável cadastra SEM foto e SEM senha do fiscal (200)", r.status === 200, r);
  r = await post("/api/cadastro", cad);
  check("CPF duplicado é recusado (409)", r.status === 409, r);
  const { data: semFoto } = await sb.from("members").select("photo_path, face_descriptor, guardian_email2").eq("cpf", cpf).single();
  check("cadastro fica sem foto até o primeiro check-in", !semFoto.photo_path && !semFoto.face_descriptor, semFoto);
  check("segundo e-mail do responsável é salvo", semFoto.guardian_email2 === cad.guardianEmail2, semFoto.guardian_email2);

  // ---------- Localização ----------
  r = await post("/api/checkin/local", fora);
  if (geoOff) check("[modo teste] fora do raio é aceito", r.data.ok === true, r);
  else check("fora do raio → ok:false", r.status === 200 && r.data.ok === false, r);
  r = await post("/api/checkin/local", dentro);
  check("dentro do raio → ok:true", r.data.ok === true, r);

  // ---------- Identificação por nome + nascimento ----------
  r = await post("/api/checkin/identificar", { ...dentro, name: cad.name, birthDate: "2011-01-01" });
  check("data de nascimento errada (404)", r.status === 404 && r.data.code === "NAO_ENCONTRADO", r);
  r = await post("/api/checkin/identificar", { ...dentro, name: "Fulano Inexistente", birthDate: nasc });
  check("nome que não existe (404)", r.status === 404, r);
  if (!geoOff) {
    r = await post("/api/checkin/identificar", { ...fora, name: cad.name, birthDate: nasc });
    check("identificar fora do local (403)", r.status === 403, r);
  }
  r = await post("/api/checkin/identificar", { ...dentro, name: "teste automatico flag", birthDate: nasc });
  check("acha o cadastro sem acento, minúsculo e sem nome do meio", r.status === 200 && !!r.data.token, r);
  check("primeiro check-in pede foto de REGISTRO", r.data.photoKind === "registro", r.data.photoKind);
  check("identificação vale ~4 h (para a foto dentro do culto)", Date.parse(r.data.expiresAt) - Date.now() > 3.9 * 3600_000, r.data.expiresAt);
  let token = r.data.token;

  // ---------- 1º check-in: foto de registro ----------
  let f = await post("/api/checkin/confirmar", { token, photo: foto("sem-rosto") });
  check("registro sem rosto é recusado (422 SEM_ROSTO)", f.status === 422 && f.data.code === "SEM_ROSTO", f.data);
  f = await post("/api/checkin/confirmar", { token, photo: foto("duas-pessoas") });
  check("registro com duas pessoas é recusado (422 VARIOS_ROSTOS)", f.status === 422 && f.data.code === "VARIOS_ROSTOS", f.data);
  f = await post("/api/checkin/confirmar", { token, photo: foto("pessoa-a-cadastro") });
  check("registro com um rosto conclui o 1º check-in (200)", f.status === 200 && f.data.photoKind === "registro", f.data);
  const { data: comFoto } = await sb.from("members").select("photo_path, face_descriptor").eq("cpf", cpf).single();
  check("foto de registro vira a foto do cadastro (com descritor)", !!comFoto.photo_path && comFoto.face_descriptor?.length === 128, !!comFoto.photo_path);
  const aviso = await esperaAviso(cpf);
  const esperado = env.E2E_EMAIL ? ["enviado"] : ["enviado", "falhou", "sem_config"];
  check(`aviso ao responsável registrado (${aviso})`, esperado.includes(aviso), aviso);
  f = await post("/api/checkin/confirmar", { token, photo: foto("pessoa-a-selfie") });
  check("segundo check-in no mesmo dia é recusado (409)", f.status === 409, f.data);
  r = await post("/api/checkin/identificar", { ...dentro, name: cad.name, birthDate: nasc });
  check("identificar de novo → já fez check-in hoje", r.data.alreadyCheckedIn === true && !!r.data.photoUrl, r.data);

  // ---------- Check-ins seguintes: foto criativa ----------
  // Simula "outro domingo": apaga o check-in de hoje (o cadastro já tem a foto de referência).
  const { data: m } = await sb.from("members").select("id").eq("cpf", cpf).single();
  const { data: ck } = await sb.from("checkins").select("photo_path").eq("member_id", m.id).single();
  await sb.from("checkins").delete().eq("member_id", m.id);
  if (ck?.photo_path && ck.photo_path !== comFoto.photo_path) await sb.storage.from("fotos").remove([ck.photo_path]);
  r = await post("/api/checkin/identificar", { ...dentro, name: cad.name, birthDate: nasc });
  check("check-in seguinte pede foto CRIATIVA", r.status === 200 && r.data.photoKind === "criativa", r.data);
  token = r.data.token;
  f = await post("/api/checkin/confirmar", { token, photo: foto("sem-rosto") });
  check("foto criativa sem rosto é recusada (422)", f.status === 422 && f.data.code === "SEM_ROSTO", f.data);
  f = await post("/api/checkin/confirmar", { token, photo: foto("pessoa-b") });
  check("foto criativa de OUTRA pessoa é recusada (403)", f.status === 403 && f.data.code === "ROSTO_NAO_CONFERE", f.data);
  f = await post("/api/checkin/confirmar", { token, photo: foto("duas-pessoas") });
  check("foto criativa EM GRUPO com o adolescente é aceita (200)", f.status === 200 && f.data.photoKind === "criativa", f.data);

  // ---------- Visitante ----------
  r = await post("/api/checkin/visitante", { ...dentro, name: "Visitante Teste", phone: "123" });
  check("visitante com telefone inválido é recusado (400)", r.status === 400 && !!r.data.errors?.phone, r.data);
  r = await post("/api/checkin/visitante", { ...dentro, name: "Visitante Teste Sem Foto", phone: telsVisitantes[0] });
  check("visitante só com nome e telefone (200)", r.status === 200 && r.data.ok && !r.data.alreadyCheckedIn, r.data);
  r = await post("/api/checkin/visitante", { ...dentro, name: "Visitante Teste Sem Foto", phone: telsVisitantes[0] });
  check("visitante repetido no mesmo dia → já fez check-in", r.status === 200 && r.data.alreadyCheckedIn === true, r.data);
  r = await post("/api/checkin/visitante", { ...dentro, name: "Visitante Teste Com Foto", phone: telsVisitantes[1], photo: foto("pessoa-b") });
  check("visitante com foto criativa opcional (200)", r.status === 200 && r.data.ok, r.data);
  if (!geoOff) {
    r = await post("/api/checkin/visitante", { ...fora, name: "Visitante Longe", phone: telAleatorio() });
    check("visitante fora do local (403)", r.status === 403, r.data);
  }

  // ---------- Área do pastor ----------
  const semSessao = await fetch(`${BASE}/api/pastor/feed`);
  check("feed do pastor sem sessão é bloqueado (401)", semSessao.status === 401, semSessao.status);
  const loginErrado = await post("/api/pastor/sessao", { password: "errada" });
  check("senha do pastor errada é recusada (401)", loginErrado.status === 401, loginErrado.status);
  const login = await post("/api/pastor/sessao", { password: env.PASTOR_PASSWORD });
  const setCookie = login.headers.get("set-cookie") ?? "";
  const pastorCookie = setCookie.split(";")[0];
  check("login do pastor define cookie httpOnly", login.status === 200 && /httponly/i.test(setCookie), login.status);
  const feed = await fetch(`${BASE}/api/pastor/feed`, { headers: { cookie: pastorCookie } }).then((x) => x.json());
  const meu = feed.items?.find((i) => i.name === cad.name);
  check("check-in aparece no feed com foto criativa e foto do cadastro", !!meu?.selfieUrl && !!meu?.avatarUrl && meu.photoKind === "criativa", meu);
  const vis = feed.items?.filter((i) => i.isVisitor && i.name.startsWith("Visitante Teste")) ?? [];
  check("visitantes aparecem no feed marcados como visitante", vis.length === 2, vis.length);
  const desde = await fetch(`${BASE}/api/pastor/feed?since=${encodeURIComponent(feed.items?.[0]?.checkedInAt ?? "")}`, { headers: { cookie: pastorCookie } }).then((x) => x.json());
  check("feed incremental (since) não repete o que já foi visto", Array.isArray(desde.items) && desde.items.length === 0, desde.items?.length);
  const dashSem = await fetch(`${BASE}/api/pastor/dashboard`);
  check("dashboard sem sessão é bloqueado (401)", dashSem.status === 401, dashSem.status);
  const dash = await fetch(`${BASE}/api/pastor/dashboard`, { headers: { cookie: pastorCookie } }).then((x) => x.json());
  const hoje = dash.evolucao?.at(-1);
  check("dashboard conta o encontro de hoje (adolescente + 2 visitantes)", hoje?.cadastrados >= 1 && hoje?.visitantes >= 2 && dash.kpis?.encontros >= 1, hoje);
  const rk = dash.ranking ?? [];
  const ordenado = rk.every((r, i) => i === 0 || rk[i - 1].presencas >= r.presencas);
  const temVaga = rk.length < 10;
  check("ranking ordenado (até 10) e com o adolescente de teste quando há vaga",
    ordenado && rk.length <= 10 && (!temVaga || rk.some((r) => r.name === cad.name)), rk.map((r) => [r.name, r.presencas]));

  const cpf2 = cpfAleatorio();
  cpfsCriados.push(cpf2);
  const r2 = await post("/api/cadastro", { ...cad, cpf: cpf2, name: "Teste Automático Pastor" }, { cookie: pastorCookie });
  check("pastor cadastra pelo mesmo formulário (200)", r2.status === 200, r2.data);

  const { data: pres } = await sb.from("presencas").select("nome, tipo, tipo_foto").in("nome", [cad.name, "Visitante Teste Sem Foto"]);
  check("view presencas mostra adolescente (criativa) e visitante", pres?.some((p) => p.tipo === "cadastrado" && p.tipo_foto === "criativa") && pres?.some((p) => p.tipo === "visitante"), pres);
} catch (e) {
  console.error("⚠️ ", e.message);
  falhas++;
} finally {
  // Limpeza: adolescentes de teste (check-ins em cascata), visitantes de teste e todas as fotos.
  for (const doc of cpfsCriados) {
    const { data: m } = await sb.from("members").select("id, photo_path").eq("cpf", doc).maybeSingle();
    if (!m) continue;
    const { data: cks } = await sb.from("checkins").select("photo_path").eq("member_id", m.id);
    await sb.storage.from("fotos").remove([m.photo_path, ...(cks ?? []).map((c) => c.photo_path)].filter(Boolean));
    await sb.from("members").delete().eq("id", m.id);
  }
  const { data: vcks } = await sb.from("checkins").select("id, photo_path").is("member_id", null).in("visitor_phone", telsVisitantes);
  if (vcks?.length) {
    await sb.storage.from("fotos").remove(vcks.map((c) => c.photo_path).filter(Boolean));
    await sb.from("checkins").delete().in("id", vcks.map((c) => c.id));
  }
  console.log("🧹 dados de teste removidos");
}
console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo funcionando! 🎉");
process.exit(falhas ? 1 : 0);
