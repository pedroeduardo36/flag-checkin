# Pedidos das famílias (direitos do titular)

Processo manual, documentado e atendido pelo app. Vale para responsáveis e, quando couber, para o próprio adolescente.

| | |
| --- | --- |
| **Dono do processo** | Liderança da Juventude O2, até a igreja nomear um encarregado (LGPD art. 41). O nome definido vai em `PRIVACY_OWNER` (`lib/privacy.ts`) |
| **Canal** | E-mail mostrado em `/privacidade` (`PRIVACY_EMAIL`, ou o remetente dos avisos), resposta a qualquer aviso, ou pessoalmente com um líder |
| **Prazo** | Até **15 dias** a partir do pedido (art. 19, II). Confirmar o recebimento em até 2 dias |
| **Registro** | Toda ação feita pelo app fica no registro de ações (`admin_audit`), com quem atendeu, quando e o motivo |

## 1. Confirmar quem pede

Antes de qualquer coisa, confirme que quem pede é o responsável cadastrado:

- o pedido veio do **mesmo e-mail** do cadastro (confirmado pelo link); **ou**
- a pessoa está presente, é conhecida da liderança e confere nome, nascimento do adolescente e telefone do cadastro.

Na dúvida, responda pedindo que o pedido venha do e-mail cadastrado. Nunca envie dados para um endereço diferente do
cadastrado.

## 2. Atender

Tudo pela aba **Líderes → Cadastros e pedidos das famílias** (busca pelo nome):

| Pedido | Como atender |
| --- | --- |
| **Acesso** ("quais dados vocês têm?") | **Exportar dados** baixa um JSON com o cadastro, as autorizações e as presenças. Envie ao e-mail cadastrado e apague a cópia local. Se pedirem as fotos, baixe no Supabase (Storage → `fotos`) e envie pelo mesmo canal |
| **Correção** | Dados do adolescente ou do responsável: corrigir no Supabase (Table Editor → `members`) e anotar no próprio e-mail de resposta o que mudou. Se o e-mail do responsável mudar, use **Reenviar confirmação** para o novo endereço confirmar |
| **Exclusão** | **Apagar cadastro**, com o motivo (ex.: "pedido por e-mail em 30/10"). Saem dados, fotos, dados do rosto e presenças |
| **Retirar a autorização do reconhecimento facial** | **Retirar biometria**: a foto de registro e o descritor são apagados na hora. O check-in fica bloqueado. Sem nova confirmação em 7 dias, o cadastro é apagado |
| **Retirar toda a autorização** | Igual à exclusão |
| **Parar de receber avisos** | Segundo e-mail: o próprio link do e-mail permite sair. E-mail principal: sem avisos não há como confirmar presença ao responsável, então ofereça a exclusão |
| **Informação** ("com quem vocês compartilham?") | Responder com a página `/privacidade` e, se preciso, com [operacao-e-incidentes.md](operacao-e-incidentes.md) |
| **Perdi o e-mail de confirmação** | **Reenviar confirmação** (o prazo de um cadastro novo ganha mais 7 dias) |

O próprio responsável também pode recusar pelo link do e-mail de confirmação ("Não autorizo: apagar o cadastro"). Isso
apaga tudo na hora e fica no registro de ações.

## 3. Responder

Responda pelo mesmo canal, dizendo o que foi feito e quando. Modelo:

> Olá, {nome}. Recebemos seu pedido de {exclusão/acesso/…} em {data}. {O cadastro de X foi apagado em {data}, com as
> fotos, os dados do rosto e o histórico de presença. / Segue em anexo a cópia dos dados.} As cópias de segurança do
> banco somem sozinhas em até {janela do plano}. Qualquer dúvida, é só responder. Liderança da Juventude O2.

## Teste do processo

O teste ponta a ponta (`npm run test:fluxo`) exercita exportação, retirada da biometria, reenvio do link, exclusão pelo
líder (com motivo obrigatório) e recusa pelo responsável, e confere o registro de cada um.
