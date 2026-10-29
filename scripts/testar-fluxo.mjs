// Teste ponta a ponta contra o Supabase real (com limpeza no final).
// Uso (com o servidor rodando):  npm run test:fluxo  [-- https://flag-checkin.vercel.app]
// E2E_EMAIL=voce@email.com envia o aviso de check-in para esse endereço.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createHash, createHmac } from "node:crypto";

const BASE = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const env = {
  ...Object.fromEntries(
    readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^"(.*)"$/, "$1")]),
  ),
  ...(process.env.E2E_EMAIL ? { E2E_EMAIL: process.env.E2E_EMAIL } : {}),
};
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Nascimento sorteado (2009–2013): os cadastros de teste não colidem com outros de mesmo nome.
const nascAleatorio = () => new Date(Date.UTC(2009, 0, 1) + Math.floor(Math.random() * 5 * 365) * 86400_000).toISOString().slice(0, 10);
const telAleatorio = () => "619" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");

const post = async (path, body, headers = {}) => {
  const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => ({})), headers: r.headers };
};


// ---------- Líderes: TOTP (RFC 6238) e código de ativação, iguais aos do servidor ----------
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const b32 = (s) => {
  let bits = 0, v = 0; const out = [];
  for (const ch of s.toUpperCase().replace(/[^A-Z2-7]/g, "")) { v = (v << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
};
const totp = (secret, offset = 0) => {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const h = createHmac("sha1", b32(secret)).update(msg).digest(); const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, "0");
};
const codigoAtivacao = (code) => createHash("sha256").update(`ativacao:${code.replace(/-/g, "")}`).digest("base64url");
const t0 = new Date().toISOString();
const stamp = Date.now();
const emailsLideres = [`e2e.lider.a.${stamp}@example.com`, `e2e.lider.b.${stamp}@example.com`, `e2e.lider.c.${stamp}@example.com`];
const SENHA_A = "culto de jovens e2e " + stamp;
const req = async (method, path, body, cookie) => {
  const r = await fetch(BASE + path, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get("set-cookie") ?? "";
  return { status: r.status, data: await r.json().catch(() => ({})), cookie: sc.split(";")[0], setCookie: sc };
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

const telsVisitantes = [telAleatorio(), telAleatorio()];
const nasc = nascAleatorio();
const NOME_DUPLICADO = "Teste Automatico Souza Flag"; // mesmo nome, escrito de outro jeito
const nomesCriados = ["Teste Automático de Souza Flag", "Teste Automático Pastor", NOME_DUPLICADO];
const cad = {
  name: nomesCriados[0], phone: "", birthDate: nasc,
  guardianName: "Responsável Teste", guardianPhone: "61988880000",
  guardianEmail: env.E2E_EMAIL || env.SMTP_USER || "responsavel.teste@example.com",
  // Segundo e-mail: mesmo endereço com "+responsavel2" (o Gmail entrega na mesma caixa, sem devolução).
  guardianEmail2: (env.E2E_EMAIL || env.SMTP_USER || "responsavel.teste@example.com").replace("@", "+responsavel2@"),
  consent: true,
};
const cadastrosDeTeste = (name = cad.name) => sb.from("members").select("id, photo_path, face_descriptor, guardian_email2, possible_duplicate_of").eq("birth_date", nasc).eq("name", name);
const esperaAviso = async (memberId) => {
  for (let i = 0; i < 20; i++) {
    await new Promise((res) => setTimeout(res, 1000));
    const { data } = await sb.from("checkins").select("guardian_email_status").eq("member_id", memberId).maybeSingle();
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
  // Um cliente antigo ainda pode mandar CPF: o servidor descarta.
  r = await post("/api/cadastro", { ...cad, cpf: "529.982.247-25" });
  check("responsável cadastra SEM foto, SEM senha do fiscal e SEM CPF (200)", r.status === 200, r);
  check("cadastro informa o remetente para o aviso de spam", typeof r.data.sender === "string" && r.data.sender.includes("@"), r.data);
  const primeiraResposta = JSON.stringify(Object.keys(r.data).sort());
  r = await post("/api/cadastro", cad);
  const { data: soUm } = await cadastrosDeTeste();
  check("P1 CPF: o mesmo responsável reenviando não duplica o cadastro (1 registro)", r.status === 200 && soUm?.length === 1, soUm?.length);
  check("P1 CPF: reenvio responde igual a um cadastro novo (não revela quem já está cadastrado)", JSON.stringify(Object.keys(r.data).sort()) === primeiraResposta, r.data);
  const semFoto = soUm[0];
  const colunaCpf = await sb.from("members").select("cpf").eq("id", semFoto.id).maybeSingle();
  check("P1 CPF: nenhum CPF gravado (coluna removida ou vazia)", colunaCpf.error?.code === "42703" || colunaCpf.data?.cpf === null, colunaCpf.error?.code ?? colunaCpf.data);
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
  check("registro com um rosto completa o cadastro e pede a foto criativa", f.status === 200 && f.data.registered === true && f.data.next === "criativa", f.data);
  const { data: comFoto } = await sb.from("members").select("id, photo_path, face_descriptor").eq("id", semFoto.id).single();
  check("foto de registro vira a foto do cadastro (com descritor)", !!comFoto.photo_path && comFoto.face_descriptor?.length === 128, !!comFoto.photo_path);
  const { count: aindaSem } = await sb.from("checkins").select("id", { count: "exact", head: true }).eq("member_id", comFoto.id);
  check("só a foto de registro ainda NÃO conclui o check-in", aindaSem === 0, aindaSem);
  f = await post("/api/checkin/confirmar", { token, photo: foto("pessoa-b") });
  check("1º check-in: foto criativa de outra pessoa é recusada (403)", f.status === 403 && f.data.code === "ROSTO_NAO_CONFERE", f.data);
  f = await post("/api/checkin/confirmar", { token, photo: foto("pessoa-a-selfie") });
  check("1º check-in: foto criativa conclui o check-in (200, marcado como 1º)", f.status === 200 && f.data.photoKind === "criativa" && f.data.isFirst === true, f.data);
  // Sessão da visita: só o aparelho que concluiu o check-in pode rever foto e horário.
  const setVisita = f.headers.get("set-cookie") ?? "";
  const cookieVisita = setVisita.split(";")[0];
  check("check-in concluído grava sessão da visita (httpOnly, SameSite=strict, só /api/checkin)",
    cookieVisita.startsWith("o2_visita=") && /httponly/i.test(setVisita) && /samesite=strict/i.test(setVisita) && /path=\/api\/checkin/i.test(setVisita), setVisita);
  const aviso = await esperaAviso(semFoto.id);
  const esperado = env.E2E_EMAIL ? ["enviado"] : ["enviado", "falhou", "sem_config"];
  check(`aviso ao responsável registrado (${aviso})`, esperado.includes(aviso), aviso);

  // ---------- REGRESSÃO P0: nome + nascimento + coordenadas NÃO dão acesso a foto/horário ----------
  // Quem sabe o nome e a data de nascimento de outro adolescente, e informa coordenadas DENTRO da igreja
  // (o celular pode forjar), não pode obter a foto nem o horário do check-in dele.
  const vazou = (resp) => {
    const txt = JSON.stringify(resp.data);
    return "photoUrl" in resp.data || "checkedInAt" in resp.data || "alreadyCheckedIn" in resp.data || /\/storage\/v1\/object|token=ey/.test(txt);
  };
  const atacante = await post("/api/checkin/identificar", { ...dentro, name: cad.name, birthDate: nasc });
  check("P0: sem sessão da visita, nome+nascimento+coordenadas válidas NÃO revelam foto, horário nem 'já fez check-in'",
    atacante.status === 200 && !vazou(atacante), atacante.data);
  const comFalso = await post("/api/checkin/identificar", { ...dentro, name: cad.name, birthDate: nasc }, { cookie: "o2_visita=eyJtaWQiOiJ4In0.assinaturafalsa" });
  check("P0: cookie de visita forjado também não revela nada", comFalso.status === 200 && !vazou(comFalso), comFalso.data);
  const semAcento = await post("/api/checkin/identificar", { ...dentro, name: "teste automatico flag", birthDate: nasc });
  check("P0: variação do nome também não revela nada", semAcento.status === 200 && !vazou(semAcento), semAcento.data);
  const fotoErrada = await post("/api/checkin/confirmar", { token: atacante.data.token, photo: foto("pessoa-b") });
  check("P0: com o token do atacante, outro rosto é recusado sem revelar o check-in (403)",
    fotoErrada.status === 403 && fotoErrada.data.code === "ROSTO_NAO_CONFERE" && !("photoUrl" in fotoErrada.data) && !("checkedInAt" in fotoErrada.data), fotoErrada.data);
  const dono = await post("/api/checkin/identificar", { ...dentro, name: cad.name, birthDate: nasc }, { cookie: cookieVisita });
  check("aparelho que fez o check-in (sessão da visita) revê foto e horário", dono.data.alreadyCheckedIn === true && !!dono.data.photoUrl && !!dono.data.checkedInAt, dono.data);
  f = await post("/api/checkin/confirmar", { token, photo: foto("pessoa-a-selfie") });
  check("2º check-in no mesmo dia, com o rosto conferido, é recusado (409) e mostra o existente", f.status === 409 && f.data.code === "DUPLICADO" && !!f.data.checkedInAt, f.data);

  // ---------- Check-ins seguintes: foto criativa ----------
  // Simula "outro domingo": o check-in de hoje passa para a semana passada (o cadastro já tem a foto de referência).
  const m = semFoto;
  const semanaPassada = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  await sb.from("checkins").update({ service_date: semanaPassada }).eq("member_id", m.id);
  r = await post("/api/checkin/identificar", { ...dentro, name: cad.name, birthDate: nasc });
  check("check-in seguinte pede foto CRIATIVA (sem registro)", r.status === 200 && r.data.photoKind === "criativa", r.data);
  token = r.data.token;
  f = await post("/api/checkin/confirmar", { token, photo: foto("sem-rosto") });
  check("foto criativa sem rosto é recusada (422)", f.status === 422 && f.data.code === "SEM_ROSTO", f.data);
  f = await post("/api/checkin/confirmar", { token, photo: foto("pessoa-b") });
  check("foto criativa de OUTRA pessoa é recusada (403)", f.status === 403 && f.data.code === "ROSTO_NAO_CONFERE", f.data);
  f = await post("/api/checkin/confirmar", { token, photo: foto("duas-pessoas") });
  check("foto criativa EM GRUPO com o adolescente é aceita (200, não é o 1º)", f.status === 200 && f.data.photoKind === "criativa" && f.data.isFirst === false, f.data);

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

  // ---------- P1: contas individuais de líder (senha + app autenticador) ----------
  const semSessao = await fetch(`${BASE}/api/pastor/feed`);
  check("feed dos líderes sem sessão é bloqueado (401)", semSessao.status === 401, semSessao.status);
  r = await post("/api/pastor/sessao", { password: "qualquer-senha-compartilhada" });
  check("P1: a senha compartilhada antiga não existe mais", r.status === 404 || r.status === 405, r.status);

  // Primeiro líder: criado direto no banco (como o script npm run lider:criar), com código de ativação.
  const ativacaoA = "E2E2-TEST-" + String(stamp).slice(-4).replace(/[01]/g, "7");
  const { data: lA } = await sb.from("leaders").insert({ name: "E2E Líder A", email: emailsLideres[0], setup_code_hash: codigoAtivacao(ativacaoA), setup_expires_at: new Date(Date.now() + 3600e3).toISOString() }).select("id").single();
  r = await req("POST", "/api/lider/ativar", { email: emailsLideres[0], setupCode: ativacaoA, password: "curta" });
  check("P1: ativação recusa senha fraca (400)", r.status === 400, r.data);
  r = await req("POST", "/api/lider/ativar", { email: emailsLideres[0], setupCode: "ABCD-EFGH-JKMN", password: SENHA_A });
  check("P1: código de ativação errado é recusado (401)", r.status === 401, r.data);
  r = await req("POST", "/api/lider/ativar", { email: emailsLideres[0], setupCode: ativacaoA, password: SENHA_A });
  const ckCadastro = r.cookie;
  check("P1: ativação leva OBRIGATORIAMENTE ao cadastro do autenticador", r.status === 200 && r.data.stage === "cadastro_totp" && /httponly/i.test(r.setCookie), r.data);
  r = await req("POST", "/api/lider/ativar", { email: emailsLideres[0], setupCode: ativacaoA, password: SENHA_A });
  check("P1: código de ativação vale uma vez só", r.status === 401, r.status);
  r = await req("GET", "/api/pastor/feed", null, ckCadastro);
  check("P1: sem autenticador cadastrado, nada de dados privados (401)", r.status === 401, r.status);
  const setupA = await req("GET", "/api/lider/autenticador", null, ckCadastro);
  check("P1: cadastro mostra QR code e chave do autenticador", setupA.status === 200 && setupA.data.qr?.startsWith("data:image/png") && setupA.data.uri?.startsWith("otpauth://totp/"), setupA.status);
  r = await req("POST", "/api/lider/autenticador", { code: "000000" }, ckCadastro);
  check("P1: código errado no cadastro do autenticador é recusado", r.status === 400, r.data);
  const codigoCadastro = totp(setupA.data.secret);
  r = await req("POST", "/api/lider/autenticador", { code: codigoCadastro }, ckCadastro);
  const codigosRecA = r.data.recoveryCodes ?? [];
  let ckA = r.cookie;
  check("P1: autenticador cadastrado → 10 códigos de recuperação e sessão completa", r.status === 200 && r.data.stage === "completa" && codigosRecA.length === 10, r.data);
  r = await req("GET", "/api/pastor/feed", null, ckCadastro);
  check("P1: o cookie da etapa anterior deixa de valer (sessão trocada)", r.status === 401, r.status);

  // Login normal: senha → código.
  r = await req("POST", "/api/lider/entrar", { email: emailsLideres[0], password: SENHA_A + "x" });
  check("P1: senha errada é recusada (401)", r.status === 401, r.data);
  r = await req("POST", "/api/lider/entrar", { email: emailsLideres[0], password: SENHA_A });
  let ckSenha = r.cookie;
  check("P1: senha certa libera SÓ a etapa do código", r.status === 200 && r.data.stage === "senha", r.data);
  r = await req("GET", "/api/pastor/feed", null, ckSenha);
  check("P1: só a senha não abre o feed (401)", r.status === 401, r.status);
  r = await req("POST", "/api/lider/verificar", { code: codigoCadastro }, ckSenha);
  check("P1: código do autenticador já usado não vale de novo", r.status === 401, r.data);
  const proximo = totp(setupA.data.secret, 1);
  r = await req("POST", "/api/lider/verificar", { code: proximo }, ckSenha);
  ckA = r.cookie;
  check("P1: senha + código do autenticador → acesso completo", r.status === 200 && r.data.stage === "completa", r.data);
  r = await req("POST", "/api/lider/entrar", { email: emailsLideres[0], password: SENHA_A });
  r = await req("POST", "/api/lider/verificar", { code: proximo }, r.cookie);
  check("P1: o mesmo código não serve para um segundo login", r.status === 401, r.status);

  // Limite de tentativas com requisições SIMULTÂNEAS (contador no banco, vale para qualquer instância).
  const rajada = await Promise.all(Array.from({ length: 14 }, () => req("POST", "/api/lider/entrar", { email: emailsLideres[1], password: "chute qualquer 123" })));
  const negados = rajada.filter((x) => x.status === 401).length, bloqueados = rajada.filter((x) => x.status === 429).length;
  check("P1: 14 tentativas simultâneas → no máximo 8 conferidas, o resto bloqueado (429)", negados <= 8 && bloqueados >= 6 && negados + bloqueados === 14, { negados, bloqueados });
  const rajadaCodigo = await (async () => {
    const l = await req("POST", "/api/lider/entrar", { email: emailsLideres[0], password: SENHA_A });
    return Promise.all(Array.from({ length: 8 }, () => req("POST", "/api/lider/verificar", { code: "123456" }, l.cookie)));
  })();
  check("P1: chutes simultâneos do código de 6 dígitos também são limitados (5 por 15 min)",
    rajadaCodigo.filter((x) => /Código incorreto/.test(x.data.error ?? "")).length <= 5 && rajadaCodigo.some((x) => x.status === 429), rajadaCodigo.map((x) => x.status));
  await sb.from("auth_rate_limits").delete().like("key", `%${lA.id}%`);

  // Celular perdido: código de recuperação (uso único) → cadastra autenticador novo.
  r = await req("POST", "/api/lider/entrar", { email: emailsLideres[0], password: SENHA_A });
  r = await req("POST", "/api/lider/verificar", { recoveryCode: codigosRecA[0] }, r.cookie);
  const ckRec = r.cookie;
  check("P1: código de recuperação entra e EXIGE cadastrar um autenticador novo", r.status === 200 && r.data.stage === "cadastro_totp", r.data);
  r = await req("GET", "/api/pastor/feed", null, ckA);
  check("P1: usar código de recuperação encerra as outras sessões (o celular perdido pode estar logado)", r.status === 401, r.status);
  const setupA2 = await req("GET", "/api/lider/autenticador", null, ckRec);
  r = await req("POST", "/api/lider/autenticador", { code: totp(setupA2.data.secret) }, ckRec);
  check("P1: novo autenticador cadastrado, códigos de recuperação renovados", r.status === 200 && r.data.recoveryCodes?.length === 10 && setupA2.data.secret !== setupA.data.secret, r.status);
  ckA = r.cookie;
  r = await req("POST", "/api/lider/entrar", { email: emailsLideres[0], password: SENHA_A });
  r = await req("POST", "/api/lider/verificar", { recoveryCode: codigosRecA[1] }, r.cookie);
  check("P1: códigos de recuperação antigos deixam de valer", r.status === 401, r.status);
  await sb.from("auth_rate_limits").delete().like("key", `%${lA.id}%`);

  // Administração: A cria C, C ativa; A desativa C → só as sessões de C caem.
  r = await req("POST", "/api/lider/contas", { name: "E2E Líder C", email: emailsLideres[2] }, ckA);
  check("P1: líder cria conta de outro líder (código de ativação de uso único)", r.status === 200 && /^[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4}$/.test(r.data.setupCode ?? ""), r.data);
  const idC = r.data.id;
  r = await req("POST", "/api/lider/ativar", { email: emailsLideres[2], setupCode: r.data.setupCode, password: "louvor e2e conta c " + stamp });
  const setupC = await req("GET", "/api/lider/autenticador", null, r.cookie);
  r = await req("POST", "/api/lider/autenticador", { code: totp(setupC.data.secret) }, r.cookie);
  const ckC = r.cookie;
  check("P1: líder C ativou e entrou", (await req("GET", "/api/pastor/feed", null, ckC)).status === 200);
  r = await req("PATCH", "/api/lider/contas", { id: lA.id, action: "desativar" }, ckA);
  check("P1: ninguém desativa a própria conta (403)", r.status === 403, r.data);
  r = await req("PATCH", "/api/lider/contas", { id: idC, action: "desativar" }, ckA);
  check("P1: desativar encerra as sessões abertas do líder", r.status === 200 && r.data.sessionsEnded >= 1, r.data);
  r = await req("GET", "/api/pastor/feed", null, ckC);
  check("P1: líder desativado perde o acesso NA HORA (401)", r.status === 401, r.status);
  r = await req("GET", "/api/pastor/feed", null, ckA);
  check("P1: os outros líderes continuam conectados", r.status === 200, r.status);
  r = await req("GET", "/api/lider/contas", null, ckC);
  check("P1: líder desativado não administra contas (401)", r.status === 401, r.status);

  // Adolescente nunca vira líder.
  r = await req("GET", "/api/lider/contas", null, cookieVisita);
  const r2v = await req("GET", "/api/pastor/feed", null, cookieVisita);
  const r3v = await req("DELETE", "/api/pastor/checkins", { id: "x", reason: "teste de acesso" }, cookieVisita);
  check("P1: sessão da visita do adolescente não acessa funções de líder", r.status === 401 && r2v.status === 401 && r3v.status === 401, [r.status, r2v.status, r3v.status]);
  const pastorCookie = ckA; // sessão atual do líder A (a anterior caiu quando ele usou o código de recuperação)

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

  const r2 = await post("/api/cadastro", { ...cad, name: nomesCriados[1] }, { cookie: pastorCookie });
  const { data: doPastor } = await cadastrosDeTeste(nomesCriados[1]);
  check("líder cadastra pelo mesmo formulário (200), sem marcar nome diferente como duplicado", r2.status === 200 && doPastor?.[0]?.possible_duplicate_of === null, r2.data);

  const { data: pres } = await sb.from("presencas").select("nome, tipo, tipo_foto").in("nome", [cad.name, "Visitante Teste Sem Foto"]);
  check("view presencas mostra adolescente (criativa) e visitante", pres?.some((p) => p.tipo === "cadastrado" && p.tipo_foto === "criativa") && pres?.some((p) => p.tipo === "visitante"), pres);

  // Correção de presença (com motivo) e trilha de auditoria.
  r = await req("DELETE", "/api/pastor/checkins", { id: meu?.id, reason: "" }, ckA);
  check("P1: correção de presença exige motivo (400)", r.status === 400, r.data);
  r = await req("DELETE", "/api/pastor/checkins", { id: meu?.id, reason: "teste automático: presença registrada por engano" }, ckA);
  const { data: aindaLa } = await sb.from("checkins").select("id").eq("id", meu?.id ?? "").maybeSingle();
  check("P1: líder remove presença registrada por engano", r.status === 200 && !aindaLa, r.data);

  // ---------- P1 CPF: possíveis duplicados para revisão de um líder ----------
  // Outro responsável cadastra o mesmo adolescente com o nome escrito de outro jeito.
  r = await post("/api/cadastro", { ...cad, name: NOME_DUPLICADO, guardianEmail: cad.guardianEmail.replace("@", "+outro@"), guardianEmail2: "" });
  const { data: [dup] = [] } = await cadastrosDeTeste(NOME_DUPLICADO);
  check("P1 CPF: cadastro parecido é aceito e marcado como possível duplicado do original", r.status === 200 && dup?.possible_duplicate_of === m.id, dup);
  r = await post("/api/checkin/identificar", { ...dentro, name: cad.name, birthDate: nasc });
  check("P1 CPF: com dois cadastros iguais, o check-in pede o nome completo ou um líder (409)", r.status === 409 && r.data.code === "AMBIGUO", r.data);
  r = await req("GET", "/api/lider/duplicados");
  check("P1 CPF: lista de duplicados exige líder (401)", r.status === 401, r.status);
  r = await req("GET", "/api/lider/duplicados", null, ckA);
  const par = r.data.pairs?.find((p) => p.duplicate.id === dup?.id);
  check("P1 CPF: líder vê o par (novo × existente, presenças, mesmo contato do responsável)",
    r.status === 200 && par?.original.id === m.id && par.sameGuardian === true && par.original.checkins >= 1, par);
  check("P1 CPF: a revisão não expõe e-mail, telefone nem CPF", !/@|61988880000|cpf/i.test(JSON.stringify(r.data.pairs)), r.data.pairs);
  r = await req("PATCH", "/api/lider/duplicados", { id: dup?.id, action: "pessoas_diferentes" }, ckA);
  const { data: [dupLimpo] = [] } = await cadastrosDeTeste(NOME_DUPLICADO);
  check("P1 CPF: 'são pessoas diferentes' tira a marcação", r.status === 200 && dupLimpo?.possible_duplicate_of === null, r.data);

  // Mesclar: o duplicado tem uma presença num culto que o original não tem e outra num culto que ele tem.
  await sb.from("members").update({ possible_duplicate_of: m.id }).eq("id", dup.id);
  const duasSemanas = new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10);
  const { count: antes } = await sb.from("checkins").select("id", { count: "exact", head: true }).eq("member_id", m.id);
  await sb.from("checkins").insert([
    { member_id: dup.id, service_date: duasSemanas, photo_kind: "criativa" },
    { member_id: dup.id, service_date: semanaPassada, photo_kind: "criativa" },
  ]);
  r = await req("PATCH", "/api/lider/duplicados", { id: dup.id, action: "mesclar" }, ckA);
  const { data: depoisDup } = await sb.from("members").select("id").eq("id", dup.id).maybeSingle();
  const { data: original } = await sb.from("members").select("id, photo_path, face_descriptor").eq("id", m.id).single();
  const { data: hist } = await sb.from("checkins").select("service_date").eq("member_id", m.id);
  check("P1 CPF: mesclar apaga o duplicado e mantém o id e o histórico do original (+1 culto, sem repetir dia)",
    r.status === 200 && !depoisDup && original.id === m.id && hist.length === antes + 1 && hist.some((h) => h.service_date === duasSemanas) &&
    new Set(hist.map((h) => h.service_date)).size === hist.length && original.face_descriptor?.length === 128, { status: r.status, hist });
  r = await req("PATCH", "/api/lider/duplicados", { id: m.id, action: "mesclar" }, ckA);
  check("P1 CPF: cadastro sem marcação não é mesclado (404)", r.status === 404, r.status);

  const { data: trilha } = await sb.from("admin_audit").select("id, actor_id, action, target_id, outcome, details").gte("at", t0).order("id");
  const tem = (action, outcome, f = () => true) => (trilha ?? []).some((a) => a.action === action && a.outcome === outcome && f(a));
  check("P1: trilha registra ativação, autenticador, login, recuperação, criação e desativação",
    tem("conta_ativada", "ok", (a) => a.target_id === lA.id) && tem("totp_cadastrado", "ok", (a) => a.actor_id === lA.id) &&
    tem("login", "ok", (a) => a.actor_id === lA.id) && tem("login", "negado") && tem("login", "bloqueado") &&
    tem("recuperacao_usada", "ok", (a) => a.actor_id === lA.id) && tem("conta_criada", "ok", (a) => a.actor_id === lA.id && a.target_id === idC) &&
    tem("conta_desativada", "ok", (a) => a.actor_id === lA.id && a.target_id === idC) && tem("conta_desativada", "negado", (a) => a.target_id === lA.id),
    [...new Set((trilha ?? []).map((a) => `${a.action}:${a.outcome}`))]);
  check("P1: correção de presença registrada com quem, qual e por quê",
    tem("presenca_removida", "ok", (a) => a.actor_id === lA.id && a.target_id === meu?.id && /engano/.test(a.details?.motivo ?? "")));
  check("P1 CPF: revisão de duplicados fica na trilha (pessoas diferentes e mescla)",
    tem("duplicado_descartado", "ok", (a) => a.actor_id === lA.id && a.target_id === dup.id) &&
    tem("cadastro_mesclado", "ok", (a) => a.actor_id === lA.id && a.target_id === m.id && a.details?.cadastro_apagado === dup.id));
  const textoTrilha = JSON.stringify(trilha);
  const segredos = [SENHA_A, codigoCadastro, proximo, ...codigosRecA, ativacaoA, setupA.data.secret?.replace(/ /g, "")].filter(Boolean);
  check("P1: trilha não contém senha, códigos nem chave do autenticador", !segredos.some((x) => textoTrilha.includes(x)));
  const umId = trilha?.[0]?.id;
  const edit = await sb.from("admin_audit").update({ outcome: "ok", action: "adulterado" }).eq("id", umId).select("id");
  const del = await sb.from("admin_audit").delete().eq("id", umId).select("id");
  const { data: intacto } = await sb.from("admin_audit").select("action").eq("id", umId).maybeSingle();
  check("P1: auditoria não pode ser editada nem apagada, nem com a chave do servidor", !!edit.error && !!del.error && intacto?.action === trilha?.[0]?.action, { edit: edit.error?.message, del: del.error?.message });
  const delEv = await sb.from("audit_events").delete().gte("at", t0).select("id");
  check("P1: auditoria do check-in (P0) também é só de inserção", !!delEv.error, delEv.error?.message);
} catch (e) {
  console.error("⚠️ ", e.message);
  falhas++;
} finally {
  // Limpeza: adolescentes de teste (check-ins em cascata), visitantes de teste e todas as fotos.
  const { data: criados } = await sb.from("members").select("id, photo_path").eq("birth_date", nasc).in("name", nomesCriados);
  for (const m of criados ?? []) {
    const { data: cks } = await sb.from("checkins").select("photo_path").eq("member_id", m.id);
    await sb.storage.from("fotos").remove([m.photo_path, ...(cks ?? []).map((c) => c.photo_path)].filter(Boolean));
    await sb.from("members").delete().eq("id", m.id);
  }
  const { data: vcks } = await sb.from("checkins").select("id, photo_path").is("member_id", null).in("visitor_phone", telsVisitantes);
  if (vcks?.length) {
    await sb.storage.from("fotos").remove(vcks.map((c) => c.photo_path).filter(Boolean));
    await sb.from("checkins").delete().in("id", vcks.map((c) => c.id));
  }
  // Líderes de teste (sessões e códigos vão em cascata). A trilha de auditoria fica: ela é imutável.
  await sb.from("leaders").delete().in("email", emailsLideres);
  await sb.from("auth_rate_limits").delete().like("key", "%e2e.lider.%");
  await sb.from("auth_rate_limits").delete().gte("window_start", t0).or("key.like.entrar:ip:%,key.like.ativar:ip:%");
  console.log("🧹 dados de teste removidos");
}
console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo funcionando! 🎉");
process.exit(falhas ? 1 : 0);
