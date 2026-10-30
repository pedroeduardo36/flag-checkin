# Data inventory: purpose and retention

Every piece of data the app collects, what it's for and when it goes away. The periods are enforced by
`public.expurgar_dados()`, which runs daily at 03:00 Brasília time (Vercel Cron → `/api/cron/retencao`). The same
numbers are shown to families on [`/privacidade`](../../app/privacidade/page.tsx) and live in
[`lib/privacy.ts`](../../lib/privacy.ts). Change a period, change all three.

The **legal basis** column is our proposed hypothesis. The legal review ([legal-review.md](legal-review.md)) confirms it.

## Teen registration (`members`)

| Data | Purpose | Proposed legal basis | Retention |
| --- | --- | --- | --- |
| `name`, `birth_date` | Find the registration at check-in (name + birth date) and avoid duplicates | Guardian consent (LGPD art. 14, §1) | While the registration exists |
| `phone` (optional) | Contacting the teen | Consent | While the registration exists |
| `guardian_name`, `guardian_phone` | Identifying and contacting the guardian | Consent | While the registration exists |
| `guardian_email`, `guardian_email2` | Registration confirmation, check-in notices and handling requests | Consent | While the registration exists. The second email is removed if its recipient declines the link |
| `guardian_consent_at`, `biometric_consent_at`, `consent_version`, `guardian_email*_verified_at` | Proving when, and under which text version, the email owner consented | Legal obligation (art. 8, §2: the burden of proof is on the controller) | While the registration exists |
| `verify_by` | Confirmation deadline | Same as the registration | Until confirmation |
| `photo_path` (registration photo) | Reference for face recognition | **Specific and prominent consent** (art. 11, I, and art. 14, §1) | While the registration exists, or until the guardian withdraws biometrics |
| `face_descriptor` (128 numbers) | Checking that the person checking in is the teen | **Specific and prominent consent** | Same as the registration photo |
| `possible_duplicate_of` | A leader's duplicate review | Controller's legitimate interest in data quality (to be validated) | Until reviewed |
| `created_at` | Retention periods | Same as the registration | While the registration exists |

**The whole registration is deleted** (data, registration photo, descriptor, attendances and check-in photos):

- if the guardian doesn't confirm within **7 days**. For registrations older than this version, the deadline is **2026-11-30**;
- when the teen has gone **12 months** without any attendance;
- when the guardian asks, or declines through the link.

## Attendance (`checkins`)

| Data | Purpose | Retention |
| --- | --- | --- |
| `member_id`, `service_date`, `checked_in_at`, `is_first` | Attendance tracking, the leaders' feed and dashboard | While the registration exists |
| `distance_m`, `accuracy_m` | Proving the check-in happened at the venue (geofence) | While the registration exists |
| `latitude`, `longitude` | **No longer stored.** Old values are cleared on the first purge | — |
| `photo_path` (creative photo), `photo_kind` | Showing leaders who arrived. May show other teens | **Photo: 30 days.** The attendance record stays |
| `face_distance` | Auditing the face match (just a number, not biometric data) | While the registration exists |
| `user_agent` | Investigating abuse | 30 days |
| `guardian_email_status`, `guardian_email_at` | Knowing whether the notice was delivered | While the registration exists |
| Visitor: `visitor_name`, `visitor_phone`, optional photo | Recording the visit | **180 days** |

## Technical logs

| Table | Contents | Retention |
| --- | --- | --- |
| `audit_events` | Check-in attempts: outcome, registration, IP as an HMAC, browser and **distance** (no coordinates anymore) | **90 days** |
| `admin_audit` | Leader actions, consents, exports and deletions. Stores no teen name, password, code or biometrics | **2 years** |
| `guardian_verifications` | Confirmation link hash, email, expiry | 30 days after being used or expiring |
| `auth_rate_limits` | Attempt counters (key with the leader's email or the IP as an HMAC) | 1 day |
| `leaders`, `leader_recovery_codes` | Leader account: name, email, password hash (scrypt), encrypted TOTP secret | While active. **Deactivated: 2 years** |
| `leader_sessions` | Leader sessions (token hash, browser) | 30 days after expiring or being revoked |

## Outside the database

| Where | What's there | Retention / action |
| --- | --- | --- |
| `fotos` Storage bucket (Supabase) | Registration and check-in photos | Removed together with the database row (the purge returns the paths and the server deletes them) |
| **Supabase backups** | Daily database copy | Plan window: none on Free, 7 days on Pro, 14 on Team, up to 30 on Enterprise. Never restore a backup without running `npm run retention -- --apply` right after |
| Sent folder of the sending Gmail (`EMAIL_FROM`) | A copy of every email sent. **Old notices had the photo attached** | Delete the old notices with photos (see [operations-and-incidents.md](operations-and-incidents.md#pending-tasks)). From now on, notices are text only. Keep the sent folder for at most 30 days |
| Guardians' inboxes | Notices received | Outside our control. That's why new notices carry no photo |
| Vercel logs | Requests (no body) | Expire on their own (Hobby: about 1 hour; Pro: 1 day) |
| `logs/` on the machine running scripts | Results of batch sends | `logs/verificacao.json` stores only ids. The old `logs/confirmacao-cadastro.json` had emails: delete it |
| File exported by a leader | A registration's data, to answer an access request | Send it only to the guardian and delete the local copy right after |
