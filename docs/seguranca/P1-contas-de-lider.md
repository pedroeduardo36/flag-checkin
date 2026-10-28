# P1: Login dos líderes e auditoria das ações administrativas

| | |
| --- | --- |
| **Severidade** | P1 (acesso a fotos e presença de menores protegido por uma única senha compartilhada) |
| **Reportado por** | revisão de código do mentor, 27/10/2026 |
| **Corrigido em** | 27/10/2026 |
| **Afetava** | `POST /api/pastor/sessao`, `lib/server/pastor.ts` e tudo que dependia dessa sessão (feed e dashboard) |

## O problema

- **Uma senha para todos os líderes** (`PASTOR_PASSWORD`). Não dava para saber quem entrou, tirar o acesso de uma
  pessoa sem trocar a senha de todos, nem exigir um segundo fator.
- **Sessão sem estado:** o cookie era `validade.assinatura`. Nenhuma sessão podia ser encerrada antes de vencer
  (12 h): nem a de um líder que saiu da equipe, nem a de um celular perdido.
- **Força bruta:** só um atraso de 0,8 s por senha errada. Requisições em paralelo, ou em instâncias diferentes do
  servidor, não esperavam umas pelas outras.
- **Nenhum registro** de quem fez o quê.

## O que mudou

### Dois tipos de acesso, só

| Acesso | Como prova quem é | O que alcança |
| --- | --- | --- |
| **Adolescente** | Sessão da visita (cookie `o2_visita`, emitido depois do rosto conferido; sem senha) | Só o próprio check-in do dia, e só em `/api/checkin` |
| **Líder** | Conta individual: senha + código do app autenticador | Feed, dashboard, cadastro, administração de contas, correção de presença, registro de ações |

Não existe hierarquia entre líderes: todos administram. Para não haver autoatendimento perigoso, **desativar** e
**redefinir acesso** só valem para a conta de **outro** líder.

### Login em duas etapas, autenticador obrigatório

1. **E-mail + senha** (scrypt, sal por conta). A senha certa libera **só** a etapa do código (sessão de 10 min).
2. **Código de 6 dígitos do app autenticador** (TOTP, RFC 6238). Só então a sessão vira `completa`, e só sessão
   completa lê dados privados.

- **Cadastro do autenticador antes de qualquer dado.** Conta nova ou redefinida nasce com um **código de ativação**
  (uso único, 24 h) gerado por outro líder. A pessoa define a própria senha e cadastra o autenticador na mesma sessão.
  Senha certa sem autenticador cadastrado não entra.
- **Sem alternativa por SMS ou e-mail.**
- O segredo do autenticador fica **cifrado** (AES-256-GCM, chave derivada do `CHECKIN_SECRET` via HKDF). O último código
  aceito é gravado: **o mesmo código não vale duas vezes**, nem num segundo login.
- Cada mudança de etapa gera um cookie novo, e o anterior é encerrado no banco.

> **Sobre a força desse método:** código de app autenticador é o **mínimo prático** escolhido para este app (grupo
> pequeno, sem custo, funciona em qualquer celular). Ele **não** é o método mais seguro que existe: alguém pode ser
> enganado a digitar o código num site falso. **Passkeys e chaves de segurança (FIDO2/WebAuthn)** resistem a phishing
> e são o próximo passo recomendado ([orientação da CISA](https://www.cisa.gov/sites/default/files/2023-01/fact-sheet-implementing-phishing-resistant-mfa-508c.pdf)).

### Recuperação

- **Código de ativação:** 12 caracteres (60 bits), uso único, 24 h, com limite de tentativas. Fica guardado como
  SHA-256 sem chave, para o script `lider:criar`, que roda fora da Vercel, gerar códigos que a produção aceita.
- **Códigos de recuperação:** 10 por líder, mostrados uma única vez, com só o HMAC guardado. Cada um vale **uma vez**
  (atualização condicional `used_at is null`). Usar um código significa "perdi o celular": o autenticador antigo é
  apagado, **as outras sessões da conta caem** e um autenticador novo é cadastrado na hora, com 10 códigos novos.
- **Sem códigos (processo controlado):** **outro líder** confirma pessoalmente quem é e usa **Redefinir acesso**. Senha,
  autenticador e códigos são apagados, as sessões caem e sai um código de ativação de 24 h, entregue em mãos. Ninguém
  redefine a própria conta, e tudo fica no registro de ações.

### Limite de tentativas que vale em paralelo e em várias instâncias

O contador fica no Postgres (`auth_rate_hit`): `insert … on conflict do update … returning hits` trava a linha, então
requisições simultâneas e funções serverless diferentes contam certo. A tentativa é contada **antes** de conferir.

| O quê | Limite |
| --- | --- |
| Senha, por conta | 8 a cada 15 min |
| Senha, por rede (IP como HMAC) | 30 a cada 15 min |
| Código do autenticador ou de recuperação, por conta | 5 a cada 15 min e 20 por dia (estourar também encerra a etapa) |
| Código de ativação | 5 por conta e 20 por rede a cada 15 min |

O contador por conta pode ser usado para **atrapalhar** o login de um líder por 15 min (não para entrar). Com poucos
líderes, a troca vale a pena; se virar problema, o próximo passo é passkey, que não tem segredo para adivinhar.

### Administração e revogação imediata

Aba **Líderes**: criar conta, desativar, reativar (sempre com código de ativação novo), redefinir acesso, encerrar
sessões (de outro líder, ou "sair dos outros aparelhos" na própria conta) e gerar novos códigos de recuperação
(pede o código atual do autenticador). As sessões ficam no banco, então **desativar derruba as sessões daquele líder
na próxima requisição**, sem afetar os demais.

### Registro das ações (`admin_audit`)

- **O que entra:** login (ok, negado, bloqueado), saída, conta criada, ativada, desativada e reativada, acesso
  redefinido, sessões encerradas, autenticador cadastrado, código de recuperação usado, códigos novos gerados e
  **correção de presença** (o líder remove um check-in feito por engano, com motivo obrigatório).
- **Campos de cada registro:** quem agiu, conta ou registro afetado, quando, ação, resultado e detalhes.
- **Proteção:** um gatilho no Postgres recusa `UPDATE`, `DELETE` e `TRUNCATE`, e o privilégio foi revogado também da
  `service_role`. Nem o servidor do app consegue editar ou apagar. A mesma proteção vale para `audit_events`, a trilha
  do check-in criada no P0.
- **O que nunca entra:** senha, código do autenticador, código de recuperação ou de ativação, chave do autenticador e
  dado biométrico. O IP entra só como HMAC.

## Verificação

| Critério de aceite | Teste |
| --- | --- |
| Todo líder passa pelo app autenticador | Ativação leva obrigatoriamente ao cadastro do autenticador; só a senha não abre o feed (401); sessão sem autenticador não lê nada (401); senha certa sem autenticador cadastrado não entra |
| Desativar encerra as sessões só daquele líder | O líder C entra; A desativa C; o feed de C dá 401 na hora e o de A continua 200 |
| Ações administrativas deixam rastro | A trilha tem ativação, autenticador, login ok/negado/bloqueado, recuperação, criação, desativação (e a tentativa negada de se desativar) e correção de presença com motivo |
| Sessão de adolescente não alcança funções de líder | O cookie `o2_visita` válido recebe 401 em contas, feed e correção de presença (e2e e teste unitário) |
| Auditoria protegida e sem segredos | `update` e `delete` com a chave do servidor falham; o texto da trilha não contém senha, códigos nem chave |
| Limite vale em paralelo | 14 logins simultâneos: no máximo 8 conferidos, o resto 429; 8 códigos simultâneos: no máximo 5 conferidos |
| Código não se repete | O código do cadastro não serve no login, nem o do login num segundo login |

Testes unitários novos: TOTP com os **vetores oficiais da RFC 6238**, scrypt, regras de senha, cifragem adulterada ou
com outra chave, formato e hash dos códigos, e sessão (só `completa` libera; revogada, vencida ou desativada é recusada;
cookie de adolescente e o cookie antigo `o2_pastor` nem consultam o banco).

## Implantação

1. Aplicar a migration `20261028000000_contas_lideres.sql`.
2. Publicar o código. A partir daí, a senha compartilhada deixa de funcionar.
3. `npm run lider:criar -- "Nome" email` para o primeiro líder. Os demais são criados na aba Líderes.
4. Remover `PASTOR_PASSWORD` da Vercel e do `.env.local`.
