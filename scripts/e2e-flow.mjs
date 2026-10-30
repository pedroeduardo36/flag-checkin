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

function randomCpf() {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  for (const len of [9, 10]) {
    const s = n.reduce((acc, d, i) => acc + d * (len + 1 - i), 0);
    const r = (s * 10) % 11;
    n.push(r === 10 ? 0 : r);
  }
  return n.join("");
}
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

const cpf = randomCpf();
const createdCpfs = [cpf];
const visitorPhones = [randomPhone(), randomPhone()];
const birth = "2010-05-20";
const reg = {
  name: "Teste Automático de Souza Flag", cpf, phone: "", birthDate: birth,
  guardianName: "Responsável Teste", guardianPhone: "61988880000",
  guardianEmail: env.E2E_EMAIL || env.SMTP_USER || "responsavel.teste@example.com",
  // Second email: the same address with "+responsavel2" (Gmail delivers it to the same inbox, no bounce).
  guardianEmail2: (env.E2E_EMAIL || env.SMTP_USER || "responsavel.teste@example.com").replace("@", "+responsavel2@"),
  consent: true,
};
const waitForNotice = async (memberCpf) => {
  for (let i = 0; i < 20; i++) {
    await new Promise((res) => setTimeout(res, 1000));
    const { data } = await sb.from("checkins").select("guardian_email_status, members!inner(cpf)").eq("members.cpf", memberCpf).maybeSingle();
    if (data?.guardian_email_status) return data.guardian_email_status;
  }
  return null;
};

try {
  const h = await fetch(`${BASE}/api/health`).then((r) => r.json());
  check("health: variables, tables, bucket and face recognition", h.ok, h.checks);
  if (!h.ok) throw new Error("Fix /api/health before continuing.");

  // ---------- Registration by the guardian: no photo and no password ----------
  let r = await post("/api/cadastro", { ...reg, guardianEmail2: "invalido" });
  check("invalid second email is rejected (400)", r.status === 400 && !!r.data.errors?.guardianEmail2, r.data);
  r = await post("/api/cadastro", { ...reg, guardianEmail2: reg.guardianEmail.toUpperCase() });
  check("second email equal to the first is rejected (400)", r.status === 400 && !!r.data.errors?.guardianEmail2, r.data);
  r = await post("/api/cadastro", { ...reg, guardianEmail: "email-invalido" });
  check("registration with an invalid guardian email is rejected (400)", r.status === 400 && !!r.data.errors?.guardianEmail, r);
  r = await post("/api/cadastro", reg);
  check("guardian registers with NO photo and NO door-keeper password (200)", r.status === 200, r);
  check("registration returns the sender for the spam notice", typeof r.data.sender === "string" && r.data.sender.includes("@"), r.data);
  r = await post("/api/cadastro", reg);
  check("duplicate CPF is rejected (409)", r.status === 409, r);
  const { data: noPhoto } = await sb.from("members").select("photo_path, face_descriptor, guardian_email2").eq("cpf", cpf).single();
  check("registration has no photo until the first check-in", !noPhoto.photo_path && !noPhoto.face_descriptor, noPhoto);
  check("the guardian's second email is saved", noPhoto.guardian_email2 === reg.guardianEmail2, noPhoto.guardian_email2);

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
  check("name that doesn't exist (404)", r.status === 404, r);
  if (!geoOff) {
    r = await post("/api/checkin/identificar", { ...outside, name: reg.name, birthDate: birth });
    check("identifying outside the venue (403)", r.status === 403, r);
  }
  r = await post("/api/checkin/identificar", { ...inside, name: "teste automatico flag", birthDate: birth });
  check("finds the registration without accents, lowercase and without the middle name", r.status === 200 && !!r.data.token, r);
  check("first check-in asks for a REGISTRATION photo", r.data.photoKind === "registro", r.data.photoKind);
  check("identification lasts ~4 h (for the photo during the service)", Date.parse(r.data.expiresAt) - Date.now() > 3.9 * 3600_000, r.data.expiresAt);
  let token = r.data.token;

  // ---------- First check-in: registration photo ----------
  let f = await post("/api/checkin/confirmar", { token, photo: photo("no-face") });
  check("registration photo with no face is rejected (422 SEM_ROSTO)", f.status === 422 && f.data.code === "SEM_ROSTO", f.data);
  f = await post("/api/checkin/confirmar", { token, photo: photo("two-people") });
  check("registration photo with two people is rejected (422 VARIOS_ROSTOS)", f.status === 422 && f.data.code === "VARIOS_ROSTOS", f.data);
  f = await post("/api/checkin/confirmar", { token, photo: photo("person-a-registration") });
  check("registration photo with one face completes the registration and asks for the creative photo", f.status === 200 && f.data.registered === true && f.data.next === "criativa", f.data);
  const { data: withPhoto } = await sb.from("members").select("id, photo_path, face_descriptor").eq("cpf", cpf).single();
  check("registration photo becomes the registration's photo (with descriptor)", !!withPhoto.photo_path && withPhoto.face_descriptor?.length === 128, !!withPhoto.photo_path);
  const { count: stillNone } = await sb.from("checkins").select("id", { count: "exact", head: true }).eq("member_id", withPhoto.id);
  check("the registration photo alone does NOT complete the check-in", stillNone === 0, stillNone);
  f = await post("/api/checkin/confirmar", { token, photo: photo("person-b") });
  check("first check-in: a creative photo of someone else is rejected (403)", f.status === 403 && f.data.code === "ROSTO_NAO_CONFERE", f.data);
  f = await post("/api/checkin/confirmar", { token, photo: photo("person-a-selfie") });
  check("first check-in: the creative photo completes the check-in (200, marked as first)", f.status === 200 && f.data.photoKind === "criativa" && f.data.isFirst === true, f.data);
  // Visit session: only the device that completed the check-in can see the photo and time again.
  const visitSetCookie = f.headers.get("set-cookie") ?? "";
  const visitCookie = visitSetCookie.split(";")[0];
  check("completed check-in stores the visit session (httpOnly, SameSite=strict, /api/checkin only)",
    visitCookie.startsWith("o2_visita=") && /httponly/i.test(visitSetCookie) && /samesite=strict/i.test(visitSetCookie) && /path=\/api\/checkin/i.test(visitSetCookie), visitSetCookie);
  const notice = await waitForNotice(cpf);
  const expected = env.E2E_EMAIL ? ["enviado"] : ["enviado", "falhou", "sem_config"];
  check(`guardian notice recorded (${notice})`, expected.includes(notice), notice);

  // ---------- P0 REGRESSION: name + birth date + coordinates do NOT give access to photo/time ----------
  // Someone who knows another teen's name and birth date, and reports coordinates INSIDE the church
  // (the phone can fake them), can't get that teen's check-in photo or time.
  const leaked = (resp) => {
    const txt = JSON.stringify(resp.data);
    return "photoUrl" in resp.data || "checkedInAt" in resp.data || "alreadyCheckedIn" in resp.data || /\/storage\/v1\/object|token=ey/.test(txt);
  };
  const attacker = await post("/api/checkin/identificar", { ...inside, name: reg.name, birthDate: birth });
  check("P0: without a visit session, valid name + birth date + coordinates do NOT reveal photo, time or 'already checked in'",
    attacker.status === 200 && !leaked(attacker), attacker.data);
  const forged = await post("/api/checkin/identificar", { ...inside, name: reg.name, birthDate: birth }, { cookie: "o2_visita=eyJtaWQiOiJ4In0.assinaturafalsa" });
  check("P0: a forged visit cookie doesn't reveal anything either", forged.status === 200 && !leaked(forged), forged.data);
  const noAccents = await post("/api/checkin/identificar", { ...inside, name: "teste automatico flag", birthDate: birth });
  check("P0: a variation of the name doesn't reveal anything either", noAccents.status === 200 && !leaked(noAccents), noAccents.data);
  const wrongPhoto = await post("/api/checkin/confirmar", { token: attacker.data.token, photo: photo("person-b") });
  check("P0: with the attacker's token, another face is rejected without revealing the check-in (403)",
    wrongPhoto.status === 403 && wrongPhoto.data.code === "ROSTO_NAO_CONFERE" && !("photoUrl" in wrongPhoto.data) && !("checkedInAt" in wrongPhoto.data), wrongPhoto.data);
  const owner = await post("/api/checkin/identificar", { ...inside, name: reg.name, birthDate: birth }, { cookie: visitCookie });
  check("the device that checked in (visit session) sees the photo and time again", owner.data.alreadyCheckedIn === true && !!owner.data.photoUrl && !!owner.data.checkedInAt, owner.data);
  f = await post("/api/checkin/confirmar", { token, photo: photo("person-a-selfie") });
  check("a second check-in on the same day, with a matching face, is rejected (409) and shows the existing one", f.status === 409 && f.data.code === "DUPLICADO" && !!f.data.checkedInAt, f.data);

  // ---------- Later check-ins: creative photo ----------
  // Simulates "another Sunday": today's check-in moves to last week (the registration already has the reference photo).
  const { data: m } = await sb.from("members").select("id").eq("cpf", cpf).single();
  const lastWeek = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  await sb.from("checkins").update({ service_date: lastWeek }).eq("member_id", m.id);
  r = await post("/api/checkin/identificar", { ...inside, name: reg.name, birthDate: birth });
  check("a later check-in asks for a CREATIVE photo (no registration photo)", r.status === 200 && r.data.photoKind === "criativa", r.data);
  token = r.data.token;
  f = await post("/api/checkin/confirmar", { token, photo: photo("no-face") });
  check("creative photo with no face is rejected (422)", f.status === 422 && f.data.code === "SEM_ROSTO", f.data);
  f = await post("/api/checkin/confirmar", { token, photo: photo("person-b") });
  check("creative photo of ANOTHER person is rejected (403)", f.status === 403 && f.data.code === "ROSTO_NAO_CONFERE", f.data);
  f = await post("/api/checkin/confirmar", { token, photo: photo("two-people") });
  check("GROUP creative photo with the teen is accepted (200, not the first)", f.status === 200 && f.data.photoKind === "criativa" && f.data.isFirst === false, f.data);

  // ---------- Visitor ----------
  r = await post("/api/checkin/visitante", { ...inside, name: "Visitante Teste", phone: "123" });
  check("visitor with an invalid phone is rejected (400)", r.status === 400 && !!r.data.errors?.phone, r.data);
  r = await post("/api/checkin/visitante", { ...inside, name: "Visitante Teste Sem Foto", phone: visitorPhones[0] });
  check("visitor with only name and phone (200)", r.status === 200 && r.data.ok && !r.data.alreadyCheckedIn, r.data);
  r = await post("/api/checkin/visitante", { ...inside, name: "Visitante Teste Sem Foto", phone: visitorPhones[0] });
  check("repeat visitor on the same day → already checked in", r.status === 200 && r.data.alreadyCheckedIn === true, r.data);
  r = await post("/api/checkin/visitante", { ...inside, name: "Visitante Teste Com Foto", phone: visitorPhones[1], photo: photo("person-b") });
  check("visitor with an optional creative photo (200)", r.status === 200 && r.data.ok, r.data);
  if (!geoOff) {
    r = await post("/api/checkin/visitante", { ...outside, name: "Visitante Longe", phone: randomPhone() });
    check("visitor outside the venue (403)", r.status === 403, r.data);
  }

  // ---------- P1: individual leader accounts (password + authenticator app) ----------
  const noSession = await fetch(`${BASE}/api/pastor/feed`);
  check("leaders' feed without a session is blocked (401)", noSession.status === 401, noSession.status);
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
  const enrollCookie = r.cookie;
  check("P1: activation MANDATORILY leads to authenticator enrollment", r.status === 200 && r.data.stage === "cadastro_totp" && /httponly/i.test(r.setCookie), r.data);
  r = await req("POST", "/api/lider/ativar", { email: leaderEmails[0], setupCode: activationA, password: PASSWORD_A });
  check("P1: the activation code works only once", r.status === 401, r.status);
  r = await req("GET", "/api/pastor/feed", null, enrollCookie);
  check("P1: without an enrolled authenticator, no private data (401)", r.status === 401, r.status);
  const setupA = await req("GET", "/api/lider/autenticador", null, enrollCookie);
  check("P1: enrollment shows the authenticator QR code and key", setupA.status === 200 && setupA.data.qr?.startsWith("data:image/png") && setupA.data.uri?.startsWith("otpauth://totp/"), setupA.status);
  r = await req("POST", "/api/lider/autenticador", { code: "000000" }, enrollCookie);
  check("P1: a wrong code at authenticator enrollment is rejected", r.status === 400, r.data);
  const enrollCode = totp(setupA.data.secret);
  r = await req("POST", "/api/lider/autenticador", { code: enrollCode }, enrollCookie);
  const recoveryCodesA = r.data.recoveryCodes ?? [];
  let ckA = r.cookie;
  check("P1: authenticator enrolled → 10 recovery codes and a complete session", r.status === 200 && r.data.stage === "completa" && recoveryCodesA.length === 10, r.data);
  r = await req("GET", "/api/pastor/feed", null, enrollCookie);
  check("P1: the previous stage's cookie stops working (session rotated)", r.status === 401, r.status);

  // Normal login: password → code.
  r = await req("POST", "/api/lider/entrar", { email: leaderEmails[0], password: PASSWORD_A + "x" });
  check("P1: a wrong password is rejected (401)", r.status === 401, r.data);
  r = await req("POST", "/api/lider/entrar", { email: leaderEmails[0], password: PASSWORD_A });
  let passwordCookie = r.cookie;
  check("P1: the right password unlocks ONLY the code step", r.status === 200 && r.data.stage === "senha", r.data);
  r = await req("GET", "/api/pastor/feed", null, passwordCookie);
  check("P1: the password alone doesn't open the feed (401)", r.status === 401, r.status);
  r = await req("POST", "/api/lider/verificar", { code: enrollCode }, passwordCookie);
  check("P1: an authenticator code already used doesn't work again", r.status === 401, r.data);
  const next = totp(setupA.data.secret, 1);
  r = await req("POST", "/api/lider/verificar", { code: next }, passwordCookie);
  ckA = r.cookie;
  check("P1: password + authenticator code → full access", r.status === 200 && r.data.stage === "completa", r.data);
  r = await req("POST", "/api/lider/entrar", { email: leaderEmails[0], password: PASSWORD_A });
  r = await req("POST", "/api/lider/verificar", { code: next }, r.cookie);
  check("P1: the same code doesn't work for a second login", r.status === 401, r.status);

  // Attempt limits with SIMULTANEOUS requests (counter in the database, holds for any instance).
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
  const recoveryCookie = r.cookie;
  check("P1: a recovery code gets in and REQUIRES enrolling a new authenticator", r.status === 200 && r.data.stage === "cadastro_totp", r.data);
  r = await req("GET", "/api/pastor/feed", null, ckA);
  check("P1: using a recovery code ends the other sessions (the lost phone may be signed in)", r.status === 401, r.status);
  const setupA2 = await req("GET", "/api/lider/autenticador", null, recoveryCookie);
  r = await req("POST", "/api/lider/autenticador", { code: totp(setupA2.data.secret) }, recoveryCookie);
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
  check("P1: nobody deactivates their own account (403)", r.status === 403, r.data);
  r = await req("PATCH", "/api/lider/contas", { id: idC, action: "desativar" }, ckA);
  check("P1: deactivating ends the leader's open sessions", r.status === 200 && r.data.sessionsEnded >= 1, r.data);
  r = await req("GET", "/api/pastor/feed", null, ckC);
  check("P1: a deactivated leader loses access IMMEDIATELY (401)", r.status === 401, r.status);
  r = await req("GET", "/api/pastor/feed", null, ckA);
  check("P1: the other leaders stay signed in", r.status === 200, r.status);
  r = await req("GET", "/api/lider/contas", null, ckC);
  check("P1: a deactivated leader can't administer accounts (401)", r.status === 401, r.status);

  // A teen never becomes a leader.
  r = await req("GET", "/api/lider/contas", null, visitCookie);
  const r2v = await req("GET", "/api/pastor/feed", null, visitCookie);
  const r3v = await req("DELETE", "/api/pastor/checkins", { id: "x", reason: "teste de acesso" }, visitCookie);
  check("P1: the teen's visit session can't reach leader functions", r.status === 401 && r2v.status === 401 && r3v.status === 401, [r.status, r2v.status, r3v.status]);
  const pastorCookie = ckA; // leader A's current session (the previous one ended when they used the recovery code)

  const feed = await fetch(`${BASE}/api/pastor/feed`, { headers: { cookie: pastorCookie } }).then((x) => x.json());
  const mine = feed.items?.find((i) => i.name === reg.name);
  check("check-in shows up in the feed with the creative photo and the registration photo", !!mine?.selfieUrl && !!mine?.avatarUrl && mine.photoKind === "criativa", mine);
  const vis = feed.items?.filter((i) => i.isVisitor && i.name.startsWith("Visitante Teste")) ?? [];
  check("visitors show up in the feed marked as visitors", vis.length === 2, vis.length);
  const since = await fetch(`${BASE}/api/pastor/feed?since=${encodeURIComponent(feed.items?.[0]?.checkedInAt ?? "")}`, { headers: { cookie: pastorCookie } }).then((x) => x.json());
  check("incremental feed (since) doesn't repeat what was already seen", Array.isArray(since.items) && since.items.length === 0, since.items?.length);
  const dashNoSession = await fetch(`${BASE}/api/pastor/dashboard`);
  check("dashboard without a session is blocked (401)", dashNoSession.status === 401, dashNoSession.status);
  const dash = await fetch(`${BASE}/api/pastor/dashboard`, { headers: { cookie: pastorCookie } }).then((x) => x.json());
  const today = dash.trend?.at(-1);
  check("dashboard counts today's service (teen + 2 visitors)", today?.registered >= 1 && today?.visitors >= 2 && dash.kpis?.services >= 1, today);
  const rk = dash.ranking ?? [];
  const sorted = rk.every((r, i) => i === 0 || rk[i - 1].attendances >= r.attendances);
  const hasRoom = rk.length < 10;
  check("ranking sorted (up to 10) and with the test teen when there's room",
    sorted && rk.length <= 10 && (!hasRoom || rk.some((r) => r.name === reg.name)), rk.map((r) => [r.name, r.attendances]));

  const cpf2 = randomCpf();
  createdCpfs.push(cpf2);
  const r2 = await post("/api/cadastro", { ...reg, cpf: cpf2, name: "Teste Automático Pastor" }, { cookie: pastorCookie });
  check("a leader registers through the same form (200)", r2.status === 200, r2.data);

  const { data: att } = await sb.from("presencas").select("nome, tipo, tipo_foto").in("nome", [reg.name, "Visitante Teste Sem Foto"]);
  check("the presencas view shows the teen (creative) and the visitor", att?.some((p) => p.tipo === "cadastrado" && p.tipo_foto === "criativa") && att?.some((p) => p.tipo === "visitante"), att);

  // Attendance correction (with a reason) and audit trail.
  r = await req("DELETE", "/api/pastor/checkins", { id: mine?.id, reason: "" }, ckA);
  check("P1: attendance correction requires a reason (400)", r.status === 400, r.data);
  r = await req("DELETE", "/api/pastor/checkins", { id: mine?.id, reason: "teste automático: presença registrada por engano" }, ckA);
  const { data: stillThere } = await sb.from("checkins").select("id").eq("id", mine?.id ?? "").maybeSingle();
  check("P1: a leader removes an attendance recorded by mistake", r.status === 200 && !stillThere, r.data);

  const { data: trail } = await sb.from("admin_audit").select("id, actor_id, action, target_id, outcome, details").gte("at", t0).order("id");
  const has = (action, outcome, f = () => true) => (trail ?? []).some((a) => a.action === action && a.outcome === outcome && f(a));
  check("P1: the trail records activation, authenticator, login, recovery, creation and deactivation",
    has("conta_ativada", "ok", (a) => a.target_id === lA.id) && has("totp_cadastrado", "ok", (a) => a.actor_id === lA.id) &&
    has("login", "ok", (a) => a.actor_id === lA.id) && has("login", "negado") && has("login", "bloqueado") &&
    has("recuperacao_usada", "ok", (a) => a.actor_id === lA.id) && has("conta_criada", "ok", (a) => a.actor_id === lA.id && a.target_id === idC) &&
    has("conta_desativada", "ok", (a) => a.actor_id === lA.id && a.target_id === idC) && has("conta_desativada", "negado", (a) => a.target_id === lA.id),
    [...new Set((trail ?? []).map((a) => `${a.action}:${a.outcome}`))]);
  check("P1: attendance correction recorded with who, which and why",
    has("presenca_removida", "ok", (a) => a.actor_id === lA.id && a.target_id === mine?.id && /engano/.test(a.details?.motivo ?? "")));
  const trailText = JSON.stringify(trail);
  const secrets = [PASSWORD_A, enrollCode, next, ...recoveryCodesA, activationA, setupA.data.secret?.replace(/ /g, "")].filter(Boolean);
  check("P1: the trail contains no password, codes or authenticator key", !secrets.some((x) => trailText.includes(x)));
  const oneId = trail?.[0]?.id;
  const edit = await sb.from("admin_audit").update({ outcome: "ok", action: "adulterado" }).eq("id", oneId).select("id");
  const del = await sb.from("admin_audit").delete().eq("id", oneId).select("id");
  const { data: intact } = await sb.from("admin_audit").select("action").eq("id", oneId).maybeSingle();
  check("P1: the audit can't be edited or deleted, not even with the server key", !!edit.error && !!del.error && intact?.action === trail?.[0]?.action, { edit: edit.error?.message, del: del.error?.message });
  const delEv = await sb.from("audit_events").delete().gte("at", t0).select("id");
  check("P1: the check-in audit (P0) is insert-only too", !!delEv.error, delEv.error?.message);
} catch (e) {
  console.error("⚠️ ", e.message);
  failures++;
} finally {
  // Cleanup: test teens (check-ins cascade), test visitors and every photo.
  for (const doc of createdCpfs) {
    const { data: m } = await sb.from("members").select("id, photo_path").eq("cpf", doc).maybeSingle();
    if (!m) continue;
    const { data: cks } = await sb.from("checkins").select("photo_path").eq("member_id", m.id);
    await sb.storage.from("fotos").remove([m.photo_path, ...(cks ?? []).map((c) => c.photo_path)].filter(Boolean));
    await sb.from("members").delete().eq("id", m.id);
  }
  const { data: vcks } = await sb.from("checkins").select("id, photo_path").is("member_id", null).in("visitor_phone", visitorPhones);
  if (vcks?.length) {
    await sb.storage.from("fotos").remove(vcks.map((c) => c.photo_path).filter(Boolean));
    await sb.from("checkins").delete().in("id", vcks.map((c) => c.id));
  }
  // Test leaders (sessions and codes cascade). The audit trail stays: it's immutable.
  await sb.from("leaders").delete().in("email", leaderEmails);
  await sb.from("auth_rate_limits").delete().like("key", "%e2e.lider.%");
  await sb.from("auth_rate_limits").delete().gte("window_start", t0).or("key.like.entrar:ip:%,key.like.ativar:ip:%");
  console.log("🧹 test data removed");
}
console.log(failures ? `\n${failures} failure(s).` : "\nEverything works! 🎉");
process.exit(failures ? 1 : 0);
