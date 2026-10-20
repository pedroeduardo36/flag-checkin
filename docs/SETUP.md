# Guia de instalação e operação

App web (abre no navegador do celular, sem instalar nada) para o check-in dos adolescentes na chegada ao culto.

```
QR code / tag NFC ──► /checkin
   1. Localização  → confere se o celular está dentro do raio da igreja
   2. CPF + nascimento → confere com o cadastro
   3. Selfie ao vivo (antifraude) → grava o check-in + foto
   4. Tela de sucesso com a foto e o horário

Não tem cadastro? ──► /cadastro
   Nome, CPF, telefone, nascimento, foto, responsável + telefone,
   autorização do responsável (LGPD) e SENHA DO FISCAL para liberar.
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
| `FACE_MATCH_THRESHOLD` | opcional, padrão `0.55`. Distância máxima entre a selfie e a foto do cadastro. Menor = mais rígido; se pessoas reais forem recusadas, teste `0.6` |
| `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASS` `EMAIL_FROM` | envio do e-mail ao responsável a cada check-in (veja "E-mail para o responsável" abaixo). Sem elas, o check-in funciona e o aviso fica como `sem_config` |
| `GEOFENCE_DISABLED` | `true` = **modo teste**: pula a localização (check-in de qualquer lugar, aviso amarelo na tela). Deixe `false` no culto |
| `REGISTRATION_PASSWORD` | senha que o fiscal digita para liberar cada cadastro |
| `PASTOR_PASSWORD` | senha da área do pastor (`/pastor`): feed ao vivo dos check-ins e cadastro sem a senha do fiscal |
| `CHECKIN_SECRET` | gere com `openssl rand -hex 32` |
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

## Área do pastor

Abra **https://flag-checkin.vercel.app/pastor** e entre com a senha `PASTOR_PASSWORD`. A sessão dura 12 h no aparelho.
- **Ao vivo:** quem fez check-in hoje, do mais recente para o mais antigo, atualizando sozinho a cada 4 s.
- **Cadastrar:** cadastra adolescentes sem precisar da senha do fiscal.

Para ver o feed funcionando sem ninguém na igreja: `npm run simular` (e `node scripts/simular-checkins.mjs --limpar`
para apagar os cadastros de simulação depois).

## Ver as presenças
No Supabase: **Table Editor → `presencas`** (lista por culto, com horário, responsável e distância). Para ver uma foto,
abra **Storage → fotos** e o caminho indicado na coluna `selfie` ou `foto_cadastro`. Dá para exportar em CSV pelo
próprio painel.

## Segurança e LGPD
- Banco com RLS ligado e sem políticas públicas: o navegador nunca fala direto com o banco, só com as rotas `/api`.
- Fotos em bucket privado; quando o app precisa mostrar uma foto, gera um link temporário (10 min).
- CPF inexistente e data errada dão a **mesma** mensagem, para não revelar quem está cadastrado.
- O token entre "CPF" e "selfie" é assinado (HMAC) e vale 5 minutos; um check-in por pessoa por dia.
- A senha do fiscal é conferida no servidor, com comparação em tempo constante.
- Cadastro exige marcar a autorização do responsável (dados de menores — LGPD art. 14); a data fica gravada.
- **Limites conhecidos:** GPS de celular pode ser falsificado com apps de "fake GPS" — por isso existe a selfie, que o
  fiscal pode comparar com a foto do cadastro. Não há limite de tentativas por IP; se precisar, adicione
  Upstash Ratelimit (grátis) nas rotas `/api/checkin/identificar` e `/api/cadastro`.

## Manutenção
Apagar selfies de check-in com mais de 6 meses (SQL Editor):
```sql
delete from storage.objects
where bucket_id = 'fotos' and name like 'checkins/%' and created_at < now() - interval '6 months';
```

## Estrutura
```
app/checkin/page.tsx              fluxo de check-in (local → dados → selfie → sucesso)
app/cadastro/page.tsx             cadastro com senha do fiscal
app/api/checkin/local             confere a localização
app/api/checkin/identificar       confere CPF + nascimento, emite token
app/api/checkin/confirmar         recebe a selfie e grava o check-in
app/api/cadastro                  grava novo adolescente
components/Brand.tsx              cabeçalho Flag (destaque) + Juventude O2
components/Camera.tsx             câmera frontal ao vivo com fallback
lib/format.ts                     CPF, telefone, datas, distância (Haversine)
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
