# P1: Privacy rules and data minimization

| | |
| --- | --- |
| **Severity** | P1 (minors' biometrics without a clear explanation, unverified guardian email, no retention periods) |
| **Reported by** | mentor code review ([issue #1](https://github.com/pedroeduardo36/flag-checkin/issues/1), item 4) |
| **Implemented on** | 2026-10-30 |

Documents:

- [Data inventory](data-inventory.md): every piece of data collected, its purpose, the proposed legal basis and the retention period.
- [Family requests](family-requests.md): owner, channel, deadline and step-by-step for access, correction, erasure and
  consent withdrawal.
- [Operations and incidents](operations-and-incidents.md): vendors, who can access what, incident response and pending
  manual tasks.
- [Legal review](legal-review.md): the questions for the lawyer (LGPD, ECA, ECA Digital — Brazil's data protection law,
  Child and Adolescent Statute and its digital counterpart).
- Public page [`/privacidade`](../../app/privacidade/page.tsx): the explanation for families and teens (in Portuguese).

## What changed in the app

| Issue request | Implementation |
| --- | --- |
| Legal review | Outside the code. The list of questions is in [legal-review.md](legal-review.md); the final decision depends on it |
| Explain biometrics, photos, recipients, retention and contacts | A plain-language `/privacidade` page, with a section for the teen. On the form: a box explaining face recognition and **two separate consents**, the general one and the **biometric-specific** one (LGPD art. 11). At the registration photo step, a sentence for the teen. A link to `/privacidade` in every page footer |
| Verify the email and guardianship | A registration only counts after the **email owner** opens the link (single use, 7 days, only the hash is stored), reads the explanation and ticks both consents. Until then: no check-in (403 `CADASTRO_PENDENTE`) and no notices. Without confirmation within 7 days, the registration is deleted. The second email confirms too, and only then gets notices. See question 6 of the legal review about the limits of this |
| Legacy registrations | They have until **2026-11-30** to confirm with the new text. `npm run verification:send` sends the link. Check-in keeps working until then; afterwards, unconfirmed ones are deleted |
| Retention and erasure | `public.expurgar_dados()` applies the inventory's periods, runs daily (Vercel Cron) and has a dry-run mode. The audit trail stays immutable for the app; only the purge, and only for expired entries, can delete from it |
| Family requests | Leaders tab → **Cadastros e pedidos das famílias**: search, export (JSON), resend confirmation, withdraw biometrics and delete (with a reason). The guardian can also decline through the link. Everything is logged |
| Text-only notices; group photos | The check-in notice no longer carries a photo. The creative photo, which may show other teens, stays in the app, for leaders only, and is deleted after 30 days |
| Vendors, access and incidents | [operations-and-incidents.md](operations-and-incidents.md). Vercel functions now run in São Paulo (`gru1`) |
| Precise coordinates | Check-in and audit store only the **distance** to the church. Old coordinates are cleared on the first purge. Visitor photos no longer carry the phone number in the file name |

## Acceptance criteria

| Criterion | Where |
| --- | --- |
| Every piece of data has a documented purpose and retention period | [data-inventory.md](data-inventory.md), enforced by `expurgar_dados()` |
| Requests have an owner and a working process | [family-requests.md](family-requests.md) and the Leaders tab, covered by the end-to-end test. **The data protection officer still needs to be named** |
| Families get an accurate explanation of face recognition and photo sharing | `/privacidade`, the form and the confirmation page, which collect the specific consent |

## Verification

- Unit tests: `tests/guardian.test.ts` (check-in only with consent, transition period, notices only to confirmed
  emails, link hash) and `tests/email.test.ts` (notice without a photo, confirmation email).
- End-to-end test:
  - registration without biometric consent rejected and check-in blocked before confirmation;
  - a made-up link, single use and requiring biometric consent;
  - consent stored, and check-in and audit without coordinates;
  - visitor photo without the phone number in the name;
  - export without the face numbers, biometric withdrawal (which blocks check-in), resend, deletion with a reason and refusal by the guardian;
  - retention dry run, which changes nothing;
  - cron without the secret rejected, and the `/privacidade` page;
  - every action logged.

## Deployment

1. Apply `20261030000000_privacidade.sql`. It only adds columns, a table and functions, and deletes nothing. Legacy
   registrations get until 2026-11-30.
2. Ship the code (merge the PR).
3. Add `CRON_SECRET` on Vercel (and `PRIVACY_EMAIL` if you want another contact).
4. `npm run retention`: dry run and check the numbers. Then `npm run retention -- --apply` (or wait for the cron).
5. `npm run verification:send` for a dry run and `-- --send` to ask the guardians of legacy registrations to confirm.
6. Manual tasks in [operations-and-incidents.md](operations-and-incidents.md#pending-tasks).
