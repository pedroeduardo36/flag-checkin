# P0 — Public access to attendance photos and times

| | |
| --- | --- |
| **Severity** | P0 (minors' personal data exposed without authentication) |
| **Reported by** | mentor code review, 2026-10-27 |
| **Fixed on** | 2026-10-27 |
| **Affected route** | `POST /api/checkin/identificar` |

## The problem

The public identification route takes **full name + birth date + coordinates**. When the teen **had already checked
in that day**, it returned:

```json
{ "alreadyCheckedIn": true, "name": "…", "checkedInAt": "2026-10-23T22:47:00Z", "photoUrl": "https://…/object/sign/fotos/…?token=…" }
```

- **No leader login** and **no face match**.
- The only barrier was the geofence, but the **coordinates come from the phone itself** and can be faked.
- Name and birth date aren't secrets: classmates, relatives and social media know them.

**In practice:** anyone who knew the name and birth date of a teen at the service could get, on the same day, the arrival
time and a 10-minute link to the teen's photo.

### Root cause

The route treated **knowledge of identifying data** (name, birth date, coordinates) as **authorization to read private
data**. The intent was good ("show the teen they already checked in"), but the access rule was wrong.

## Fix

1. **The public response carries no photo and no time.** It also no longer says whether the person "already checked
   in": without the session below, the response is **identical** to someone who hasn't checked in yet (just the token to continue).
2. **Visit session** ([`lib/server/visit.ts`](../../lib/server/visit.ts)): when the check-in is completed, which requires
   a **matching face**, the server stores an `o2_visita` cookie on the device. It is HMAC-SHA256 signed, `httpOnly`,
   `SameSite=strict`, scoped to `/api/checkin`, valid until the end of the day and **tied to that teen and that
   service**. Only with this cookie does identification return the photo and time (5-minute signed URL).
3. **Repeat check-in from another device:** "you already checked in today" (409) only shows up **after** the face
   match, that is, to someone who proved to be the teen.
4. **Leaders** still see everything in the pastor area (`/pastor`), which already required a password and its own session.

## Verification

New regression tests ([`scripts/e2e-flow.mjs`](../../scripts/e2e-flow.mjs), the "P0 REGRESSION" block, and
[`tests/visit.test.ts`](../../tests/visit.test.ts)):

| Scenario | Before | After |
| --- | --- | --- |
| Correct name + birth date + coordinates **inside** the church, no session | ❌ returned `photoUrl` and `checkedInAt` | ✅ token only |
| Same scenario with a **forged** visit cookie | ❌ leaked | ✅ token only |
| Name written differently (no accents, no middle name) | ❌ leaked | ✅ token only |
| A token obtained this way + a photo of **someone else** | — | ✅ 403, without revealing the check-in |
| A valid cookie from **another** teen or **another** day | — | ✅ rejected (unit test) |
| The device that completed the check-in (valid session) | ✅ | ✅ sees the photo and time again |

The end-to-end test was run **against the old production build** (it failed all 6 scenarios, reproducing the problem)
and **against the fixed code** (it passed all of them).

## Log review and impact assessment

- **Possible exposure:** the route has existed since 10/16 and has identified people by name since 10/20. There was
  only something to expose on a service day, for people who checked in that day. The only real service so far was
  **2026-10-23**: **41 teens and 18 visitors, 53 photos**. Visitors don't go through this route, so what could leak was
  the 41 teens.
- **Available logs:**
  - **Vercel (Hobby plan):** keeps no searchable request logs. Not even the last half hour returned anything.
  - **Supabase (Free plan):** keeps API and Storage logs for 1 day. The 10/23 logs had already expired.
- **Conclusion:** **there's no available evidence to confirm or rule out** misuse on 10/23. Exploiting it required
  knowing the full name and birth date of a teen who was present **and** acting on the same day.
- **To stop depending on that:** the `audit_events` table records every identification and confirmation call
  (outcome, teen, IP as an HMAC, browser and reported distance), accessible only from the server.

### Pending decision (leadership)

Photos of minors are sensitive personal data under the LGPD (art. 14). Art. 48 requires notifying the ANPD and the data
subjects when an incident **may** cause relevant risk or harm. Whether to notify the guardians is the ministry
leadership's call. This report lays out the facts for that decision; it isn't legal advice.

## Lessons

- Identifying data **is not** a credential. Authorization comes from a session (leader) or proof (a matching face).
- Client-reported coordinates are for **user experience**, never for **access control**.
- "Exists / doesn't exist / already done" answers leak information too. Where possible, the response should be the same.
- Without retained logs, incidents can't be investigated: the audit trail has to belong to the application.
