# Operação: fornecedores, acessos e incidentes

## Fornecedores (operadores)

| Fornecedor | O que faz | Dados que passam por ele | Onde | Referência |
| --- | --- | --- | --- | --- |
| **Supabase** | Banco de dados (Postgres) e armazenamento das fotos | Todos os dados do app | São Paulo (`sa-east-1`), projeto `kcmlgoffvympjalsrwdn`. Criptografia em repouso e TLS | [supabase.com/security](https://supabase.com/security) |
| **Vercel** | Hospeda o site e as rotas `/api` (onde o rosto é comparado) | Todos os dados em trânsito. Não guarda os dados, só logs curtos de requisição | Funções em **São Paulo** (`gru1`, fixado em `vercel.json` neste PR; antes, o padrão era Washington, `iad1`) | [vercel.com/docs/security/compliance](https://vercel.com/docs/security/compliance) |
| **Google (Gmail, SMTP)** | Envia a confirmação de cadastro e os avisos de check-in | Nome do adolescente, nome e e-mail do responsável, horário. A caixa de saída guarda uma cópia | Infraestrutura global do Google (transferência internacional, LGPD art. 33) | Termos do Google Workspace/Gmail |
| **GitHub** | Código-fonte | Nenhum dado pessoal de adolescentes. Os testes usam só rostos sintéticos | — | — |

Nenhum dado é vendido nem compartilhado com terceiros além destes. O reconhecimento facial roda no nosso servidor, com
uma biblioteca de código aberto (`@vladmandic/face-api`), sem serviço externo de reconhecimento.

## Quem tem acesso

| Acesso | Quem | Como é protegido |
| --- | --- | --- |
| App (`/pastor`) | Líderes da O2, cada um com conta própria | Senha e app autenticador (TOTP) obrigatórios, sessões revogáveis, registro de ações. Ver [P1-contas-de-lider.md](../seguranca/P1-contas-de-lider.md) |
| Painel do Supabase (dados brutos, fotos, backups) | Só o administrador técnico (hoje, Pedro Vilarinho) | Conta pessoal com 2FA (conferir que está ligado). **A chave `service_role` dá acesso total** e fica só na Vercel e no `.env.local` |
| Painel da Vercel (variáveis de ambiente, logs) | Só o administrador técnico | Conta pessoal com 2FA (conferir que está ligado) |
| Conta Gmail que envia os e-mails | Administrador técnico | Senha de app (`SMTP_PASS`) e 2FA na conta Google |
| Repositório GitHub | Administrador técnico e revisores | Nenhum segredo commitado. Busca por segredos antes de cada commit |

Revisar essa lista a cada 6 meses e sempre que alguém sair da liderança: desativar a conta de líder (aba Líderes), e,
se a pessoa tinha acesso técnico, trocar `SUPABASE_SERVICE_ROLE_KEY`, `CHECKIN_SECRET` e `SMTP_PASS`.

## Incidentes

Incidente é qualquer acesso indevido, vazamento, perda ou alteração de dados pessoais. Por exemplo: chave vazada,
celular de líder perdido com sessão aberta, e-mail enviado ao responsável errado, foto exposta.

1. **Conter (na hora).** Encerrar sessões e desativar contas de líder pela aba Líderes. Se uma chave vazou, girar na
   Vercel e no Supabase. Trocar `CHECKIN_SECRET` invalida todos os tokens de check-in, cookies de visita e
   segredos TOTP (os líderes recadastram o autenticador). Tirar do ar uma rota afetada, se preciso.
2. **Avaliar (até 24 h).** O que vazou, de quantas pessoas, desde quando. Fontes: `admin_audit` (ações dos líderes),
   `audit_events` (tentativas de check-in, 90 dias), logs da Vercel e do Supabase.
3. **Comunicar (até 3 dias úteis).** Se o incidente pode causar risco ou dano relevante, e com dados de adolescentes e
   biometria a presunção é que sim, comunicar a **ANPD** e as **famílias afetadas**, conforme o Regulamento de
   Comunicação de Incidente de Segurança (Resolução CD/ANPD nº 15/2024). A comunicação diz o que aconteceu, quais dados,
   os riscos, o que foi feito e o contato.
4. **Registrar.** Guardar o registro do incidente (o que, quando, decisões, comunicações) por pelo menos 5 anos, mesmo
   que não tenha sido comunicado.
5. **Corrigir e revisar.** Abrir um PR com a correção e o relatório em `docs/seguranca/`, como nos itens P0 e P1.

Contatos: dono do processo de privacidade ([pedidos-das-familias.md](pedidos-das-familias.md)) e administrador técnico.

## Tarefas pendentes

Manuais e fora do código, ligadas a este item:

- [ ] Definir o **encarregado** (nome e e-mail de privacidade) e configurar `PRIVACY_OWNER` e `PRIVACY_EMAIL`.
- [ ] **Revisão jurídica** ([revisao-juridica.md](revisao-juridica.md)).
- [ ] Na conta Gmail que envia: apagar os avisos de check-in **com foto** já enviados (busca
      `in:sent has:attachment "chegou ao culto"`) e esvaziar a lixeira. Depois, manter a caixa de saída por no máximo 30 dias.
- [ ] Apagar `logs/confirmacao-cadastro.json` da máquina que rodou o envio em lote (ele tem e-mails de responsáveis).
- [ ] Conferir no painel do Supabase o plano e a janela de backup, e anotar aqui.
- [ ] Adicionar `CRON_SECRET` na Vercel. Sem ele, a limpeza diária não roda.
