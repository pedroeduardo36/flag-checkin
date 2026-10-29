# Inventário de dados: finalidade e retenção

Cada dado que o app coleta, para que serve e quando sai. Os prazos são aplicados por `public.expurgar_dados()`, que roda
todo dia às 03:00 de Brasília (Vercel Cron → `/api/cron/retencao`). Os mesmos números aparecem para as famílias em
[`/privacidade`](../../app/privacidade/page.tsx) e estão em [`lib/privacy.ts`](../../lib/privacy.ts). Mudou um prazo,
mude os três.

A coluna **base legal** é a hipótese que propomos. Quem confirma é a revisão jurídica
([revisao-juridica.md](revisao-juridica.md)).

## Cadastro do adolescente (`members`)

| Dado | Finalidade | Base legal proposta | Retenção |
| --- | --- | --- | --- |
| `name`, `birth_date` | Encontrar o cadastro no check-in (nome + nascimento) e evitar duplicados | Consentimento do responsável (LGPD art. 14, §1º) | Enquanto o cadastro existir |
| `phone` (opcional) | Contato com o adolescente | Consentimento | Enquanto o cadastro existir |
| `guardian_name`, `guardian_phone` | Identificar e contatar o responsável | Consentimento | Enquanto o cadastro existir |
| `guardian_email`, `guardian_email2` | Confirmação do cadastro, avisos de check-in e atendimento de pedidos | Consentimento | Enquanto o cadastro existir. O segundo e-mail sai se quem o recebe recusar o link |
| `guardian_consent_at`, `biometric_consent_at`, `consent_version`, `guardian_email*_verified_at` | Provar quando e em que versão do texto o dono do e-mail consentiu | Cumprimento de obrigação (art. 8º, §2º: o ônus da prova é do controlador) | Enquanto o cadastro existir |
| `verify_by` | Prazo para a confirmação | Mesma do cadastro | Até a confirmação |
| `photo_path` (foto de registro) | Referência para o reconhecimento facial | **Consentimento específico e destacado** (art. 11, I, e art. 14, §1º) | Enquanto o cadastro existir, ou até o responsável retirar a biometria |
| `face_descriptor` (128 números) | Conferir que quem faz o check-in é o próprio adolescente | **Consentimento específico e destacado** | Igual à foto de registro |
| `possible_duplicate_of` | Revisão de cadastro duplicado por um líder | Legítimo interesse do controlador na qualidade dos dados (a validar) | Até a revisão |
| `created_at` | Prazos de retenção | Mesma do cadastro | Enquanto o cadastro existir |

**O cadastro sai inteiro** (dados, foto de registro, descritor, presenças e fotos de check-in):

- se o responsável não confirmar em **7 dias**. Para os cadastros anteriores a esta versão, o prazo é **30/11/2026**;
- quando o adolescente fica **12 meses** sem nenhuma presença;
- quando o responsável pede, ou recusa pelo link.

## Presença (`checkins`)

| Dado | Finalidade | Retenção |
| --- | --- | --- |
| `member_id`, `service_date`, `checked_in_at`, `is_first` | Controle de presença, feed e painel dos líderes | Enquanto o cadastro existir |
| `distance_m`, `accuracy_m` | Provar que o check-in foi feito no local (cerca geográfica) | Enquanto o cadastro existir |
| `latitude`, `longitude` | **Não são mais gravadas.** As antigas são apagadas no primeiro expurgo | — |
| `photo_path` (foto criativa), `photo_kind` | Mostrar aos líderes quem chegou. Pode ter outros adolescentes | **Foto: 30 dias.** O registro da presença continua |
| `face_distance` | Auditoria da conferência do rosto (só um número, não é biometria) | Enquanto o cadastro existir |
| `user_agent` | Investigar abuso | 30 dias |
| `guardian_email_status`, `guardian_email_at` | Saber se o aviso foi entregue | Enquanto o cadastro existir |
| `checked_out_at`, `checkout_by`, `checkout_leader_id`, `checkout_recorded_at` | Saída do culto (checkout): horário, se foi o adolescente ou um líder que registrou, e quando | Enquanto o cadastro existir |
| `checkout_distance_m` | Distância até a igreja na hora da saída, só se o celular já tinha permissão de localização. Não bloqueia a saída | Enquanto o cadastro existir |
| `checkout_email_status` | Saber se o aviso de saída foi entregue | Enquanto o cadastro existir |
| Visitante: `visitor_name`, `visitor_phone`, foto opcional | Registrar a visita | **180 dias** |

## Registros técnicos

| Tabela | Conteúdo | Retenção |
| --- | --- | --- |
| `audit_events` | Tentativas de check-in: resultado, cadastro, IP como HMAC, navegador e **distância** (não guarda mais coordenadas) | **90 dias** |
| `admin_audit` | Ações dos líderes, consentimentos, exportações e exclusões. Não guarda nome do adolescente, senha, código nem biometria | **2 anos** |
| `guardian_verifications` | Hash do link de confirmação, e-mail, validade | 30 dias depois de usado ou vencido |
| `auth_rate_limits` | Contadores de tentativa (chave com e-mail do líder ou IP como HMAC) | 1 dia |
| `leaders`, `leader_recovery_codes` | Conta de líder: nome, e-mail, hash da senha (scrypt), segredo TOTP cifrado | Enquanto ativa. **Desativada: 2 anos** |
| `leader_sessions` | Sessões dos líderes (hash do token, navegador) | 30 dias depois de vencida ou revogada |

## Fora do banco

| Onde | O que há | Retenção / ação |
| --- | --- | --- |
| Storage `fotos` (Supabase) | Fotos de registro e de check-in | Saem junto com o registro no banco (o expurgo devolve os caminhos e o servidor apaga) |
| **Backups do Supabase** | Cópia diária do banco | Janela do plano: nenhum no Free, 7 dias no Pro, 14 no Team, até 30 no Enterprise. Não restaure um backup sem rodar `npm run retencao -- --aplicar` logo depois |
| Caixa de saída do Gmail que envia (`EMAIL_FROM`) | Cópia de cada e-mail enviado. **Os avisos antigos tinham a foto anexada** | Apagar os avisos com foto já enviados (ver [operacao-e-incidentes.md](operacao-e-incidentes.md#tarefas-pendentes)). Daqui em diante, os avisos são só texto. Manter a caixa de saída por no máximo 30 dias |
| Caixa de entrada dos responsáveis | Avisos recebidos | Fora do nosso controle. Por isso os avisos novos não têm foto |
| Logs da Vercel | Requisições (sem corpo) | Expiram sozinhos (Hobby: cerca de 1 hora; Pro: 1 dia) |
| `logs/` na máquina de quem roda scripts | Resultado dos envios em lote | `logs/verificacao.json` guarda só ids. O antigo `logs/confirmacao-cadastro.json` tinha e-mails: apagar |
| Arquivo exportado por um líder | Dados de um cadastro, para atender um pedido de acesso | Enviar só ao responsável e apagar a cópia local em seguida |
