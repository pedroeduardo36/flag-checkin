# P1: Removing the CPF and the CPFs already stored

| | |
| --- | --- |
| **Severity** | P1 (minors' identification data collected without need) |
| **Reported by** | mentor code review ([issue #1](https://github.com/pedroeduardo36/flag-checkin/issues/1), item 3) |
| **Fixed on** | 2026-10-29 |
| **Affected** | `POST /api/cadastro`, the registration form, the confirmation screen, the `members.cpf` column, scripts and tests |

## The problem

The CPF (Brazil's individual taxpayer ID) was only used to reject a repeated registration. Check-in uses **name + birth
date**, and attendances point to the registration's **internal id** (`members.id`). Storing minors' CPFs without needing
them goes against data minimization (LGPD art. 6, III, and art. 14). On top of that, the "Este CPF já está cadastrado"
("this CPF is already registered") message confirmed to anyone that a CPF was in the database.

## What changed

### The app doesn't ask for, validate, store or return a CPF

- Form (`components/RegistrationForm.tsx`): field, mask, validation and the confirmation screen line removed.
- API (`app/api/cadastro`): the `cpf` field isn't read. An old client still sending a CPF has the value discarded.
- `lib/format.ts`: `isValidCpf` and `maskCpf` removed, along with their tests.
- Simulation scripts and the end-to-end test no longer generate CPFs.
- Documentation (README and `docs/SETUP.md`) updated.

### Database in two controlled steps

1. **`20261029000000_cpf_opcional_duplicados.sql`**, compatible with the previous app version. Drops `not null` and
   uniqueness, **deletes every stored CPF** (`update ... set cpf = null`) and adds the possible-duplicate flag and the
   merge function.
2. **`20261029120000_remover_coluna_cpf.sql`**: drops the column. It goes **after** the new version is live, because
   the previous version still writes a CPF on registration.

Internal ids, attendances, check-ins and photos aren't touched by either step.

### Possible duplicates, reviewed by a leader

The CPF gave an automatic "no". Now registration uses only data the form already asks for (`lib/duplicates.ts`):

| Situation | What happens |
| --- | --- |
| Same birth date, same name (ignoring accents and "de/da") **and** same guardian email | It's the same guardian resubmitting: nothing is stored, and the confirmation is sent to their email again. |
| Same birth date and a compatible name (the same rule as check-in: omitted middle name, one typo) | The registration is stored with `possible_duplicate_of` pointing to the older one. |
| Different name | Normal registration. |

In all three cases the response is **identical**, so the public form doesn't reveal whether someone is already
registered (the "CPF already registered" message did).

Under **Líderes → Possíveis cadastros duplicados**, the leader sees both sides with name, birth date, guardian name,
registration date, number of attendances, whether there's a photo and whether the guardian contact matches. The email
and phone themselves aren't shown. There are two decisions:

- **Same person: merge.** Done by the `mesclar_cadastro` function, in one transaction. The new registration's
  attendances move to the old one. For a service both have, the old one's wins and the other photo is deleted. The old
  registration inherits the reference photo only if it has none. The new registration is deleted and the old one keeps its id.
- **Different people.** The flag is cleared.

Both decisions go to the action log (`duplicado_descartado` and `cadastro_mesclado`, with who, the target and the time).
While both registrations share a name, check-in answers "more than one similar registration" and asks for the full name
or a leader. That way no teen checks in on the wrong registration without noticing.

## Copies outside the database

| Where | Status |
| --- | --- |
| Repository | The only CPF left is the public documentation example `529.982.247-25`, sent on purpose by the end-to-end test to prove the server discards the field. No real CPF was ever committed: the old tests generated random numbers and deleted the registration at the end. |
| Operational files (`logs/`, local exports) | Checked on 2026-10-29: `logs/confirmacao-cadastro.json` has no CPF, and there's no exported CSV or spreadsheet with CPFs on this machine. |
| `presencas` view (CSV export from the dashboard) | Never included the CPF. |
| Emails (registration confirmation and check-in notice) | Never included the CPF. |
| Vercel logs | The route handled the repeated CPF before any error log, so the value wasn't written. Function logs expire on their own within the plan's window. |
| `audit_events` and `admin_audit` | Never stored a CPF. |
| **Supabase backups** | The managed daily backups still contain the CPF of registrations made before step 1. They **can't be edited** and expire on their own at the end of the plan's retention window: none on Free, 7 days on Pro, 14 on Team and up to 30 on Enterprise; PITR, if enabled, follows its configured window. **Expiry date:** the step 1 date plus the plan window. Until then, don't restore a backup from before step 1. If you must restore, run `update public.members set cpf = null` (or step 2) right after. After that date, no copy remains. |

## Verification

| Acceptance criterion | End-to-end test |
| --- | --- |
| New registrations work without a CPF | A registration with a CPF sent by an "old client" returns 200, and the column doesn't exist or is empty |
| Ids and history intact | The merge keeps the original's id, combines attendances without repeating a service and keeps the original's face descriptor |
| The app neither collects nor returns a CPF | No form field, the API discards the value and the duplicate review exposes no CPF, email or phone |
| Duplicates flagged with less invasive data | A resubmission by the same guardian doesn't duplicate and gets the same response; a name written differently with another email is flagged; check-in stays ambiguous until reviewed; the list requires a leader (401); "different people" and "merge" work and show up in the trail |

A new unit test, `tests/duplicates.test.ts`, covers the resubmission, the flag, a sibling with the same email, a
different name and picking the most similar registration.

## Deployment

1. Apply step 1 (`20261029000000_cpf_opcional_duplicados.sql`). The live version keeps working, and existing CPFs are deleted here.
2. Ship the code (merge the PR into `main`).
3. Apply step 2 (`20261029120000_remover_coluna_cpf.sql`).
4. Write down the step 1 date and the plan's backup window. That's when the last copy of the CPF expires.

**Step 1 applied in production on 2026-10-29.** Before: 112 registrations (112 with a CPF), 48 with a reference photo and
59 attendances. After: 112 registrations (**0 with a CPF**), 48 with a photo and 59 attendances. The end-to-end test (98
checks) passed against the production database, with the code from this branch.
