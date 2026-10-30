// End-to-end test against the real Supabase project (cleans up at the end).
// Usage (with the server running):  npm run test:e2e  [-- https://flag-checkin.vercel.app]
// E2E_EMAIL=you@email.com sends the check-in notice to that address.
//
// Request payloads, API error codes and database values (audit actions, view columns) are part of the
// app's contract and stay in Portuguese, as do the app texts some checks look for.
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

// Random birth date (2009–2013): test registrations don't collide with others of the same name.
const randomBirthDate = () => new Date(Date.UTC(2009, 0, 1) + Math.floor(Math.random() * 5 * 365) * 86400_000).toISOString().slice(0, 10);
const randomPhone = () => "619" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");

const post = async (path, body, headers = {}) => {
  const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => ({})), headers: r.headers };
};


// ---------- Leaders: TOTP (RFC 6238) and activation code, same as the server ----------
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
const activationHash = (code) => createHash("sha256").update(`ativacao:${code.replace(/-/g, "")}`).digest("base64url");
const t0 = new Date().toISOString();
const stamp = Date.now();
const leaderEmails = [`e2e.lider.a.${stamp}@example.com`, `e2e.lider.b.${stamp}@example.com`, `e2e.lider.c.${stamp}@example.com`];
const PASSWORD_A = "culto de jovens e2e " + stamp;
const req = async (method, path, body, cookie) => {
  const r = await fetch(BASE + path, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get("set-cookie") ?? "";
  return { status: r.status, data: await r.json().catch(() => ({})), cookie: sc.split(";")[0], setCookie: sc };
};

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "✅" : "❌"} ${name}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra).slice(0, 300)}` : ""}`);
  if (!cond) failures++;
};

// Synthetic faces (StyleGAN2): no real people.
const photo = (name) => "data:image/jpeg;base64," + readFileSync(`tests/fixtures/${name}.jpg`).toString("base64");
const geoOff = env.GEOFENCE_DISABLED === "true";
if (geoOff) console.log("⚠️  GEOFENCE_DISABLED=true — location check is OFF (test mode)\n");
const inside = { lat: Number(env.CHURCH_LAT), lng: Number(env.CHURCH_LNG), accuracy: 15 };
const outside = { lat: inside.lat + 0.05, lng: inside.lng, accuracy: 15 };

const visitorPhones = [randomPhone(), randomPhone()];
const birth = randomBirthDate();
const DUPLICATE_NAME = "Teste Automatico Souza Flag"; // same name, written differently
const createdNames = ["Teste Automático de Souza Flag", "Teste Automático Pastor", DUPLICATE_NAME, "Teste Automático Recusa"];
const reg = {
  name: createdNames[0], phone: "", birthDate: birth,
  guardianName: "Responsável Teste", guardianPhone: "61988880000",
  guardianEmail: env.E2E_EMAIL || env.SMTP_USER || "responsavel.teste@example.com",
  // Second email: the same address with "+responsavel2" (Gmail delivers to the same inbox, no bounce).
  guardianEmail2: (env.E2E_EMAIL || env.SMTP_USER || "responsavel.teste@example.com").replace("@", "+responsavel2@"),
  consent: true,
  consentBiometric: true,
};
// Confirmation link known to the test (the real one only exists in the email): same hash the server uses.
const createLink = async (memberId, email) => {
  const token = "e2e-" + createHash("sha256").update(`${memberId}:${email}:${Math.random()}`).digest("base64url");
  await sb.from("guardian_verifications").insert({
    member_id: memberId, email, token_hash: createHash("sha256").update(`verificacao:${token}`).digest("hex"),
    expires_at: new Date(Date.now() + 3600e3).toISOString(),
  });
  return token;
};
const verify = (token, action, extra = {}) => post("/api/cadastro/verificar", { token, action, ...extra });
const testRegistrations = (name = reg.name) => sb.from("members").select("id, photo_path, face_descriptor, guardian_email2, possible_duplicate_of").eq("birth_date", birth).eq("name", name);
const waitForNotice = async (memberId) => {
  for (let i = 0; i < 20; i++) {
    await new Promise((res) => setTimeout(res, 1000));
    const { data } = await sb.from("checkins").select("guardian_email_status").eq("member_id", memberId).maybeSingle();
    if (data?.guardian_email_status) return data.guardian_email_status;
  }
  return null;
};

try {
  const h = await fetch(`${BASE}/api/health`).then((r) => r.json());
  check("health: variables, tables, bucket and face recognition", h.ok, h.checks);
  if (!h.ok) throw new Error("Fix /api/health before continuing.");

  // ---------- Registration by the guardian: no photo, no password ----------
  let r = await post("/api/cadastro", { ...reg, guardianEmail2: "invalido" });
  check("an invalid second email is rejected (400)", r.status === 400 && !!r.data.errors?.guardianEmail2, r.data);
  r = await post("/api/cadastro", { ...reg, guardianEmail2: reg.guardianEmail.toUpperCase() });
  check("a second email equal to the first is rejected (400)", r.status === 400 && !!r.data.errors?.guardianEmail2, r.data);
  r = await post("/api/cadastro", { ...reg, guardianEmail: "email-invalido" });
  check("registration with an invalid guardian email is rejected (400)", r.status === 400 && !!r.data.errors?.guardianEmail, r);
  r = await post("/api/cadastro", { ...reg, consentBiometric: false });
  check("P1 privacy: registration without the specific face recognition consent is rejected (400)", r.status === 400 && !!r.data.errors?.consentBiometric, r.data);
  // An old client may still send a CPF: the server discards it.
  r = await post("/api/cadastro", { ...reg, cpf: "529.982.247-25" });
  check("guardian registers WITHOUT a photo, door-keeper password or CPF (200)", r.status === 200, r);
  check("registration returns the sender address for the spam-folder hint", typeof r.data.sender === "string" && r.data.sender.includes("@"), r.data);
  const firstResponse = JSON.stringify(Object.keys(r.data).sort());
  r = await post("/api/cadastro", reg);
  const { data: justOne } = await testRegistrations();
  check("P1 CPF: the same guardian resubmitting doesn't duplicate the registration (1 row)", r.status === 200 && justOne?.length === 1, justOne?.length);
  check("P1 CPF: a resubmission responds like a new registration (doesn't reveal who is registered)", JSON.stringify(Object.keys(r.data).sort()) === firstResponse, r.data);
  const noPhoto = justOne[0];
  const cpfColumn = await sb.from("members").select("cpf").eq("id", noPhoto.id).maybeSingle();
  check("P1 CPF: no CPF stored (column dropped or empty)", cpfColumn.error?.code === "42703" || cpfColumn.data?.cpf === null, cpfColumn.error?.code ?? cpfColumn.data);
  check("registration has no photo until the first check-in", !noPhoto.photo_path && !noPhoto.face_descriptor, noPhoto);
  check("the guardian's second email is saved", noPhoto.guardian_email2 === reg.guardianEmail2, noPhoto.guardian_email2);

  // ---------- P1 privacy: the email owner confirms and gives consent ----------
  let links = [];
  for (let i = 0; i < 15 && links.length < 2; i++) {
    await new Promise((res) => setTimeout(res, 1000));
    ({ data: links = [] } = await sb.from("guardian_verifications").select("email, token_hash, expires_at").eq("member_id", noPhoto.id));
  }
  check("P1 privacy: one 7-day confirmation link per email, with only the token hash in the database",
    new Set(links.map((l) => l.email)).size === 2 && links.every((l) => /^[0-9a-f]{64}$/.test(l.token_hash) && Date.parse(l.expires_at) - Date.now() > 6.9 * 86400e3),
    links.map((l) => l.email));
  r = await post("/api/checkin/identificar", { ...inside, name: reg.name, birthDate: birth });
  check("P1 privacy: no check-in without the guardian's confirmation (403 CADASTRO_PENDENTE)", r.status === 403 && r.data.code === "CADASTRO_PENDENTE" && !r.data.token, r.data);
  const link1 = await createLink(noPhoto.id, reg.guardianEmail);
  r = await verify("e2e-link-que-nao-existe-" + stamp, "ver");
  check("P1 privacy: a made-up link doesn't work (404)", r.status === 404, r.status);
  r = await verify(link1, "ver");
  check("P1 privacy: the link only shows the teen's first name", r.status === 200 && r.data.primary === true && r.data.teenFirstName === "Teste" && !JSON.stringify(r.data).includes("Souza"), r.data);
  r = await verify(link1, "confirmar", { consent: true });
  check("P1 privacy: confirming requires the biometric consent (400) and keeps the link valid", r.status === 400 && r.data.code === "SEM_CONSENTIMENTO", r.data);
  r = await verify(link1, "confirmar", { consent: true, consentBiometric: true });
  check("P1 privacy: the guardian confirms through the link (200)", r.status === 200 && r.data.ok, r.data);
  r = await verify(link1, "confirmar", { consent: true, consentBiometric: true });
  check("P1 privacy: the link works only once", r.status === 404, r.status);
  const link2 = await createLink(noPhoto.id, reg.guardianEmail2);
  r = await verify(link2, "confirmar");
  const { data: consent } = await sb.from("members").select("guardian_email_verified_at, guardian_email2_verified_at, biometric_consent_at, consent_version, verify_by").eq("id", noPhoto.id).single();
  check("P1 privacy: consent stored (confirmed emails, biometrics, text version)",
    r.status === 200 && !!consent.guardian_email_verified_at && !!consent.guardian_email2_verified_at && !!consent.biometric_consent_at && !!consent.consent_version && consent.verify_by === null, consent);

  // ---------- Location ----------
  r = await post("/api/checkin/local", outside);
  if (geoOff) check("[test mode] outside the radius is accepted", r.data.ok === true, r);
  else check("outside the radius → ok:false", r.status === 200 && r.data.ok === false, r);
  r = await post("/api/checkin/local", inside);
  check("inside the radius → ok:true", r.data.ok === true, r);

  // ---------- Identification by name + birth date ----------
  r = await post("/api/checkin/identificar", { ...inside, name: reg.name, birthDate: "2011-01-01" });
  check("wrong birth date (404)", r.status === 404 && r.data.code === "NAO_ENCONTRADO", r);
  r = await post("/api/checkin/identificar", { ...inside, name: "Fulano Inexistente", birthDate: birth });
  check("unknown name (404)", r.status === 404, r);
  if (!geoOff) {
    r = await post("/api/checkin/identificar", { ...outside, name: reg.name, birthDate: birth });
    check("identification away from the venue (403)", r.status === 403, r);
  }
  r = await post("/api/checkin/identificar", { ...inside, name: "teste automatico flag", birthDate: birth });
  check("finds the registration without accents, lowercase and without the middle name", r.status === 200 && !!r.data.token, r);
  check("first check-in asks for the REGISTRATION photo", r.data.photoKind === "registro", r.data.photoKind);
  check("identification lasts ~4 h (for the photo taken during the service)", Date.parse(r.data.expiresAt) - Date.now() > 3.9 * 3600_000, r.data.expiresAt);
  let token = r.data.token;

  // ---------- First check-in: registration photo ----------
  let f = await post("/api/checkin/confirmar", { token, photo: photo("no-face") });
  check("registration photo without a face is rejected (422 SEM_ROSTO)", f.status === 422 && f.data.code === "SEM_ROSTO", f.data);
  f = await post("/api/checkin/confirmar", { token, photo: photo("two-people") });
  check("registration photo with two people is rejected (422 VARIOS_ROSTOS)", f.status === 422 && f.data.code === "VARIOS_ROSTOS", f.data);
  f = await post("/api/checkin/confirmar", { token, photo: photo("person-a-registration") });
  check("registration photo with one face completes the registration and asks for the creative photo", f.status === 200 && f.data.registered === true && f.data.next === "criativa", f.data);
  const { data: withPhoto } = await sb.from("members").select("id, photo_path, face_descriptor").eq("id", noPhoto.id).single();
  check("the registration photo becomes the registration's photo (with a descriptor)", !!withPhoto.photo_path && withPhoto.face_descriptor?.length === 128, !!withPhoto.photo_path);
  const { count: stillNone } = await sb.from("checkins").select("id", { count: "exact", head: true }).eq("member_id", withPhoto.id);
  check("the registration photo alone does NOT complete the check-in", stillNone === 0, stillNone);
  f = await post("/api/checkin/confirmar", { token, photo: photo("person-b") });
  check("first check-in: a creative photo of someone else is rejected (403)", f.status === 403 && f.data.code === "ROSTO_NAO_CONFERE", f.data);
  f = await post("/api/checkin/confirmar", { token, photo: photo("person-a-selfie") });
  check("first check-in: the creative photo completes the check-in (200, flagged as first)", f.status === 200 && f.data.photoKind === "criativa" && f.data.isFirst === true, f.data);
  // Visit session: only the device that completed the check-in can see the photo and time again.
  const visitSetCookie = f.headers.get("set-cookie") ?? "";
  const visitCookie = visitSetCookie.split(";")[0];
  check("a completed check-in stores the visit session (httpOnly, SameSite=strict, /api/checkin only)",
    visitCookie.startsWith("o2_visita=") && /httponly/i.test(visitSetCookie) && /samesite=strict/i.test(visitSetCookie) && /path=\/api\/checkin/i.test(visitSetCookie), visitSetCookie);
  const { data: ckLocation } = await sb.from("checkins").select("latitude, longitude, distance_m").eq("member_id", noPhoto.id).single();
  const { data: auditLocation } = await sb.from("audit_events").select("lat, lng, distance_m").eq("member_id", noPhoto.id).gte("at", t0);
  check("P1 privacy: check-in and audit store only the distance to the church, no coordinates",
    ckLocation.latitude === null && ckLocation.longitude === null && typeof ckLocation.distance_m === "number" &&
    auditLocation.length > 0 && auditLocation.every((a) => a.lat === null && a.lng === null) && auditLocation.some((a) => typeof a.distance_m === "number"), { ckLocation, auditLocation: auditLocation.slice(0, 2) });
  const notice = await waitForNotice(noPhoto.id);
  const expected = env.E2E_EMAIL ? ["enviado"] : ["enviado", "falhou", "sem_config"];
  check(`guardian notice recorded (${notice})`, expected.includes(notice), notice);

  // ---------- P0 REGRESSION: name + birth date + coordinates do NOT give access to photo/time ----------
  // Someone who knows another teen's name and birth date, and reports coordinates INSIDE the church
  // (a phone can fake them), can't get that teen's check-in photo or time.
  const leaked = (resp) => {
    const txt = JSON.stringify(resp.data);
    return "photoUrl" in resp.data || "checkedInAt" in resp.data || "alreadyCheckedIn" in resp.data || /\/storage\/v1\/object|token=ey/.test(txt);
  };
  const attacker = await post("/api/checkin/identificar", { ...inside, name: reg.name, birthDate: birth });
  check("P0: without the visit session, valid name + birth date + coordinates reveal no photo, time or 'already checked in'",
    attacker.status === 200 && !leaked(attacker), attacker.data);
  const withForged = await post("/api/checkin/identificar", { ...inside, name: reg.name, birthDate: birth }, { cookie: "o2_visita=eyJtaWQiOiJ4In0.assinaturafalsa" });
  check("P0: a forged visit cookie reveals nothing either", withForged.status === 200 && !leaked(withForged), withForged.data);
  const noAccents = await post("/api/checkin/identificar", { ...inside, name: "teste automatico flag", birthDate: birth });
  check("P0: a variation of the name reveals nothing either", noAccents.status === 200 && !leaked(noAccents), noAccents.data);
  const wrongFace = await post("/api/checkin/confirmar", { token: attacker.data.token, photo: photo("person-b") });
  check("P0: with the attacker's token, another face is rejected without revealing the check-in (403)",
    wrongFace.status === 403 && wrongFace.data.code === "ROSTO_NAO_CONFERE" && !("photoUrl" in wrongFace.data) && !("checkedInAt" in wrongFace.data), wrongFace.data);
  const owner = await post("/api/checkin/identificar", { ...inside, name: reg.name, birthDate: birth }, { cookie: visitCookie });
  check("the device that checked in (visit session) sees the photo and time again", owner.data.alreadyCheckedIn === true && !!owner.data.photoUrl && !!owner.data.checkedInAt, owner.data);
  f = await post("/api/checkin/confirmar", { token, photo: photo("person-a-selfie") });
  check("a second check-in on the same day, with a matching face, is rejected (409) and shows the existing one", f.status === 409 && f.data.code === "DUPLICADO" && !!f.data.checkedInAt, f.data);

  // ---------- Later check-ins: creative photo ----------
  // Simulates "another Sunday": today's check-in moves to last week (the registration already has the reference photo).
  const m = noPhoto;
  const lastWeek = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  await sb.from("checkins").update({ service_date: lastWeek }).eq("member_id", m.id);
  r = await post("/api/checkin/identificar", { ...inside, name: reg.name, birthDate: birth });
  check("a later check-in asks for the CREATIVE photo (no registration photo)", r.status === 200 && r.data.photoKind === "criativa", r.data);
  token = r.data.token;
  f = await post("/api/checkin/confirmar", { token, photo: photo("no-face") });
  check("a creative photo without a face is rejected (422)", f.status === 422 && f.data.code === "SEM_ROSTO", f.data);
  f = await post("/api/checkin/confirmar", { token, photo: photo("person-b") });
  check("a creative photo of SOMEONE ELSE is rejected (403)", f.status === 403 && f.data.code === "ROSTO_NAO_CONFERE", f.data);
  f = await post("/api/checkin/confirmar", { token, photo: photo("two-people") });
  check("a GROUP creative photo with the teen is accepted (200, not the first)", f.status === 200 && f.data.photoKind === "criativa" && f.data.isFirst === false, f.data);

  // ---------- Visitor ----------
  r = await post("/api/checkin/visitante", { ...inside, name: "Visitante Teste", phone: "123" });
  check("a visitor with an invalid phone is rejected (400)", r.status === 400 && !!r.data.errors?.phone, r.data);
  r = await post("/api/checkin/visitante", { ...inside, name: "Visitante Teste Sem Foto", phone: visitorPhones[0] });
  check("visitor with only a name and phone (200)", r.status === 200 && r.data.ok && !r.data.alreadyCheckedIn, r.data);
  r = await post("/api/checkin/visitante", { ...inside, name: "Visitante Teste Sem Foto", phone: visitorPhones[0] });
  check("a repeat visitor on the same day → already checked in", r.status === 200 && r.data.alreadyCheckedIn === true, r.data);
  r = await post("/api/checkin/visitante", { ...inside, name: "Visitante Teste Com Foto", phone: visitorPhones[1], photo: photo("person-b") });
  check("visitor with the optional creative photo (200)", r.status === 200 && r.data.ok, r.data);
  const { data: visitorPhoto } = await sb.from("checkins").select("photo_path, latitude").eq("visitor_phone", visitorPhones[1]).single();
  check("P1 privacy: visitor photo without the phone number in the file name and without coordinates",
    !!visitorPhoto.photo_path && !visitorPhoto.photo_path.includes(visitorPhones[1]) && visitorPhoto.latitude === null, visitorPhoto.photo_path);
  if (!geoOff) {
    r = await post("/api/checkin/visitante", { ...outside, name: "Visitante Longe", phone: randomPhone() });
    check("visitor away from the venue (403)", r.status === 403, r.data);
  }

  // ---------- P1: individual leader accounts (password + authenticator app) ----------
  const noSession = await fetch(`${BASE}/api/pastor/feed`);
  check("the leaders' feed without a session is blocked (401)", noSession.status === 401, noSession.status);
  r = await post("/api/pastor/sessao", { password: "qualquer-senha-compartilhada" });
  check("P1: the old shared password no longer exists", r.status === 404 || r.status === 405, r.status);

  // First leader: created straight in the database (like npm run leader:create), with an activation code.
  const activationA = "E2E2-TEST-" + String(stamp).slice(-4).replace(/[01]/g, "7");
  const { data: lA } = await sb.from("leaders").insert({ name: "E2E Líder A", email: leaderEmails[0], setup_code_hash: activationHash(activationA), setup_expires_at: new Date(Date.now() + 3600e3).toISOString() }).select("id").single();
  r = await req("POST", "/api/lider/ativar", { email: leaderEmails[0], setupCode: activationA, password: "curta" });
  check("P1: activation rejects a weak password (400)", r.status === 400, r.data);
  r = await req("POST", "/api/lider/ativar", { email: leaderEmails[0], setupCode: "ABCD-EFGH-JKMN", password: PASSWORD_A });
  check("P1: a wrong activation code is rejected (401)", r.status === 401, r.data);
  r = await req("POST", "/api/lider/ativar", { email: leaderEmails[0], setupCode: activationA, password: PASSWORD_A });
  const ckEnroll = r.cookie;
  check("P1: activation leads MANDATORILY to authenticator enrollment", r.status === 200 && r.data.stage === "cadastro_totp" && /httponly/i.test(r.setCookie), r.data);
  r = await req("POST", "/api/lider/ativar", { email: leaderEmails[0], setupCode: activationA, password: PASSWORD_A });
  check("P1: the activation code works only once", r.status === 401, r.status);
  r = await req("GET", "/api/pastor/feed", null, ckEnroll);
  check("P1: without an enrolled authenticator, no private data (401)", r.status === 401, r.status);
  const setupA = await req("GET", "/api/lider/autenticador", null, ckEnroll);
  check("P1: enrollment shows the authenticator QR code and key", setupA.status === 200 && setupA.data.qr?.startsWith("data:image/png") && setupA.data.uri?.startsWith("otpauth://totp/"), setupA.status);
  r = await req("POST", "/api/lider/autenticador", { code: "000000" }, ckEnroll);
  check("P1: a wrong code during authenticator enrollment is rejected", r.status === 400, r.data);
  const enrollCode = totp(setupA.data.secret);
  r = await req("POST", "/api/lider/autenticador", { code: enrollCode }, ckEnroll);
  const recoveryCodesA = r.data.recoveryCodes ?? [];
  let ckA = r.cookie;
  check("P1: authenticator enrolled → 10 recovery codes and a complete session", r.status === 200 && r.data.stage === "completa" && recoveryCodesA.length === 10, r.data);
  r = await req("GET", "/api/pastor/feed", null, ckEnroll);
  check("P1: the previous stage's cookie stops working (session rotated)", r.status === 401, r.status);

  // Normal login: password → code.
  r = await req("POST", "/api/lider/entrar", { email: leaderEmails[0], password: PASSWORD_A + "x" });
  check("P1: a wrong password is rejected (401)", r.status === 401, r.data);
  r = await req("POST", "/api/lider/entrar", { email: leaderEmails[0], password: PASSWORD_A });
  let ckPassword = r.cookie;
  check("P1: the right password unlocks ONLY the code step", r.status === 200 && r.data.stage === "senha", r.data);
  r = await req("GET", "/api/pastor/feed", null, ckPassword);
  check("P1: the password alone doesn't open the feed (401)", r.status === 401, r.status);
  r = await req("POST", "/api/lider/verificar", { code: enrollCode }, ckPassword);
  check("P1: an authenticator code already used doesn't work again", r.status === 401, r.data);
  const nextCode = totp(setupA.data.secret, 1);
  r = await req("POST", "/api/lider/verificar", { code: nextCode }, ckPassword);
  ckA = r.cookie;
  check("P1: password + authenticator code → full access", r.status === 200 && r.data.stage === "completa", r.data);
  r = await req("POST", "/api/lider/entrar", { email: leaderEmails[0], password: PASSWORD_A });
  r = await req("POST", "/api/lider/verificar", { code: nextCode }, r.cookie);
  check("P1: the same code doesn't work for a second login", r.status === 401, r.status);

  // Attempt limit under SIMULTANEOUS requests (counter in the database, works across instances).
  const burst = await Promise.all(Array.from({ length: 14 }, () => req("POST", "/api/lider/entrar", { email: leaderEmails[1], password: "chute qualquer 123" })));
  const denied = burst.filter((x) => x.status === 401).length, blocked = burst.filter((x) => x.status === 429).length;
  check("P1: 14 simultaneous attempts → at most 8 checked, the rest blocked (429)", denied <= 8 && blocked >= 6 && denied + blocked === 14, { denied, blocked });
  const codeBurst = await (async () => {
    const l = await req("POST", "/api/lider/entrar", { email: leaderEmails[0], password: PASSWORD_A });
    return Promise.all(Array.from({ length: 8 }, () => req("POST", "/api/lider/verificar", { code: "123456" }, l.cookie)));
  })();
  check("P1: simultaneous guesses of the 6-digit code are limited too (5 per 15 min)",
    codeBurst.filter((x) => /Código incorreto/.test(x.data.error ?? "")).length <= 5 && codeBurst.some((x) => x.status === 429), codeBurst.map((x) => x.status));
  await sb.from("auth_rate_limits").delete().like("key", `%${lA.id}%`);

  // Lost phone: recovery code (single use) → enroll a new authenticator.
  r = await req("POST", "/api/lider/entrar", { email: leaderEmails[0], password: PASSWORD_A });
  r = await req("POST", "/api/lider/verificar", { recoveryCode: recoveryCodesA[0] }, r.cookie);
  const ckRecovery = r.cookie;
  check("P1: a recovery code gets in and REQUIRES enrolling a new authenticator", r.status === 200 && r.data.stage === "cadastro_totp", r.data);
  r = await req("GET", "/api/pastor/feed", null, ckA);
  check("P1: using a recovery code ends the other sessions (the lost phone may be signed in)", r.status === 401, r.status);
  const setupA2 = await req("GET", "/api/lider/autenticador", null, ckRecovery);
  r = await req("POST", "/api/lider/autenticador", { code: totp(setupA2.data.secret) }, ckRecovery);
  check("P1: new authenticator enrolled, recovery codes renewed", r.status === 200 && r.data.recoveryCodes?.length === 10 && setupA2.data.secret !== setupA.data.secret, r.status);
  ckA = r.cookie;
  r = await req("POST", "/api/lider/entrar", { email: leaderEmails[0], password: PASSWORD_A });
  r = await req("POST", "/api/lider/verificar", { recoveryCode: recoveryCodesA[1] }, r.cookie);
  check("P1: old recovery codes stop working", r.status === 401, r.status);
  await sb.from("auth_rate_limits").delete().like("key", `%${lA.id}%`);

  // Administration: A creates C, C activates; A deactivates C → only C's sessions end.
  r = await req("POST", "/api/lider/contas", { name: "E2E Líder C", email: leaderEmails[2] }, ckA);
  check("P1: a leader creates another leader's account (single-use activation code)", r.status === 200 && /^[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4}$/.test(r.data.setupCode ?? ""), r.data);
  const idC = r.data.id;
  r = await req("POST", "/api/lider/ativar", { email: leaderEmails[2], setupCode: r.data.setupCode, password: "louvor e2e conta c " + stamp });
  const setupC = await req("GET", "/api/lider/autenticador", null, r.cookie);
  r = await req("POST", "/api/lider/autenticador", { code: totp(setupC.data.secret) }, r.cookie);
  const ckC = r.cookie;
  check("P1: leader C activated and signed in", (await req("GET", "/api/pastor/feed", null, ckC)).status === 200);
  r = await req("PATCH", "/api/lider/contas", { id: lA.id, action: "desativar" }, ckA);
  check("P1: nobody can deactivate their own account (403)", r.status === 403, r.data);
  r = await req("PATCH", "/api/lider/contas", { id: idC, action: "desativar" }, ckA);
  check("P1: deactivating ends the leader's open sessions", r.status === 200 && r.data.sessionsEnded >= 1, r.data);
  r = await req("GET", "/api/pastor/feed", null, ckC);
  check("P1: a deactivated leader loses access IMMEDIATELY (401)", r.status === 401, r.status);
  r = await req("GET", "/api/pastor/feed", null, ckA);
  check("P1: the other leaders stay signed in", r.status === 200, r.status);
  r = await req("GET", "/api/lider/contas", null, ckC);
  check("P1: a deactivated leader can't manage accounts (401)", r.status === 401, r.status);

  // A teen never becomes a leader.
  r = await req("GET", "/api/lider/contas", null, visitCookie);
  const r2v = await req("GET", "/api/pastor/feed", null, visitCookie);
  const r3v = await req("DELETE", "/api/pastor/checkins", { id: "x", reason: "access test" }, visitCookie);
  check("P1: the teen's visit session can't reach leader functions", r.status === 401 && r2v.status === 401 && r3v.status === 401, [r.status, r2v.status, r3v.status]);
  const pastorCookie = ckA; // leader A's current session (the previous one ended when they used the recovery code)

  const feed = await fetch(`${BASE}/api/pastor/feed`, { headers: { cookie: pastorCookie } }).then((x) => x.json());
  const mine = feed.items?.find((i) => i.name === reg.name);
  check("the check-in shows up in the feed with the creative photo and the registration photo", !!mine?.selfieUrl && !!mine?.avatarUrl && mine.photoKind === "criativa", mine);
  const visitors = feed.items?.filter((i) => i.isVisitor && i.name.startsWith("Visitante Teste")) ?? [];
  check("visitors show up in the feed flagged as visitors", visitors.length === 2, visitors.length);
  const since = await fetch(`${BASE}/api/pastor/feed?since=${encodeURIComponent(feed.items?.[0]?.checkedInAt ?? "")}`, { headers: { cookie: pastorCookie } }).then((x) => x.json());
  check("the incremental feed (since) doesn't repeat what was already seen", Array.isArray(since.items) && since.items.length === 0, since.items?.length);
  const dashNoSession = await fetch(`${BASE}/api/pastor/dashboard`);
  check("the dashboard without a session is blocked (401)", dashNoSession.status === 401, dashNoSession.status);
  const dash = await fetch(`${BASE}/api/pastor/dashboard`, { headers: { cookie: pastorCookie } }).then((x) => x.json());
  const todayService = dash.trend?.at(-1);
  check("the dashboard counts today's service (teen + 2 visitors)", todayService?.registered >= 1 && todayService?.visitors >= 2 && dash.kpis?.services >= 1, todayService);
  const rk = dash.ranking ?? [];
  const sorted = rk.every((r, i) => i === 0 || rk[i - 1].attendances >= r.attendances);
  const hasRoom = rk.length < 10;
  check("the ranking is sorted (up to 10) and includes the test teen when there's room",
    sorted && rk.length <= 10 && (!hasRoom || rk.some((r) => r.name === reg.name)), rk.map((r) => [r.name, r.attendances]));

  const r2 = await post("/api/cadastro", { ...reg, name: createdNames[1] }, { cookie: pastorCookie });
  const { data: byPastor } = await testRegistrations(createdNames[1]);
  check("a leader registers through the same form (200), without flagging a different name as a duplicate", r2.status === 200 && byPastor?.[0]?.possible_duplicate_of === null, r2.data);

  const { data: att } = await sb.from("presencas").select("nome, tipo, tipo_foto").in("nome", [reg.name, "Visitante Teste Sem Foto"]);
  check("the presencas view shows the teen (creative photo) and the visitor", att?.some((p) => p.tipo === "cadastrado" && p.tipo_foto === "criativa") && att?.some((p) => p.tipo === "visitante"), att);

  // Attendance correction (with a reason) and audit trail.
  r = await req("DELETE", "/api/pastor/checkins", { id: mine?.id, reason: "" }, ckA);
  check("P1: an attendance correction requires a reason (400)", r.status === 400, r.data);
  r = await req("DELETE", "/api/pastor/checkins", { id: mine?.id, reason: "automated test: attendance recorded by mistake" }, ckA);
  const { data: stillThere } = await sb.from("checkins").select("id").eq("id", mine?.id ?? "").maybeSingle();
  check("P1: a leader removes an attendance recorded by mistake", r.status === 200 && !stillThere, r.data);

  // ---------- P1 CPF: possible duplicates for a leader to review ----------
  // Another guardian registers the same teen with the name written differently.
  r = await post("/api/cadastro", { ...reg, name: DUPLICATE_NAME, guardianEmail: reg.guardianEmail.replace("@", "+outro@"), guardianEmail2: "" });
  const { data: [dup] = [] } = await testRegistrations(DUPLICATE_NAME);
  check("P1 CPF: a similar registration is accepted and flagged as a possible duplicate of the original", r.status === 200 && dup?.possible_duplicate_of === m.id, dup);
  r = await post("/api/checkin/identificar", { ...inside, name: reg.name, birthDate: birth });
  check("P1 CPF: with two matching registrations, check-in asks for the full name or a leader (409)", r.status === 409 && r.data.code === "AMBIGUO", r.data);
  r = await req("GET", "/api/lider/duplicados");
  check("P1 CPF: the duplicate list requires a leader (401)", r.status === 401, r.status);
  r = await req("GET", "/api/lider/duplicados", null, ckA);
  const pair = r.data.pairs?.find((p) => p.duplicate.id === dup?.id);
  check("P1 CPF: a leader sees the pair (new × existing, attendances, same guardian contact)",
    r.status === 200 && pair?.original.id === m.id && pair.sameGuardian === true && pair.original.checkins >= 1, pair);
  check("P1 CPF: the review exposes no email, phone or CPF", !/@|61988880000|cpf/i.test(JSON.stringify(r.data.pairs)), r.data.pairs);
  r = await req("PATCH", "/api/lider/duplicados", { id: dup?.id, action: "pessoas_diferentes" }, ckA);
  const { data: [dupCleared] = [] } = await testRegistrations(DUPLICATE_NAME);
  check("P1 CPF: 'different people' clears the flag", r.status === 200 && dupCleared?.possible_duplicate_of === null, r.data);

  // Merge: the duplicate has one attendance on a service the original lacks and another on one it has.
  await sb.from("members").update({ possible_duplicate_of: m.id }).eq("id", dup.id);
  const twoWeeksAgo = new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10);
  const { count: before } = await sb.from("checkins").select("id", { count: "exact", head: true }).eq("member_id", m.id);
  await sb.from("checkins").insert([
    { member_id: dup.id, service_date: twoWeeksAgo, photo_kind: "criativa" },
    { member_id: dup.id, service_date: lastWeek, photo_kind: "criativa" },
  ]);
  r = await req("PATCH", "/api/lider/duplicados", { id: dup.id, action: "mesclar" }, ckA);
  const { data: dupAfter } = await sb.from("members").select("id").eq("id", dup.id).maybeSingle();
  const { data: original } = await sb.from("members").select("id, photo_path, face_descriptor").eq("id", m.id).single();
  const { data: hist } = await sb.from("checkins").select("service_date").eq("member_id", m.id);
  check("P1 CPF: merging deletes the duplicate and keeps the original's id and history (+1 service, no repeated day)",
    r.status === 200 && !dupAfter && original.id === m.id && hist.length === before + 1 && hist.some((h) => h.service_date === twoWeeksAgo) &&
    new Set(hist.map((h) => h.service_date)).size === hist.length && original.face_descriptor?.length === 128, { status: r.status, hist });
  r = await req("PATCH", "/api/lider/duplicados", { id: m.id, action: "mesclar" }, ckA);
  check("P1 CPF: an unflagged registration isn't merged (404)", r.status === 404, r.status);

  // ---------- P1 privacy: family requests handled by leaders ----------
  r = await req("GET", `/api/lider/cadastros?q=${encodeURIComponent(reg.name)}`);
  check("P1 privacy: registration search requires a leader (401)", r.status === 401, r.status);
  r = await req("GET", `/api/lider/cadastros?q=${encodeURIComponent("teste automatico flag")}`, null, ckA);
  const found = r.data.items?.find((i) => i.id === m.id);
  check("P1 privacy: a leader finds the registration (without accents) and sees it is confirmed", r.status === 200 && found?.confirmed === true && found.canCheckin, found);
  r = await req("GET", `/api/lider/cadastros?exportar=${m.id}`, null, ckA);
  check("P1 privacy: the export includes the registration and attendances, without the face numbers",
    r.status === 200 && r.data.cadastro?.id === m.id && r.data.cadastro.guardian_email === reg.guardianEmail && r.data.presencas?.length >= 1 &&
    r.data.biometria?.dadosDoRosto === true && !("face_descriptor" in r.data.cadastro) && !JSON.stringify(r.data).includes("fotos/"), Object.keys(r.data));
  r = await req("PATCH", "/api/lider/cadastros", { id: m.id, action: "revogar_biometria" }, ckA);
  const { data: noBio } = await sb.from("members").select("photo_path, face_descriptor, biometric_consent_at, guardian_email_verified_at").eq("id", m.id).single();
  const idNoBio = await post("/api/checkin/identificar", { ...inside, name: reg.name, birthDate: birth });
  check("P1 privacy: withdrawing biometrics deletes the registration photo and face data and blocks check-in",
    r.status === 200 && !noBio.photo_path && !noBio.face_descriptor && !noBio.biometric_consent_at && idNoBio.status === 403 && idNoBio.data.code === "CADASTRO_PENDENTE", { noBio, id: idNoBio.status });
  r = await req("PATCH", "/api/lider/cadastros", { id: m.id, action: "reenviar" }, ckA);
  check("P1 privacy: a leader resends the confirmation link", r.status === 200 && r.data.sent >= 1, r.data);
  const { data: [byPastor2] = [] } = await testRegistrations(createdNames[1]);
  r = await req("DELETE", "/api/lider/cadastros", { id: byPastor2?.id, reason: "" }, ckA);
  check("P1 privacy: deleting a registration requires a reason (400)", r.status === 400, r.data);
  r = await req("DELETE", "/api/lider/cadastros", { id: byPastor2?.id, reason: "automated test: erasure request" }, ckA);
  const { data: deleted } = await sb.from("members").select("id").eq("id", byPastor2?.id ?? "").maybeSingle();
  check("P1 privacy: a leader deletes the registration at the family's request", r.status === 200 && !deleted, r.data);

  // The guardian declines through the link: the registration disappears immediately.
  await post("/api/cadastro", { ...reg, name: createdNames[3], guardianEmail2: "" });
  const { data: [declined] = [] } = await testRegistrations(createdNames[3]);
  r = await verify(await createLink(declined.id, reg.guardianEmail), "recusar");
  const { data: declinedAfter } = await sb.from("members").select("id").eq("id", declined.id).maybeSingle();
  check("P1 privacy: 'não autorizo' on the link deletes the registration", r.status === 200 && r.data.removed === "cadastro" && !declinedAfter, r.data);

  // Retention: the dry run counts and changes nothing; only the server can call it; the cron requires the secret.
  const { count: beforePurge } = await sb.from("members").select("id", { count: "exact", head: true });
  const sim = await sb.rpc("expurgar_dados", { p_simular: true });
  const { count: afterPurge } = await sb.from("members").select("id", { count: "exact", head: true });
  check("P1 privacy: the retention dry run counts what would go and deletes nothing",
    !sim.error && sim.data?.simulacao === true && typeof sim.data.fotos_checkin === "number" && beforePurge === afterPurge, sim.error?.message ?? sim.data);
  if (env.SUPABASE_ANON_KEY) {
    const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const a = await anon.rpc("expurgar_dados", { p_simular: true });
    check("P1 privacy: the public key can't run retention", !!a.error, a.error?.message);
  }
  r = await req("GET", "/api/cron/retencao");
  check("P1 privacy: the cron route without the secret is rejected (401)", r.status === 401, r.status);
  const page = await fetch(`${BASE}/privacidade`).then(async (x) => ({ status: x.status, html: await x.text() }));
  check("P1 privacy: the /privacidade page explains biometrics, photos and retention periods",
    page.status === 200 && /reconhecimento facial/i.test(page.html) && /128 números/.test(page.html) && /só texto/i.test(page.html) && /30 dias/.test(page.html), page.status);

  const { data: trail } = await sb.from("admin_audit").select("id, actor_id, action, target_id, outcome, details").gte("at", t0).order("id");
  const has = (action, outcome, f = () => true) => (trail ?? []).some((a) => a.action === action && a.outcome === outcome && f(a));
  check("P1: the trail records activation, authenticator, login, recovery, creation and deactivation",
    has("conta_ativada", "ok", (a) => a.target_id === lA.id) && has("totp_cadastrado", "ok", (a) => a.actor_id === lA.id) &&
    has("login", "ok", (a) => a.actor_id === lA.id) && has("login", "negado") && has("login", "bloqueado") &&
    has("recuperacao_usada", "ok", (a) => a.actor_id === lA.id) && has("conta_criada", "ok", (a) => a.actor_id === lA.id && a.target_id === idC) &&
    has("conta_desativada", "ok", (a) => a.actor_id === lA.id && a.target_id === idC) && has("conta_desativada", "negado", (a) => a.target_id === lA.id),
    [...new Set((trail ?? []).map((a) => `${a.action}:${a.outcome}`))]);
  check("P1: the attendance correction is recorded with who, which and why",
    has("presenca_removida", "ok", (a) => a.actor_id === lA.id && a.target_id === mine?.id && /by mistake/.test(a.details?.motivo ?? "")));
  check("P1 CPF: the duplicate review is in the trail (different people and merge)",
    has("duplicado_descartado", "ok", (a) => a.actor_id === lA.id && a.target_id === dup.id) &&
    has("cadastro_mesclado", "ok", (a) => a.actor_id === lA.id && a.target_id === m.id && a.details?.cadastro_apagado === dup.id));
  check("P1 privacy: consent, export, withdrawn biometrics, resend and deletions are in the trail",
    has("consentimento_registrado", "ok", (a) => a.target_id === noPhoto.id && !a.actor_id) && has("dados_exportados", "ok", (a) => a.actor_id === lA.id && a.target_id === m.id) &&
    has("biometria_revogada", "ok", (a) => a.target_id === m.id) && has("confirmacao_reenviada", "ok", (a) => a.target_id === m.id) &&
    has("cadastro_apagado", "ok", (a) => a.actor_id === lA.id && a.target_id === byPastor2?.id) && has("cadastro_apagado", "ok", (a) => a.target_id === declined.id && a.details?.origem === "responsavel_recusou"));
  const trailText = JSON.stringify(trail);
  const secrets = [PASSWORD_A, enrollCode, nextCode, ...recoveryCodesA, activationA, setupA.data.secret?.replace(/ /g, "")].filter(Boolean);
  check("P1: the trail contains no password, codes or authenticator key", !secrets.some((x) => trailText.includes(x)));
  const oneId = trail?.[0]?.id;
  const edit = await sb.from("admin_audit").update({ outcome: "ok", action: "adulterado" }).eq("id", oneId).select("id");
  const del = await sb.from("admin_audit").delete().eq("id", oneId).select("id");
  const { data: intact } = await sb.from("admin_audit").select("action").eq("id", oneId).maybeSingle();
  check("P1: the audit trail can't be edited or deleted, not even with the server key", !!edit.error && !!del.error && intact?.action === trail?.[0]?.action, { edit: edit.error?.message, del: del.error?.message });
  const delEv = await sb.from("audit_events").delete().gte("at", t0).select("id");
  check("P1: the check-in audit (P0) is insert-only too", !!delEv.error, delEv.error?.message);
} catch (e) {
  console.error("⚠️ ", e.message);
  failures++;
} finally {
  // Cleanup: test teens (check-ins cascade), test visitors and every photo.
  const { data: created } = await sb.from("members").select("id, photo_path").eq("birth_date", birth).in("name", createdNames);
  for (const m of created ?? []) {
    const { data: cks } = await sb.from("checkins").select("photo_path").eq("member_id", m.id);
    await sb.storage.from("fotos").remove([m.photo_path, ...(cks ?? []).map((c) => c.photo_path)].filter(Boolean));
    await sb.from("members").delete().eq("id", m.id);
  }
  const { data: visitorCks } = await sb.from("checkins").select("id, photo_path").is("member_id", null).in("visitor_phone", visitorPhones);
  if (visitorCks?.length) {
    await sb.storage.from("fotos").remove(visitorCks.map((c) => c.photo_path).filter(Boolean));
    await sb.from("checkins").delete().in("id", visitorCks.map((c) => c.id));
  }
  // Test leaders (sessions and codes cascade). The audit trail stays: it is immutable.
  await sb.from("leaders").delete().in("email", leaderEmails);
  await sb.from("auth_rate_limits").delete().like("key", "%e2e.lider.%");
  await sb.from("auth_rate_limits").delete().gte("window_start", t0).or("key.like.entrar:ip:%,key.like.ativar:ip:%");
  console.log("🧹 test data removed");
}
console.log(failures ? `\n${failures} failure(s).` : "\nAll checks passed! 🎉");
process.exit(failures ? 1 : 0);
