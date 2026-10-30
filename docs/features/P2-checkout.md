# P2: Browser-based checkout

| | |
| --- | --- |
| **Priority** | P2 (leaving the service wasn't recorded) |
| **Requested by** | mentor code review ([issue #1](https://github.com/pedroeduardo36/flag-checkin/issues/1), item 5) |
| **Implemented on** | 2026-10-31 |

## How it works

No app to install and no background location tracking:

1. When the check-in completes (face matched, or a visitor check-in), the server stores the **visit session** on the
   phone: the `o2_visita` cookie, HMAC-signed, `httpOnly`, `SameSite=strict`, scoped to `/api/checkin` and valid for
   18 h. It holds the teen (or "visitor"), the **check-in** and the service day.
2. When it's time to leave, the **`/checkout`** page opens in three ways:
   - from the **"Estou indo embora"** ("I'm leaving") button on the success screen (which also shows when `/checkin` is
     reopened on the same phone);
   - from the **exit QR code**: [`/qrcode?tipo=saida`](https://flag-checkin.vercel.app/qrcode?tipo=saida), to print and
     stick on the door;
   - from an **NFC tag** at the door: write `https://flag-checkin.vercel.app/checkout` as a URL record on an NTAG213 or
     NTAG215 (any NFC writer app does it).
3. The page shows the name, the arrival time and **"Saída não registrada"** ("checkout not recorded"). One tap on
   **"Confirmar minha saída"** records the checkout. It doesn't ask for the name, birth date or photo again: the visit
   session is enough.

| Issue request | Implementation |
| --- | --- |
| Secure visit session after check-in | The `o2_visita` cookie now carries the check-in id (`cid`) and also works for visitors. Swapping the check-in in the cookie breaks the signature. A cookie for a check-in moved to another day doesn't work. Repeating a visitor's name and phone does **not** grant the session: knowing the phone number doesn't close someone else's visit |
| Open the checkout and confirm with one tap | `/checkout` with a single button. `GET /api/checkin/checkout` shows this phone's visit; `POST` confirms |
| Server time and who confirmed | `checked_out_at` is the server time at confirmation; `checkout_by` is `participante` (participant) or `lider` (leader, with `checkout_leader_id`) |
| Update the dashboard and notify the guardian | The live feed shows "Saída às 21:15" or "Saída não registrada" on each attendance, plus the day's checkout count. The incremental feed also picks up recorded or undone checkouts (`checkout_recorded_at`). The dashboard gained "Saída confirmada" for the latest service and a "Saídas" column. The guardian gets a text-only email with the time (`CHECKOUT_NOTICE=false` turns it off) |
| Leaders fix forgotten checkouts, with an audit trail | Feed → **Registrar saída** (record checkout: time + reason) or **Desfazer saída** (undo checkout: reason). Logged as `saida_registrada` and `saida_desfeita` in the action log, with the previous checkout. A leader can't overwrite an existing checkout: undo it first |
| "Checkout not recorded" until confirmed | Nothing records a checkout on its own: not closing the browser, not losing the connection, not the end of the service, not retention. Without confirmation, the app, the feed and the `presencas` view show "não registrada" |
| Attendance preserved; repeats don't duplicate | The checkout lives on the **same row** as the check-in, in its own columns. It's written with `update … where checked_out_at is null`: repeated or simultaneous confirmations record once and return the checkout that stands. The database refuses a checkout before the arrival (`checkins_checkout_valido`) |

### Location at checkout

It's **optional** and never blocks: the page only reads the position if the phone **already** granted permission (it
doesn't prompt again) and waits at most 5 s. The server stores only the distance to the church (`checkout_distance_m`),
as with check-in. Per the Geolocation specification, browsers don't provide positions in the background, so the app
**doesn't try** to reconstruct the actual departure time: the confirmation is what counts.

### Known limits

- The session lives in the browser used for check-in. Someone who opens the exit QR code in another browser (for
  example, the iPhone camera opens Safari while the check-in was in Chrome) sees "we couldn't find a check-in on this
  phone", with a hint to open it in the same browser or ask a leader.
- Borrowed phone: the success screen has "Fazer o check-in de outra pessoa neste celular" ("check in someone else on
  this phone"). The session then belongs to the last check-in on the device, and the first person's checkout is left to a leader.
- If a teen leaves and comes back, a leader undoes the checkout.

## Acceptance criteria

| Criterion | Where |
| --- | --- |
| Works in a phone browser, no app | `/checkout`, opened from the button, QR code or NFC. Checked at 375 px |
| Checkout tied to the visit session, with the confirmation time | `lib/server/visit.ts`, `lib/server/checkout.ts`, `app/api/checkin/checkout` |
| Forgotten or repeated checkouts handled safely | Leader corrections with a reason and an audit trail. Conditional write, no duplicates |

## Verification

- Unit tests: `tests/checkout.test.ts` (leader-entered time, service past midnight, checkout before arrival, future
  time), `tests/visit.test.ts` (session with the check-in, visitor, forged cookie, old cookie),
  `tests/email.test.ts` (text-only checkout notice, can be turned off) and `tests/stats.test.ts` (checkouts per service).
- End-to-end test (`npm run test:e2e`), covering:
  - missing, forged or other-day sessions rejected;
  - one-tap checkout with the server time;
  - three simultaneous confirmations recording only one, with the attendance intact;
  - visitors with and without a session;
  - guardian notice;
  - feed, incremental feed and dashboard;
  - leader corrections: mandatory reason, no overwrite, undo, future time and record;
  - the teen's session can't correct;
  - the `presencas` view and the audit trail.

## Deployment

1. Apply `20261031000000_checkout.sql`. It only adds columns, a constraint and an index, and recreates the `presencas`
   view with the checkout.
2. Ship the code (merge the PR).
3. Print the exit QR code from `/qrcode?tipo=saida` and/or write the door NFC tags.
4. Optional: `CHECKOUT_NOTICE=false` on Vercel to skip the checkout notice.
