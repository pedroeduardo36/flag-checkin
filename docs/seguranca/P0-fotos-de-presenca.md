# P0 — Acesso público a fotos e horários de presença

| | |
| --- | --- |
| **Severidade** | P0 (dado pessoal de menores exposto sem autenticação) |
| **Reportado por** | revisão de código do mentor, 27/10/2026 |
| **Corrigido em** | 27/10/2026 (este commit) |
| **Rota afetada** | `POST /api/checkin/identificar` |

## O problema

A rota pública de identificação recebe **nome completo + data de nascimento + coordenadas**. Quando o adolescente
**já tinha feito check-in naquele dia**, ela devolvia:

```json
{ "alreadyCheckedIn": true, "name": "…", "checkedInAt": "2026-10-23T22:47:00Z", "photoUrl": "https://…/object/sign/fotos/…?token=…" }
```

- **Sem login de líder** e **sem conferência de rosto**.
- A única barreira era a cerca geográfica, mas as **coordenadas vêm do próprio celular** e podem ser forjadas.
- Nome e data de nascimento não são segredo: colegas, familiares e redes sociais os conhecem.

**Na prática:** qualquer pessoa que soubesse o nome e o nascimento de um adolescente presente no culto obtinha, no
mesmo dia, o horário de chegada e um link de 10 minutos para a foto dele.

### Causa raiz

A rota tratava **conhecimento de dados de identificação** (nome, nascimento, coordenadas) como **autorização para ler
dados privados**. A intenção era boa ("mostrar ao adolescente que ele já fez check-in"), mas a regra de acesso
estava errada.

## Correção

1. **A resposta pública não tem foto nem horário.** Ela também não diz mais se a pessoa "já fez check-in": para
   quem não tem a sessão abaixo, a resposta é **idêntica** à de quem ainda não fez check-in (só o token para seguir).
2. **Sessão da visita** ([`lib/server/visit.ts`](../../lib/server/visit.ts)): quando o check-in é concluído, o que
   exige **rosto conferido**, o servidor grava no aparelho um cookie `o2_visita`. Ele é assinado com HMAC-SHA256,
   `httpOnly`, `SameSite=strict`, restrito a `/api/checkin`, vale até o fim do dia e está **ligado àquele adolescente e
   àquele culto**. Só com esse cookie a identificação devolve foto e horário (URL assinada de 5 minutos).
3. **Check-in repetido em outro aparelho:** o "você já fez check-in hoje" (409) só aparece **depois** da conferência
   de rosto, ou seja, para quem provou ser o adolescente.
4. **Líderes** continuam vendo tudo pela área do pastor (`/pastor`), que já exigia senha e sessão própria.

## Verificação

Novos testes de regressão ([`scripts/testar-fluxo.mjs`](../../scripts/testar-fluxo.mjs), bloco "REGRESSÃO P0", e
[`tests/visit.test.ts`](../../tests/visit.test.ts)):

| Cenário | Antes | Depois |
| --- | --- | --- |
| Nome + nascimento corretos + coordenadas **dentro** da igreja, sem sessão | ❌ devolvia `photoUrl` e `checkedInAt` | ✅ só o token |
| Mesmo cenário com cookie de visita **forjado** | ❌ vazava | ✅ só o token |
| Nome escrito de outro jeito (sem acento, sem nome do meio) | ❌ vazava | ✅ só o token |
| Token obtido assim + foto de **outra** pessoa | — | ✅ 403, sem revelar o check-in |
| Cookie válido de **outro** adolescente ou de **outro** dia | — | ✅ recusado (unitário) |
| Aparelho que concluiu o check-in (sessão válida) | ✅ | ✅ revê foto e horário |

O teste ponta a ponta foi rodado **contra a produção antiga** (falhou nos 6 cenários, o que reproduz o problema) e
**contra o código corrigido** (passou em todos).

## Revisão de logs e avaliação de impacto

- **Exposição possível:** a rota existe desde 16/10, e desde 20/10 identifica por nome. Só havia o que expor no dia de
  um culto, para quem fez check-in naquele dia. O único culto real até agora foi **23/10/2026**: **41 adolescentes
  e 18 visitantes, 53 fotos**. Os visitantes não passam por esta rota, então o que podia vazar eram os 41 adolescentes.
- **Logs disponíveis:**
  - **Vercel (plano Hobby):** não retém logs de requisição consultáveis. Nem a última meia hora retornou registros.
  - **Supabase (plano Free):** retém logs da API e do Storage por 1 dia. Os de 23/10 já expiraram.
- **Conclusão:** **não há evidência disponível para confirmar nem para descartar** uso indevido em 23/10. A
  exploração exigia saber o nome completo e a data de nascimento de um adolescente presente **e** agir no mesmo dia.
- **Para não depender mais disso:** a tabela `audit_events` registra cada chamada de identificação e confirmação
  (resultado, adolescente, IP como HMAC, navegador e coordenadas informadas), com acesso só pelo servidor.

### Decisão pendente (liderança)

Fotos de menores são dado pessoal sensível no contexto da LGPD (art. 14). O art. 48 prevê comunicar a ANPD e os
titulares quando um incidente **pode** causar risco ou dano relevante. A decisão de comunicar os responsáveis cabe à
liderança do ministério. Este relatório traz os fatos para essa decisão; não é orientação jurídica.

## Lições

- Dado de identificação **não é** credencial. Autorização vem de sessão (líder) ou de prova (rosto conferido).
- Coordenadas informadas pelo cliente servem para **experiência do usuário**, nunca para **controle de acesso**.
- Respostas para "existe/não existe/já fez" também vazam informação. Quando possível, a resposta deve ser igual.
- Sem logs retidos, não se investiga incidente: a auditoria precisa ser da própria aplicação.
