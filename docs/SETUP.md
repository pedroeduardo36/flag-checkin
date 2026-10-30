# Setup and operations guide

> **Current flow:** the guardian registers the teen at `/cadastro`, with no photo or password. At church, the teen checks
> in with their full name and birth date. The first check-in takes the registration photo, which must contain a single
> face; later ones take the creative photo during the service. Visitors only give a name and phone number.

A web app (it opens in the phone's browser, with nothing to install) for teens to check in when they arrive at the service.

```
Before the service ──► /cadastro (filled in by the GUARDIAN)
   Teen's details (name, birth date, CPF, optional phone) +
   guardian's details (name, phone, email and an optional second email) + LGPD consent. No photo, no password.

QR code / NFC tag ──► /checkin
   1. Location  → checks that the phone is inside the church radius
   2. "Tenho cadastro" (registered): full name + birth date   |   "Sou visitante" (visitor): name + phone (+ optional photo)
   3. First check-in: REGISTRATION photo (1 face, becomes the registration photo) → explanation → CREATIVE photo
      Later ones: explanation → CREATIVE photo during the service (friends are fine; one face must be the teen's)
   4. Success screen + email to the guardian with the time and photo
```

## Stack

| Part | Choice | Why |
| --- | --- | --- |
| Frontend + API | **Next.js 15** (React 19, API routes) | a single project, free on Vercel |
| Database | **Supabase** (Postgres) | free, includes photo storage and a dashboard to browse attendance |
| Photos | Supabase Storage, **private** bucket | photos of minors are never public |
| Hosting | **Vercel** (free Hobby plan) | automatic HTTPS — camera and GPS require HTTPS |

### Free databases considered

| Provider | Free plan | Notes |
| --- | --- | --- |
| **Supabase** ✅ chosen | 500 MB Postgres + 1 GB of files | database **and** photos in one place; the project pauses after 7 idle days (opening the dashboard wakes it up) |
| Neon | 0.5 GB Postgres | great Postgres, but photos would need another service |
| Firebase (Firestore + Storage) | 1 GiB Firestore; Storage requires the Blaze plan | NoSQL; photo storage needs a card on file |
| Turso | distributed SQLite, 5 GB | no file storage |
| MongoDB Atlas | 512 MB | NoSQL, no file storage |

Estimate: 200 teens × 52 services × ~80 KB per selfie ≈ 830 MB/year of photos. Delete old selfies
(e.g. older than 6 months) to stay on the free plan — see "Maintenance".

## Going live, step by step

### 1. Supabase
> ✅ Done: project **flag-checkin** (ref `kcmlgoffvympjalsrwdn`, São Paulo), migrations applied and `.env.local` filled in.
> Dashboard: <https://supabase.com/dashboard/project/kcmlgoffvympjalsrwdn>

1. Create an account at <https://supabase.com> → **New project** (region *South America (São Paulo)*).
2. Apply the schema in **one** of these ways:
   - **CLI (recommended):** `npx supabase login` → `npx supabase link --project-ref YOUR_REF` → `npm run db:push`
   - **Manual:** SQL Editor → New query → paste each file in [`supabase/migrations/`](../supabase/migrations/), in order → Run.
3. **Project Settings → API**: copy the *Project URL* and the **service_role** key.

### 2. Environment variables
Copy `.env.example` to `.env.local` and fill it in:

| Variable | What it is |
| --- | --- |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | from the previous step (service_role on the server **only**) |
| `CHURCH_LAT` / `CHURCH_LNG` | church coordinates — in Google Maps, right-click the building and copy them |
| `CHURCH_RADIUS_METERS` | accepted radius; start with **150** (indoor GPS is off by 20–60 m) |
| `FACE_MATCH_THRESHOLD` | optional, default `0.65`. Maximum distance between a face in the creative photo and the registration photo. Lower = stricter; if teens get rejected, try `0.7` |
| `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASS` `EMAIL_FROM` | the email sent to the guardian at every check-in (see "Guardian email" below). Without them check-in still works and the notice is recorded as `sem_config` |
| `GEOFENCE_DISABLED` | `true` = **test mode**: skips the location check (check in from anywhere, with a yellow warning on screen). Keep it `false` for real services |
| `CHECKIN_SECRET` | generate with `openssl rand -hex 32`. It also encrypts the leaders' authenticator secret: **changing it forces every leader to re-enroll their authenticator** (access reset) |
| `PUBLIC_APP_URL` | the app's final address (used by the QR code) |

### 3. Run it locally
```bash
npm install
npm run dev
```
Open <http://localhost:3000>. Check the integration:

- <http://localhost:3000/api/health> should return `"ok": true` (variables, tables, view and bucket).
- `npm run test:e2e` runs a test registration and check-in against the real database and deletes everything at the end.

To test on a phone, use the Vercel HTTPS address (camera and GPS don't work over `http://` outside localhost).

### 4. Deploy to Vercel
1. Push the folder to a GitHub repository.
2. At <https://vercel.com> → **Add New → Project** → import the repository.
3. Under **Environment Variables**, add the same variables as `.env.local`.
4. **Deploy**. Update `PUBLIC_APP_URL` with the generated address (or your domain).

### 5. QR codes and NFC
**QR codes**

The app generates them: open **https://flag-checkin.vercel.app/qrcode** to print or download PNG/SVG
(direct images: `/api/qrcode` · `/api/qrcode?format=svg`). To generate it locally:
```bash
npm run qrcode -- https://YOUR-APP.vercel.app
```
It creates `qrcode-checkin.png` (print) and `qrcode-checkin.svg` (print shop/banner), pointing to `/checkin`.

**NFC tags** (buy NTAG213 or NTAG215 — stickers or key fobs, a few cents each)
1. Install the free **NFC Tools** app (Android or iPhone).
2. *Write → Add a record → URL/URI* → `https://YOUR-APP.vercel.app/checkin`.
3. *Write* and hold the tag to the phone. Optional: *Other → Lock tag* so nobody can rewrite it.
4. The teen holds their phone to the tag (on iPhone, the top of the device) and the link opens on its own.

## Guardian email

At every check-in, the guardian gets an email with the **time** and the **check-in photo** (see
[the preview](previa-email-checkin.html)). Pick **one** free SMTP provider:

| Provider | Free limit | Needs your own domain? | Settings |
| --- | --- | --- | --- |
| **Gmail** (recommended to start) | ~500 emails/day | no | `smtp.gmail.com` · port `465` · user = the Gmail address · password = an **app password** |
| Brevo | 300/day | no (verifies the sender) | `smtp-relay.brevo.com` · `587` · SMTP login and key from the dashboard |
| Resend | 3,000/month | **yes**, to send to anyone | `smtp.resend.com` · `465` · user `resend` · password = API key |

**Gmail, step by step** (ideally a ministry account, e.g. `checkin.o2flag@gmail.com`):
1. Turn on **2-Step Verification** on the Google account.
2. Open <https://myaccount.google.com/apppasswords>, create an app password named "Check-in O2" and copy the 16 letters.
3. Fill in `.env.local` **and** Vercel (Settings › Environment Variables):
   `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_USER=<the gmail>`, `SMTP_PASS=<app password>`,
   `EMAIL_FROM="Check-in O2 Flag <the gmail>"`.
4. Redeploy (Deployments › Redeploy).

Each notice's status shows in the `aviso_responsavel` column of the `presencas` view.

**Batch registration confirmation** (for teens registered before the confirmation email existed):
`npm run email:confirmation` is a dry run that shows how many emails would go out; `npm run email:confirmation -- --send`
sends one per teen, 1.5 s apart. The log goes to `logs/confirmacao-cadastro.json` (git-ignored): running it again skips
whoever already got one.

## Pastor area

Each leader has their own account: **email + password + authenticator app code** (Google Authenticator, Microsoft
Authenticator, 1Password…). The session lasts 12 h on the device. There's no shared password.

**First leader** (once, on the computer with `.env.local`):
```bash
npm run leader:create -- "First Last" email@example.com
```
The command prints an **activation code** (single use, 24 h). The person opens **https://flag-checkin.vercel.app/pastor →
Ativar conta**, enters their email and the code, creates a password, scans the QR code with the authenticator app and
saves the **10 recovery codes**. Other leaders are created the same way from the **Líderes** tab.

**Lost phone:** on the code screen, "Perdi o celular" accepts a recovery code (each works once; the other sessions end
and a new authenticator is enrolled right away). Without codes, **another leader** confirms who they are in person and
uses **Redefinir acesso** on the Líderes tab: a new activation code is issued and handed over in person.

- **Leaders:** create accounts, deactivate (that person's sessions end immediately), reactivate, reset access, end
  sessions, issue new recovery codes and the **action log** (read-only).
- **Live:** who checked in today, newest first, refreshing on its own every 4 s.
- **Dashboard:** services, average per service, latest service vs. the previous one, the attendance
  chart per service (registered teens and visitors) and the top-10 ranking. "↻ Atualizar" reloads the numbers.
- **Register:** the guardian's registration form, for registering several teens in a row.

To see the dashboard with data: `node scripts/simulate-dashboard.mjs` creates 8 simulated Sundays (teens and visitors
prefixed "Simulação"); `node scripts/simulate-dashboard.mjs --clean` deletes them afterwards.

To see the feed working with nobody at church: `npm run simulate` (and `node scripts/simulate-checkins.mjs --clean`
to delete the simulated registrations afterwards).

## Viewing attendance
In Supabase: **Table Editor → `presencas`** (list per service, with time, guardian and distance). To see a
photo, open **Storage → fotos** and the path in the `foto_checkin` or `foto_cadastro` column. The dashboard can export CSV.

## Security and LGPD
- RLS on and no public policies: the browser never talks to the database directly, only to the `/api` routes.
- Photos live in a private bucket; when the app needs to show one, it generates a temporary link (10 min).
- An unknown name and a wrong date get the **same** message, so nobody can find out who is registered.
- The token between identification and photo is signed (HMAC) and valid for 4 h (the creative photo is taken during the
  service); one check-in per person per day, and one per visitor phone per day.
- Registration is open (no password), with a unique CPF, server-side validation and a hidden field against bots.
- Registration requires ticking the guardian's consent (minors' data — LGPD art. 14); the date is stored.
- **Known limits:** phone GPS can be spoofed with "fake GPS" apps — which is why there's a photo with face recognition,
  which leaders can also check in the pastor feed. The identification routes have no per-IP limit; if needed, add
  Upstash Ratelimit (free) to `/api/checkin/identificar` and `/api/cadastro`.

## Maintenance
Delete check-in selfies older than 6 months (SQL Editor):
```sql
delete from storage.objects
where bucket_id = 'fotos' and name like 'checkins/%' and created_at < now() - interval '6 months';
```

## Structure
```
app/checkin/page.tsx              check-in flow (location → name and birth date or visitor → photo → success)
app/cadastro/page.tsx             registration by the guardian (no photo, no password)
app/api/checkin/local             checks the location
app/api/checkin/identificar       checks name + birth date, issues the token
app/api/checkin/confirmar         registration (first) or creative photo → stores the check-in
app/api/cadastro                  stores a new teen
components/Brand.tsx              Flag header (prominent) + Juventude O2
components/Camera.tsx             live front camera with a fallback
lib/format.ts                     CPF, phone, dates, distance (haversine)
lib/server/*                      Supabase, variables, tokens and validation (server only)
supabase/migrations/              tables, attendance view and bucket
app/api/health                    Supabase connection diagnostics
scripts/e2e-flow.mjs              end-to-end test against the real database
scripts/generate-qrcode.mjs       generates the QR code
```

## O2 youth group logo
The Flag logo lives at `public/brand/flag-logo.jpg` (it already includes a small "O2"). The Instagram link for the O2
logo is a post that can't be downloaded automatically: save the image as `public/brand/o2-logo.png` if you want to use
it somewhere. To swap the Flag logo for a larger or transparent version, replace the file and keep the name.
