# Family requests (data subject rights)

A manual, documented process supported by the app. It applies to guardians and, where appropriate, to the teen.

| | |
| --- | --- |
| **Process owner** | O2 youth leadership, until the church appoints a data protection officer (LGPD art. 41). The chosen name goes in `PRIVACY_OWNER` (`lib/privacy.ts`) |
| **Channel** | The email shown on `/privacidade` (`PRIVACY_EMAIL`, or the notices' sender), a reply to any notice, or in person with a leader |
| **Deadline** | Up to **15 days** from the request (art. 19, II). Acknowledge receipt within 2 days |
| **Record** | Every action taken through the app goes to the action log (`admin_audit`), with who handled it, when and the reason |

## 1. Confirm who is asking

Before anything else, confirm the requester is the registered guardian:

- the request came from the **same email** as the registration (confirmed through the link); **or**
- the person is there in person, known to the leadership, and matches the teen's name, birth date and the registered phone.

When in doubt, reply asking for the request to come from the registered email. Never send data to an address other than
the registered one.

## 2. Handle it

Everything happens in the **Líderes → Cadastros e pedidos das famílias** tab (search by name):

| Request | How to handle it |
| --- | --- |
| **Access** ("what data do you have?") | **Exportar dados** downloads a JSON with the registration, consents and attendances. Send it to the registered email and delete the local copy. If they ask for the photos, download them in Supabase (Storage → `fotos`) and send them through the same channel |
| **Correction** | Teen or guardian details: fix them in Supabase (Table Editor → `members`) and note what changed in the reply email itself. If the guardian's email changes, use **Reenviar confirmação** so the new address confirms |
| **Erasure** | **Apagar cadastro**, with the reason (e.g. "requested by email on 10/30"). Data, photos, face data and attendances are removed |
| **Withdraw face recognition consent** | **Retirar biometria**: the registration photo and descriptor are deleted immediately. Check-in is blocked. Without a new confirmation within 7 days, the registration is deleted |
| **Withdraw all consent** | Same as erasure |
| **Stop receiving notices** | Second email: the email's own link lets them opt out. Primary email: without notices there's no way to confirm attendance to the guardian, so offer erasure |
| **Information** ("who do you share with?") | Reply with the `/privacidade` page and, if needed, [operations-and-incidents.md](operations-and-incidents.md) |
| **Lost the confirmation email** | **Reenviar confirmação** (a new registration's deadline gets 7 more days) |

The guardian can also decline through the confirmation email link ("Não autorizo: apagar o cadastro"). That deletes
everything immediately and is recorded in the action log.

## 3. Reply

Reply through the same channel, saying what was done and when. Template (in Portuguese, as sent to families):

> Olá, {nome}. Recebemos seu pedido de {exclusão/acesso/…} em {data}. {O cadastro de X foi apagado em {data}, com as
> fotos, os dados do rosto e o histórico de presença. / Segue em anexo a cópia dos dados.} As cópias de segurança do
> banco somem sozinhas em até {janela do plano}. Qualquer dúvida, é só responder. Liderança da Juventude O2.

## Testing the process

The end-to-end test (`npm run test:e2e`) exercises export, biometric withdrawal, link resend, deletion by a leader
(with a mandatory reason) and refusal by the guardian, and checks the log entry for each.
