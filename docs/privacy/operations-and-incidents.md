# Operations: vendors, access and incidents

## Vendors (processors)

| Vendor | What it does | Data passing through it | Where | Reference |
| --- | --- | --- | --- | --- |
| **Supabase** | Database (Postgres) and photo storage | All app data | São Paulo (`sa-east-1`), project `kcmlgoffvympjalsrwdn`. Encryption at rest and TLS | [supabase.com/security](https://supabase.com/security) |
| **Vercel** | Hosts the site and the `/api` routes (where faces are compared) | All data in transit. Doesn't store the data, only short request logs | Functions in **São Paulo** (`gru1`, pinned in `vercel.json`; previously the default was Washington, `iad1`) | [vercel.com/docs/security/compliance](https://vercel.com/docs/security/compliance) |
| **Google (Gmail, SMTP)** | Sends the registration confirmation and the check-in/checkout notices | Teen's name, guardian's name and email, time. The sent folder keeps a copy | Google's global infrastructure (international transfer, LGPD art. 33) | Google Workspace/Gmail terms |
| **GitHub** | Source code | No personal data about teens. Tests use only synthetic faces | — | — |

No data is sold or shared with third parties beyond these. Face recognition runs on our own server with an open-source
library (`@vladmandic/face-api`), with no external recognition service.

## Who has access

| Access | Who | How it's protected |
| --- | --- | --- |
| App (`/pastor`) | O2 leaders, each with their own account | Mandatory password and authenticator app (TOTP), revocable sessions, action log. See [P1-leader-accounts.md](../security/P1-leader-accounts.md) |
| Supabase dashboard (raw data, photos, backups) | Only the technical administrator (currently Pedro Vilarinho) | Personal account with 2FA (check that it's on). **The `service_role` key grants full access** and lives only on Vercel and in `.env.local` |
| Vercel dashboard (environment variables, logs) | Only the technical administrator | Personal account with 2FA (check that it's on) |
| Gmail account that sends the emails | Technical administrator | App password (`SMTP_PASS`) and 2FA on the Google account |
| GitHub repository | Technical administrator and reviewers | No committed secrets. A secret scan before every commit |

Review this list every 6 months and whenever someone leaves the leadership: deactivate their leader account (Leaders
tab) and, if they had technical access, rotate `SUPABASE_SERVICE_ROLE_KEY`, `CHECKIN_SECRET` and `SMTP_PASS`.

## Incidents

An incident is any unauthorized access, leak, loss or change of personal data. For example: a leaked key, a lost leader
phone with an open session, an email sent to the wrong guardian, an exposed photo.

1. **Contain (immediately).** End sessions and deactivate leader accounts from the Leaders tab. If a key leaked, rotate it
   on Vercel and Supabase. Changing `CHECKIN_SECRET` invalidates every check-in token, visit cookie and TOTP secret
   (leaders re-enroll their authenticator). Take an affected route offline if needed.
2. **Assess (within 24 h).** What leaked, how many people, since when. Sources: `admin_audit` (leader actions),
   `audit_events` (check-in attempts, 90 days), Vercel and Supabase logs.
3. **Notify (within 3 business days).** If the incident may cause relevant risk or harm — and with teens' data and
   biometrics the presumption is that it does — notify the **ANPD** (Brazil's data protection authority) and the
   **affected families**, following the Security Incident Reporting Regulation (CD/ANPD Resolution No. 15/2024). The
   notice says what happened, which data, the risks, what was done and the contact.
4. **Record.** Keep the incident record (what, when, decisions, notices) for at least 5 years, even if it wasn't reported.
5. **Fix and review.** Open a PR with the fix and a report in `docs/security/`, as with the P0 and P1 items.

Contacts: the privacy process owner ([family-requests.md](family-requests.md)) and the technical administrator.

## Pending tasks

Manual and outside the code, tied to this item:

- [ ] Appoint the **data protection officer** (name and privacy email) and set `PRIVACY_OWNER` and `PRIVACY_EMAIL`.
- [ ] **Legal review** ([legal-review.md](legal-review.md)).
- [ ] In the sending Gmail account: delete the check-in notices already sent **with a photo** (search
      `in:sent has:attachment "chegou ao culto"`) and empty the trash. Afterwards, keep the sent folder for at most 30 days.
- [ ] Delete `logs/confirmacao-cadastro.json` from the machine that ran the batch send (it contains guardians' emails).
- [ ] Check the Supabase plan and backup window in the dashboard, and write them down here.
- [ ] Add `CRON_SECRET` on Vercel. Without it, the daily cleanup doesn't run.
