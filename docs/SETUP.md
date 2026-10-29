# Guia de instalação e operação

> **Fluxo atual:** o responsável cadastra o adolescente em `/cadastro`, sem foto nem senha. Na igreja, o adolescente faz o
> check-in com nome completo e data de nascimento. No 1º check-in tira a foto de registro, que precisa ter um rosto só;
> nos seguintes, a foto criativa dentro do culto. Visitantes entram só com nome e telefone.

App web (abre no navegador do celular, sem instalar nada) para o check-in dos adolescentes na chegada ao culto.

```
Antes do culto ──► /cadastro (o RESPONSÁVEL preenche)
   Dados do adolescente (nome, nascimento, celular opcional; sem CPF) +
   dados do responsável (nome, telefone, e-mail e um 2º e-mail opcional) + autorização LGPD. Sem foto, sem senha.

QR code / tag NFC ──► /checkin
   1. Localização  → confere se o celular está dentro do raio da igreja
   2. "Tenho cadastro": nome completo + nascimento   |   "Sou visitante": nome + telefone (+ foto opcional)
   3. 1º check-in: foto de REGISTRO (1 rosto, vira a foto do cadastro) → explicação → foto CRIATIVA
      Demais: explicação → foto CRIATIVA dentro do culto (pode ter amigos; um rosto precisa ser o dele)
   4. Tela de sucesso + e-mail ao responsável com horário e foto
```

## Stack

| Parte | Escolha | Por quê |
| --- | --- | --- |
| Front + API | **Next.js 15** (React 19, rotas de API) | um projeto só, roda grátis na Vercel |
| Banco | **Supabase** (Postgres) | grátis, inclui armazenamento de fotos, painel para ver as presenças |
| Fotos | Supabase Storage, bucket **privado** | fotos de menores nunca ficam públicas |
| Hospedagem | **Vercel** (plano Hobby, grátis) | HTTPS automático — câmera e GPS exigem HTTPS |

### Bancos de dados gratuitos considerados

| Provedor | Plano grátis | Observação |
| --- | --- | --- |
| **Supabase** ✅ escolhido | Postgres 500 MB + 1 GB de arquivos | banco **e** fotos no mesmo lugar; projeto pausa após 7 dias sem uso (basta abrir o painel para reativar) |
| Neon | Postgres 0,5 GB | ótimo Postgres, mas precisaria de outro serviço para as fotos |
| Firebase (Firestore + Storage) | 1 GiB Firestore; Storage exige plano Blaze | NoSQL; armazenamento de fotos pede cartão cadastrado |
| Turso | SQLite distribuído, 5 GB | sem armazenamento de arquivos |
| MongoDB Atlas | 512 MB | NoSQL, sem armazenamento de arquivos |

Estimativa: 200 adolescentes × 52 cultos × ~80 KB por selfie ≈ 830 MB/ano em fotos. Apague selfies antigas
(ex.: com mais de 6 meses) para continuar no plano grátis — veja "Manutenção".

## Passo a passo para colocar no ar

### 1. Supabase
> ✅ Já feito: projeto **flag-checkin** (ref `kcmlgoffvympjalsrwdn`, São Paulo), migration aplicada e `.env.local` preenchido.
> Painel: <https://supabase.com/dashboard/project/kcmlgoffvympjalsrwdn>

1. Crie a conta em <https://supabase.com> → **New project** (região *South America (São Paulo)*).
2. Aplique o schema por **um** destes caminhos:
   - **CLI (recomendado):** `npx supabase login` → `npx supabase link --project-ref SEU_REF` → `npm run db:push`
   - **Manual:** SQL Editor → New query → cole [`supabase/migrations/20261015000000_init.sql`](../supabase/migrations/20261015000000_init.sql) → Run.
3. **Project Settings → API**: copie a *Project URL* e a chave **service_role**.

### 2. Variáveis de ambiente
Copie `.env.example` para `.env.local` e preencha:

| Variável | O que é |
| --- | --- |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | do passo anterior (a service_role **só** no servidor) |
| `CHURCH_LAT` / `CHURCH_LNG` | coordenadas da igreja — no Google Maps, clique com o botão direito no prédio e copie |
| `CHURCH_RADIUS_METERS` | raio aceito; comece com **150** (GPS dentro de prédio erra 20–60 m) |
| `FACE_MATCH_THRESHOLD` | opcional, padrão `0.65`. Distância máxima entre um rosto da foto criativa e a foto de registro. Menor = mais rígido; se adolescentes forem recusados, teste `0.7` |
| `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASS` `EMAIL_FROM` | envio do e-mail ao responsável a cada check-in (veja "E-mail para o responsável" abaixo). Sem elas, o check-in funciona e o aviso fica como `sem_config` |
| `GEOFENCE_DISABLED` | `true` = **modo teste**: pula a localização (check-in de qualquer lugar, aviso amarelo na tela). Deixe `false` no culto |
| `CHECKIN_SECRET` | gere com `openssl rand -hex 32`. Também cifra o segredo do autenticador dos líderes: **trocar este valor obriga todos os líderes a recadastrar o autenticador** (redefinir acesso) |
| `PUBLIC_APP_URL` | endereço final do app (usado no QR code) |

### 3. Rodar no computador
```bash
npm install
npm run dev
```
Abra <http://localhost:3000>. Confira a integração:

- <http://localhost:3000/api/health> deve responder `"ok": true` (variáveis, tabelas, view e bucket).
- `npm run test:fluxo` faz um cadastro e um check-in de teste no banco real e apaga tudo no final.

 Para testar no celular, use o endereço HTTPS da Vercel (a câmera e o GPS não funcionam
em `http://` fora do localhost).

### 4. Publicar na Vercel
1. Suba a pasta para um repositório no GitHub.
2. Em <https://vercel.com> → **Add New → Project** → importe o repositório.
3. Em **Environment Variables**, cadastre as mesmas variáveis do `.env.local`.
4. **Deploy**. Atualize `PUBLIC_APP_URL` com o endereço gerado (ou seu domínio).

### 5. QR code e NFC
**QR code**

Já gerado pelo próprio app: abra **https://flag-checkin.vercel.app/qrcode** para imprimir ou baixar em PNG/SVG
(imagem direta: `/api/qrcode` · `/api/qrcode?format=svg`). Para gerar localmente:
```bash
npm run qrcode -- https://SEU-APP.vercel.app
```
Gera `qrcode-checkin.png` (impressão) e `qrcode-checkin.svg` (gráfica/banner), apontando para `/checkin`.

**Tag NFC** (compre NTAG213 ou NTAG215 — adesivos ou chaveiros, poucos reais cada)
1. Instale o app gratuito **NFC Tools** (Android ou iPhone).
2. *Escrever → Adicionar registro → URL/URI* → `https://SEU-APP.vercel.app/checkin`.
3. *Escrever* e encoste a tag no celular. Opcional: *Outros → Bloquear tag* para ninguém regravar.
4. O adolescente encosta o celular na tag (no iPhone, a parte de cima do aparelho) e o link abre sozinho.

## E-mail para o responsável

A cada check-in, o responsável recebe um e-mail com o **horário** e a **foto do check-in** (veja
[a prévia](previa-email-checkin.html)). Escolha **um** provedor SMTP gratuito:

| Provedor | Limite grátis | Precisa de domínio próprio? | Configuração |
| --- | --- | --- | --- |
| **Gmail** (recomendado para começar) | ~500 e-mails/dia | não | `smtp.gmail.com` · porta `465` · usuário = o Gmail · senha = **senha de app** |
| Brevo | 300/dia | não (verifica o remetente) | `smtp-relay.brevo.com` · `587` · login e chave SMTP do painel |
| Resend | 3.000/mês | **sim**, para enviar a qualquer pessoa | `smtp.resend.com` · `465` · usuário `resend` · senha = API key |

**Gmail passo a passo** (de preferência numa conta do ministério, por exemplo `checkin.o2flag@gmail.com`):
1. Ative a **verificação em duas etapas** na conta Google.
2. Abra <https://myaccount.google.com/apppasswords>, crie uma senha de app chamada "Check-in O2" e copie as 16 letras.
3. Preencha no `.env.local` **e** na Vercel (Settings › Environment Variables):
   `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_USER=<o gmail>`, `SMTP_PASS=<senha de app>`,
   `EMAIL_FROM="Check-in O2 Flag <o gmail>"`.
4. Publique de novo (Deployments › Redeploy).

O status de cada aviso aparece na coluna `aviso_responsavel` da view `presencas`.

**Confirmação de cadastro em lote** (para quem se cadastrou antes de existir o e-mail de confirmação):
`npm run email:confirmacao` só simula e mostra quantos e-mails sairiam; `npm run email:confirmacao -- --enviar` envia
um por adolescente, com 1,5 s de intervalo. O registro fica em `logs/confirmacao-cadastro.json` (fora do git): rodar
de novo pula quem já recebeu.

## Área do pastor

Cada líder tem a própria conta: **e-mail + senha + código do app autenticador** (Google Authenticator, Microsoft
Authenticator, 1Password…). A sessão dura 12 h no aparelho. Não existe senha compartilhada.

**Primeiro líder** (uma vez só, no computador com o `.env.local`):
```bash
npm run lider:criar -- "Nome Sobrenome" email@exemplo.com
```
O comando mostra um **código de ativação** (uso único, 24 h). A pessoa abre **https://flag-checkin.vercel.app/pastor →
Ativar conta**, informa e-mail e código, cria a senha, escaneia o QR code no app autenticador e guarda os **10 códigos
de recuperação**. Os demais líderes são criados na aba **Líderes**, do mesmo jeito.

**Celular perdido:** na tela do código, "Perdi o celular" aceita um código de recuperação (cada um vale uma vez; as outras
sessões caem e um autenticador novo é cadastrado na hora). Sem códigos, **outro líder** confirma pessoalmente quem é e
usa **Redefinir acesso** na aba Líderes: sai um código de ativação novo, entregue em mãos.

- **Líderes:** criar conta, desativar (as sessões da pessoa caem na hora), reativar, redefinir acesso, encerrar sessões,
  gerar novos códigos de recuperação e o **registro de ações** (somente leitura).
- **Ao vivo:** quem fez check-in hoje, do mais recente para o mais antigo, atualizando sozinho a cada 4 s.
- **Dashboard:** encontros, média por encontro, último encontro comparado ao anterior, gráfico da frequência a cada
  culto (cadastrados e visitantes) e ranking dos 10 mais frequentes. O botão "↻ Atualizar" recarrega os números.
- **Cadastrar:** o mesmo cadastro do responsável, para cadastrar vários em sequência.

Para ver o dashboard com dados: `node scripts/simular-dashboard.mjs` cria 8 domingos simulados (adolescentes e visitantes
com o prefixo "Simulação"); `node scripts/simular-dashboard.mjs --limpar` apaga tudo depois.

Para ver o feed funcionando sem ninguém na igreja: `npm run simular` (e `node scripts/simular-checkins.mjs --limpar`
para apagar os cadastros de simulação depois).

## Ver as presenças
No Supabase: **Table Editor → `presencas`** (lista por culto, com horário, responsável e distância). Para ver uma foto,
abra **Storage → fotos** e o caminho indicado na coluna `foto_checkin` ou `foto_cadastro`. Dá para exportar em CSV pelo
próprio painel.

## Segurança e LGPD
- Banco com RLS ligado e sem políticas públicas: o navegador nunca fala direto com o banco, só com as rotas `/api`.
- Fotos em bucket privado; quando o app precisa mostrar uma foto, gera um link temporário (10 min).
- Nome inexistente e data errada dão a **mesma** mensagem, para não revelar quem está cadastrado.
- O token entre a identificação e a foto é assinado (HMAC) e vale 4 h (a foto criativa é dentro do culto); um check-in
  por pessoa por dia, e um por telefone de visitante por dia.
- O cadastro é aberto (sem senha), com validação no servidor e um campo escondido contra robôs. Não pede CPF.
- Cadastro parecido com um existente (mesmo nascimento e nome compatível) entra marcado como **possível duplicado**.
  Na aba **Líderes → Possíveis cadastros duplicados**, um líder escolhe "mesclar" (as presenças vão para o cadastro
  mais antigo e o novo é apagado) ou "são pessoas diferentes". Enquanto houver dois cadastros com o mesmo nome, o
  check-in pede o nome completo ou um líder. As duas decisões ficam no registro de ações.
- Cadastro exige marcar a autorização do responsável (dados de menores — LGPD art. 14); a data fica gravada.
- **Limites conhecidos:** GPS de celular pode ser falsificado com apps de "fake GPS" — por isso existe a foto com
  reconhecimento facial, que os líderes também podem conferir no feed do pastor. Não há limite de tentativas por IP; se precisar, adicione
  Upstash Ratelimit (grátis) nas rotas `/api/checkin/identificar` e `/api/cadastro`.

## Manutenção
Apagar selfies de check-in com mais de 6 meses (SQL Editor):
```sql
delete from storage.objects
where bucket_id = 'fotos' and name like 'checkins/%' and created_at < now() - interval '6 months';
```

## Estrutura
```
app/checkin/page.tsx              fluxo de check-in (local → nome e nascimento ou visitante → foto → sucesso)
app/cadastro/page.tsx             cadastro pelo responsável (sem foto, sem senha)
app/api/checkin/local             confere a localização
app/api/checkin/identificar       confere nome + nascimento, emite token
app/api/checkin/confirmar         foto de registro (1º) ou criativa → grava o check-in
app/api/cadastro                  grava novo adolescente
components/Brand.tsx              cabeçalho Flag (destaque) + Juventude O2
components/Camera.tsx             câmera frontal ao vivo com fallback
lib/format.ts                     telefone, datas, nomes, distância (Haversine)
lib/duplicates.ts                 possível cadastro duplicado (nome + nascimento + e-mail do responsável)
lib/server/*                      Supabase, variáveis, token e validações (só servidor)
supabase/migrations/              tabelas, view de presença e bucket
app/api/health                    diagnóstico da conexão com o Supabase
scripts/testar-fluxo.mjs          teste ponta a ponta no banco real
scripts/gerar-qrcode.mjs          gera o QR code
```

## Logo da Juventude O2
O logo do Flag está em `public/brand/flag-logo.jpg` (já traz o "O2" pequeno). O link do Instagram do logo da O2 é um
post, que não dá para baixar automaticamente: salve a imagem como `public/brand/o2-logo.png` se quiser usá-la em
algum lugar. Para trocar o logo do Flag por uma versão maior/sem fundo, substitua o arquivo mantendo o nome.
