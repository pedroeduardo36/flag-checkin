# P1: Regras de privacidade e coleta mínima

| | |
| --- | --- |
| **Severidade** | P1 (biometria de menores sem explicação clara, e-mail do responsável não verificado, sem prazos de retenção) |
| **Reportado por** | revisão de código do mentor ([issue #1](https://github.com/pedroeduardo36/flag-checkin/issues/1), item 4) |
| **Implementado em** | 30/10/2026 |

Documentos:

- [Inventário de dados](inventario-de-dados.md): cada dado coletado, a finalidade, a base legal proposta e o prazo.
- [Pedidos das famílias](pedidos-das-familias.md): dono, canal, prazo e passo a passo de acesso, correção, exclusão
  e retirada do consentimento.
- [Operação e incidentes](operacao-e-incidentes.md): fornecedores, quem acessa o quê, resposta a incidentes e tarefas
  manuais pendentes.
- [Revisão jurídica](revisao-juridica.md): as perguntas para o advogado (LGPD, ECA, ECA Digital).
- Página pública [`/privacidade`](../../app/privacidade/page.tsx): a explicação para famílias e adolescentes.

## O que mudou no app

| Pedido da issue | Implementação |
| --- | --- |
| Revisão jurídica | Fora do código. Lista de perguntas em [revisao-juridica.md](revisao-juridica.md); a decisão final depende dela |
| Explicar biometria, fotos, destinatários, retenção e contatos | Página `/privacidade` em linguagem simples, com um trecho para o adolescente. No formulário: uma caixa explicando o reconhecimento facial e **duas autorizações separadas**, a geral e a **específica da biometria** (LGPD art. 11). No passo da foto de registro, uma frase para o adolescente. Link para `/privacidade` no rodapé de todas as páginas |
| Verificar o e-mail e a guarda | O cadastro só vale depois que o **dono do e-mail** abre o link (uso único, 7 dias, só o hash no banco), lê a explicação e marca as duas autorizações. Antes disso: sem check-in (403 `CADASTRO_PENDENTE`) e sem aviso. Sem confirmação em 7 dias, o cadastro é apagado. O segundo e-mail também confirma, e só então recebe avisos. Ver a pergunta 6 da revisão jurídica sobre os limites disso |
| Cadastros antigos | Têm até **30/11/2026** para confirmar com o texto novo. `npm run verificacao:enviar` manda o link. Até lá o check-in continua; depois, são apagados se não confirmarem |
| Retenção e exclusão | `public.expurgar_dados()` aplica os prazos do inventário, roda todo dia (Vercel Cron) e tem modo de simulação. A auditoria continua imutável para o app; só o expurgo, e só para registros vencidos, consegue apagá-la |
| Pedidos das famílias | Aba Líderes → **Cadastros e pedidos das famílias**: buscar, exportar (JSON), reenviar confirmação, retirar biometria e apagar (com motivo). O responsável também recusa pelo link. Tudo registrado |
| Avisos só texto; fotos em grupo | O aviso de check-in não tem mais foto. A foto criativa, que pode ter outros adolescentes, fica no app, só para os líderes, e é apagada em 30 dias |
| Fornecedores, acessos e incidentes | [operacao-e-incidentes.md](operacao-e-incidentes.md). As funções da Vercel passam a rodar em São Paulo (`gru1`) |
| Coordenadas precisas | O check-in e a auditoria guardam só a **distância** até a igreja. As coordenadas antigas são apagadas no primeiro expurgo. A foto de visitante não leva mais o telefone no nome do arquivo |

## Critérios de aceite

| Critério | Onde |
| --- | --- |
| Cada dado tem finalidade e prazo documentados | [inventario-de-dados.md](inventario-de-dados.md), aplicado por `expurgar_dados()` |
| Pedidos têm dono e processo que funciona | [pedidos-das-familias.md](pedidos-das-familias.md) e a aba Líderes, coberta pelo teste ponta a ponta. **O nome do encarregado ainda precisa ser definido** |
| Famílias recebem explicação correta do reconhecimento facial e do compartilhamento de fotos | `/privacidade`, o formulário e a página de confirmação, que coletam o consentimento específico |

## Verificação

- Testes unitários: `tests/guardian.test.ts` (check-in só com consentimento, prazo de transição, avisos só para e-mail
  confirmado, hash do link) e `tests/email.test.ts` (aviso sem foto, e-mail de confirmação).
- Teste ponta a ponta:
  - cadastro sem autorização biométrica recusado e check-in bloqueado antes da confirmação;
  - link inventado, de uso único e que exige a autorização biométrica;
  - consentimento gravado e check-in e auditoria sem coordenadas;
  - foto de visitante sem telefone no nome;
  - exportação sem os números do rosto, retirada da biometria (que bloqueia o check-in), reenvio, exclusão com motivo e recusa pelo responsável;
  - simulação da retenção, que não muda nada;
  - cron sem segredo recusado e página `/privacidade`;
  - registro de cada ação.

## Implantação

1. Aplicar `20261030000000_privacidade.sql`. Ela só adiciona colunas, tabela e funções, sem apagar nada. Os cadastros
   antigos ganham prazo até 30/11/2026.
2. Publicar o código (merge do PR).
3. Adicionar `CRON_SECRET` na Vercel (e, se quiser outro contato, `PRIVACY_EMAIL`).
4. `npm run retencao`: simular e conferir os números. Depois, `npm run retencao -- --aplicar` (ou esperar o cron).
5. `npm run verificacao:enviar` para simular e `-- --enviar` para pedir a confirmação aos responsáveis dos cadastros
   antigos.
6. Tarefas manuais em [operacao-e-incidentes.md](operacao-e-incidentes.md#tarefas-pendentes).
