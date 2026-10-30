# Legal review: what to bring to the lawyer

This work covers the technical side. **It does not replace** a review by a Brazilian lawyer experienced in LGPD (the
data protection law), the ECA (Child and Adolescent Statute) and the ECA Digital (Law 15.211/2025). Bring this file, the
[inventory](data-inventory.md), the `/privacidade` page and the consent text (the form and `/confirmar`).

## Questions

### Face recognition of minors

1. **Necessity.** Biometrics only serve to stop someone checking in on behalf of another teen. Does the purpose
   (attendance at a church service) justify sensitive data about minors? Would the geofence plus a photo checked by
   leaders, without biometrics, be enough (art. 6, III, necessity)?
2. **Legal basis.** We propose the guardian's specific and prominent consent (art. 11, I, and art. 14, §1), confirmed by
   the email owner. Is that appropriate? Does a religious institution have any other applicable basis?
3. **Freely given consent.** Today, without biometrics the teen takes part in everything but can't record attendance
   from the phone. Does that make consent conditional (art. 8, §4, and art. 14, §4)? Do we need an alternative way to
   record attendance, for example by a leader?
4. **Impact assessment (RIPD).** Does processing teens' biometrics require or recommend a data protection impact
   assessment (art. 38)? If so, this repository can hold it.
5. **The teen's view.** The ECA and ECA Digital ask for the teen's opinion to be considered. Is the "para você,
   adolescente" ("for you, teen") explanation on `/privacidade` and at the registration photo step enough?

### Guardian and verification

6. Email confirmation proves the person controls the email, **not** that they are the legal guardian. In this context
   (an in-person community whose leaders know the families), is that enough, combined with in-person confirmation when
   in doubt? Art. 14, §5, asks for "all reasonable efforts".
7. Registrations older than this version accepted a text that **didn't explain biometrics**. The chosen path was asking
   for new consent by 2026-11-30, deleting whoever doesn't confirm and keeping check-in working in the meantime. Should
   biometrics for those registrations be suspended right away, until the new confirmation?

### Photos

8. Creative photos may show other teens. They stay in the app only, visible to leaders, for 30 days, and never go out by
   email. Is that enough, or does every teen who appears in a group photo need image consent?
9. Old notices with photos remain in guardians' inboxes. Is there anything we should do about them?

### Organization

10. Who is the **controller**: the church (legal entity) or the ministry? Who should the **data protection officer**
    be (art. 41)? Small processing agents (CD/ANPD Resolution No. 2/2022) may skip the officer but need a channel.
11. International transfer: does sending email through Gmail (Google) need a specific clause or notice (art. 33 and
    CD/ANPD Resolution No. 19/2024)?
12. Are the retention periods in the [inventory](data-inventory.md) appropriate? Does any data need to be kept longer
    because of a legal obligation, for example to prove consent after the registration is deleted?

## After the review

Update the text on `/privacidade`, the form and `/confirmar`, and bump `CONSENT_VERSION` (`lib/server/guardian.ts`).
With the new version, guardians need to confirm again, through `npm run verification:send` adapted to the new version.
Record here the date and the name of the reviewer.
