# P2: Checkout pelo navegador

| | |
| --- | --- |
| **Prioridade** | P2 (a saída não era registrada) |
| **Pedido por** | revisão de código do mentor ([issue #1](https://github.com/pedroeduardo36/flag-checkin/issues/1), item 5) |
| **Implementado em** | 31/10/2026 |

## Como funciona

Sem app instalado e sem acompanhar a localização em segundo plano:

1. Quando o check-in termina (rosto conferido, ou o check-in do visitante), o servidor grava no celular a **sessão da
   visita**: cookie `o2_visita`, assinado com HMAC, `httpOnly`, `SameSite=strict`, restrito a `/api/checkin` e válido por
   18 h. Ele guarda o adolescente (ou "visitante"), o **check-in** e o dia do culto.
2. Na hora de ir embora, a página **`/checkout`** abre de três jeitos:
   - pelo botão **"Estou indo embora"** da tela de sucesso (que também aparece ao reabrir `/checkin` no mesmo celular);
   - pelo **QR code da saída**: [`/qrcode?tipo=saida`](https://flag-checkin.vercel.app/qrcode?tipo=saida), para imprimir e
     colar na porta;
   - por uma **tag NFC** na porta: grave `https://flag-checkin.vercel.app/checkout` como registro de URL numa NTAG213 ou
     NTAG215 (qualquer app gravador de NFC faz isso).
3. A página mostra o nome, o horário de chegada e **"Saída não registrada"**. Um toque em **"Confirmar minha saída"**
   grava a saída. Não pede nome, nascimento nem foto de novo: vale a sessão da visita.

| Pedido da issue | Implementação |
| --- | --- |
| Sessão segura da visita depois do check-in | O cookie `o2_visita` ganhou o id do check-in (`cid`) e passou a valer também para visitantes. Trocar o check-in no cookie quebra a assinatura. Um cookie de um check-in movido para outro dia não serve. Repetir nome e telefone de um visitante **não** dá a sessão: quem sabe o telefone não fecha a visita de outra pessoa |
| Abrir a saída e confirmar com um toque | `/checkout` com um botão. `GET /api/checkin/checkout` mostra a visita deste celular; `POST` confirma |
| Horário do servidor e quem confirmou | `checked_out_at` é o horário do servidor na confirmação; `checkout_by` é `participante` ou `lider` (com `checkout_leader_id`) |
| Atualizar o painel e avisar o responsável | O feed ao vivo mostra "Saída às 21:15" ou "Saída não registrada" em cada presença, e o total de saídas do dia. O feed incremental também traz as saídas gravadas ou desfeitas (`checkout_recorded_at`). O dashboard ganhou "Saída confirmada" no último encontro e a coluna "Saídas". O responsável recebe um e-mail só texto com o horário (`CHECKOUT_NOTICE=false` desliga) |
| Líderes corrigem saídas esquecidas, com auditoria | Feed → **Registrar saída** (horário + motivo) ou **Desfazer saída** (motivo). Ações `saida_registrada` e `saida_desfeita` no registro de ações, com a saída anterior. O líder não sobrescreve uma saída existente: desfaz antes |
| "Saída não registrada" até confirmar | Nada grava a saída sozinho: nem fechar o navegador, nem perder a conexão, nem o horário do fim do culto, nem a retenção. Sem confirmação, o app, o feed e a view `presencas` mostram "não registrada" |
| Presença preservada; repetir não duplica | A saída fica na **mesma linha** do check-in, em colunas próprias. A gravação é `update … where checked_out_at is null`: confirmações repetidas ou simultâneas gravam uma vez e devolvem a saída que já vale. O banco recusa saída antes da chegada (`checkins_checkout_valido`) |

### Localização na saída

É **opcional** e não bloqueia: a página só lê a posição se o celular **já** tinha dado permissão (não pergunta de novo) e
espera no máximo 5 s. O servidor guarda só a distância até a igreja (`checkout_distance_m`), como no check-in. Pela
especificação de geolocalização, o navegador não entrega posições em segundo plano, então o app **não tenta**
reconstruir o horário real da saída: vale a confirmação.

### Limites conhecidos

- A sessão está no navegador do check-in. Quem abre o QR da saída em outro navegador (por exemplo, a câmera do iPhone
  abre o Safari e o check-in foi no Chrome) vê "não encontramos um check-in neste celular", com a orientação de abrir no
  mesmo navegador ou procurar um líder.
- Celular emprestado: a tela de sucesso tem "Fazer o check-in de outra pessoa neste celular". A sessão passa a ser do
  último check-in feito no aparelho, e a saída do primeiro fica com um líder.
- Se o adolescente sair e voltar, um líder desfaz a saída.

## Critérios de aceite

| Critério | Onde |
| --- | --- |
| Funciona no navegador do celular, sem app | `/checkout`, aberto pelo botão, QR ou NFC. Conferido a 375 px |
| Saída ligada à sessão da visita, com o horário da confirmação | `lib/server/visit.ts`, `lib/server/checkout.ts`, `app/api/checkin/checkout` |
| Saídas esquecidas ou repetidas tratadas com segurança | Correção dos líderes com motivo e auditoria. Gravação condicional, sem duplicar |

## Verificação

- Testes unitários: `tests/checkout.test.ts` (horário informado pelo líder, culto depois da meia-noite, saída antes da
  chegada, horário no futuro), `tests/visit.test.ts` (sessão com o check-in, visitante, cookie forjado, cookie antigo),
  `tests/email.test.ts` (aviso de saída só texto, desligável) e `tests/stats.test.ts` (saídas por encontro).
- Teste ponta a ponta (`npm run test:fluxo`), cobrindo:
  - sessão ausente, forjada ou de outro dia recusada;
  - saída com um toque e o horário do servidor;
  - três confirmações simultâneas gravando uma só, com a presença intacta;
  - visitante com e sem sessão;
  - aviso ao responsável;
  - feed, feed incremental e dashboard;
  - correções do líder: motivo obrigatório, sem sobrescrever, desfazer, horário no futuro e registrar;
  - a sessão do adolescente não corrige;
  - view `presencas` e trilha de auditoria.

## Implantação

1. Aplicar `20261031000000_checkout.sql`. Ela só adiciona colunas, uma restrição e um índice, e recria a view
   `presencas` com a saída.
2. Publicar o código (merge do PR).
3. Imprimir o QR da saída em `/qrcode?tipo=saida` e/ou gravar as tags NFC da porta.
4. Opcional: `CHECKOUT_NOTICE=false` na Vercel para não enviar o aviso de saída.
