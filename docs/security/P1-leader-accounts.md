# P1: Leader login and admin action audit

| | |
| --- | --- |
| **Severity** | P1 (access to minors' photos and attendance protected by a single shared password) |
| **Reported by** | mentor code review, 2026-10-27 |
| **Fixed on** | 2026-10-27 |
| **Affected** | `POST /api/pastor/sessao`, `lib/server/pastor.ts` and everything depending on that session (feed and dashboard) |

## The problem

- **One password for every leader** (`PASTOR_PASSWORD`). There was no way to tell who signed in, revoke one person's
  access without changing everyone's password, or require a second factor.
- **Stateless session:** the cookie was `expiry.signature`. No session could be ended before it expired (12 h): not
  that of a leader who left the team, nor that of a lost phone.
- **Brute force:** only a 0.8 s delay per wrong password. Parallel requests, or requests hitting different server
  instances, didn't wait for each other.
- **No record** of who did what.

## What changed

### Only two kinds of access

| Access | How it proves who it is | What it reaches |
| --- | --- | --- |
| **Teen** | Visit session (`o2_visita` cookie, issued after the face match; no password) | Only their own check-in for the day, and only on `/api/checkin` |
| **Leader** | Individual account: password + authenticator app code | Feed, dashboard, registration, account administration, attendance correction, action log |

There's no hierarchy among leaders: all of them administer. To avoid dangerous self-service, **deactivate** and
**reset access** only apply to **another** leader's account.

### Two-step login, mandatory authenticator

1. **Email + password** (scrypt, per-account salt). The right password unlocks **only** the code step (10-minute session).
2. **6-digit authenticator app code** (TOTP, RFC 6238). Only then does the session become `completa` (complete), and
   only a complete session reads private data.

- **Authenticator enrollment before any data.** A new or reset account starts with an **activation code** (single use,
  24 h) issued by another leader. The person sets their own password and enrolls the authenticator in the same session.
  The right password without an enrolled authenticator doesn't get in.
- **No SMS or email fallback.**
- The authenticator secret is **encrypted** (AES-256-GCM, key derived from `CHECKIN_SECRET` via HKDF). The last
  accepted step is stored: **the same code never works twice**, not even for a second login.
- Every stage change issues a new cookie, and the previous one is ended in the database.

> **On the strength of this method:** an authenticator app code is the **practical minimum** chosen for this app (small
> group, no cost, works on any phone). It is **not** the strongest method available: someone can be tricked into typing
> the code on a fake site. **Passkeys and security keys (FIDO2/WebAuthn)** resist phishing and are the recommended next
> step ([CISA guidance](https://www.cisa.gov/sites/default/files/2023-01/fact-sheet-implementing-phishing-resistant-mfa-508c.pdf)).

### Recovery

- **Activation code:** 12 characters (60 bits), single use, 24 h, rate limited. Stored as an unkeyed SHA-256 so the
  `leader:create` script, which runs outside Vercel, can issue codes production accepts.
- **Recovery codes:** 10 per leader, shown only once, with only the HMAC stored. Each works **once** (conditional update
  on `used_at is null`). Using one means "I lost my phone": the old authenticator is deleted, **the account's other
  sessions end** and a new authenticator is enrolled right away, with 10 new codes.
- **Without codes (controlled process):** **another leader** confirms who they are in person and uses **Redefinir
  acesso** (reset access). Password, authenticator and codes are deleted, sessions end and a 24 h activation code is
  issued and handed over in person. Nobody resets their own account, and everything is in the action log.

### Attempt limits that hold in parallel and across instances

The counter lives in Postgres (`auth_rate_hit`): `insert … on conflict do update … returning hits` locks the row, so
simultaneous requests and different serverless functions count correctly. The attempt is counted **before** checking.

| What | Limit |
| --- | --- |
| Password, per account | 8 every 15 min |
| Password, per network (IP as an HMAC) | 30 every 15 min |
| Authenticator or recovery code, per account | 5 every 15 min and 20 per day (exceeding it also ends the stage) |
| Activation code | 5 per account and 20 per network every 15 min |

The per-account counter can be used to **disrupt** a leader's login for 15 min (not to get in). With few leaders, the
trade-off is worth it; if it becomes a problem, the next step is passkeys, which have no secret to guess.

### Administration and immediate revocation

**Líderes** tab: create an account, deactivate, reactivate (always with a new activation code), reset access, end
sessions (another leader's, or "sign out of other devices" on your own account) and issue new recovery codes
(requires the current authenticator code). Sessions live in the database, so **deactivating ends that leader's
sessions on the next request**, without affecting the others.

### Action log (`admin_audit`)

- **What goes in:** login (ok, denied, blocked), logout, account created, activated, deactivated and reactivated,
  access reset, sessions ended, authenticator enrolled, recovery code used, new codes issued and **attendance
  correction** (a leader removes a check-in made by mistake, with a mandatory reason).
- **Fields per entry:** who acted, the affected account or record, when, action, outcome and details.
- **Protection:** a Postgres trigger refuses `UPDATE`, `DELETE` and `TRUNCATE`, and the privilege was revoked from
  `service_role` too. Not even the app server can edit or delete entries. The same protection applies to
  `audit_events`, the check-in trail created for P0.
- **What never goes in:** passwords, authenticator codes, recovery or activation codes, the authenticator key and
  biometric data. The IP only goes in as an HMAC.

## Verification

| Acceptance criterion | Test |
| --- | --- |
| Every leader goes through the authenticator app | Activation mandatorily leads to authenticator enrollment; the password alone doesn't open the feed (401); a session without an authenticator reads nothing (401); the right password without an enrolled authenticator doesn't get in |
| Deactivating ends only that leader's sessions | Leader C signs in; A deactivates C; C's feed returns 401 immediately and A's stays 200 |
| Admin actions leave a trail | The trail has activation, authenticator, login ok/denied/blocked, recovery, creation, deactivation (and the denied attempt to deactivate oneself) and attendance correction with a reason |
| A teen session can't reach leader functions | A valid `o2_visita` cookie gets 401 on accounts, feed and attendance correction (e2e and unit test) |
| Protected audit without secrets | `update` and `delete` with the server key fail; the trail text contains no password, codes or key |
| The limit holds in parallel | 14 simultaneous logins: at most 8 checked, the rest 429; 8 simultaneous codes: at most 5 checked |
| Codes don't repeat | The enrollment code doesn't work for login, nor the login code for a second login |

New unit tests: TOTP against the **official RFC 6238 vectors**, scrypt, password rules, tampered encryption or another
key, code format and hashing, and sessions (only `completa` unlocks; revoked, expired or deactivated ones are rejected;
a teen cookie and the old `o2_pastor` cookie don't even query the database).

## Deployment

1. Apply the `20261028000000_contas_lideres.sql` migration.
2. Ship the code. From then on, the shared password stops working.
3. `npm run leader:create -- "Name" email` for the first leader. The others are created from the Leaders tab.
4. Remove `PASTOR_PASSWORD` from Vercel and `.env.local`.
