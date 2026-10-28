-- P1: contas individuais de líder (senha + app autenticador), sessões revogáveis, limite de tentativas
-- e trilha de auditoria das ações administrativas que o app não consegue alterar nem apagar.
-- Dois tipos de acesso só: ADOLESCENTE (sessão da visita, sem senha) e LÍDER (esta tabela).
-- Tudo com RLS ligado e sem políticas: só o servidor (service_role) acessa.

create table if not exists public.leaders (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  email             text not null unique check (email = lower(email)),
  password_hash     text,                     -- scrypt; nulo até a pessoa ativar a conta
  totp_secret_enc   text,                     -- segredo do app autenticador, cifrado (AES-256-GCM)
  totp_pending_enc  text,                     -- segredo gerado no cadastro, antes de confirmar o 1º código
  totp_enabled_at   timestamptz,
  totp_last_step    bigint not null default 0, -- último código aceito: o mesmo código não vale duas vezes
  setup_code_hash   text,                     -- código de ativação/redefinição (uso único, HMAC)
  setup_expires_at  timestamptz,
  status            text not null default 'ativo' check (status in ('ativo', 'desativado')),
  created_at        timestamptz not null default now(),
  created_by        uuid references public.leaders(id),
  disabled_at       timestamptz,
  last_login_at     timestamptz
);

create table if not exists public.leader_recovery_codes (
  id         bigserial primary key,
  leader_id  uuid not null references public.leaders(id) on delete cascade,
  code_hash  text not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists leader_recovery_codes_leader_idx on public.leader_recovery_codes (leader_id);

-- Sessão no banco (o cookie guarda só um valor aleatório; aqui fica o hash dele).
-- stage: 'senha' = passou a senha, falta o código | 'cadastro_totp' = precisa cadastrar o autenticador
--        'completa' = acesso liberado. Desativar a conta ou revogar marca revoked_at e vale na hora.
create table if not exists public.leader_sessions (
  id           uuid primary key default gen_random_uuid(),
  leader_id    uuid not null references public.leaders(id) on delete cascade,
  token_hash   text not null unique,
  stage        text not null check (stage in ('senha', 'cadastro_totp', 'completa')),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  last_seen_at timestamptz,
  ip_hash      text,
  user_agent   text
);
create index if not exists leader_sessions_leader_idx on public.leader_sessions (leader_id) where revoked_at is null;

-- Limite de tentativas: contador por chave numa janela fixa. O "insert ... on conflict do update"
-- trava a linha, então requisições simultâneas e várias instâncias do servidor contam certo.
create table if not exists public.auth_rate_limits (
  key          text primary key,
  window_start timestamptz not null,
  hits         integer not null
);

create or replace function public.auth_rate_hit(p_key text, p_window_seconds integer)
returns integer
language sql
set search_path = public
as $$
  insert into public.auth_rate_limits as r (key, window_start, hits)
  values (p_key, now(), 1)
  on conflict (key) do update set
    hits         = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end,
    window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning hits;
$$;
revoke all on function public.auth_rate_hit(text, integer) from public, anon, authenticated;
grant execute on function public.auth_rate_hit(text, integer) to service_role;

-- Trilha das ações administrativas e de autenticação dos líderes.
-- Sem chave estrangeira: o registro sobrevive a qualquer mudança nas contas. Nunca guarda senha,
-- código do autenticador, código de recuperação ou dado biométrico.
create table if not exists public.admin_audit (
  id           bigserial primary key,
  at           timestamptz not null default now(),
  actor_id     uuid,          -- líder que agiu (nulo: tentativa sem sessão, ex. login errado)
  actor_name   text,
  action       text not null, -- login, conta_criada, conta_desativada, sessoes_revogadas, totp_cadastrado, ...
  target_type  text,          -- lider | checkin | sessao
  target_id    text,
  target_label text,
  outcome      text not null, -- ok | negado | bloqueado | erro
  details      jsonb,
  ip_hash      text
);
create index if not exists admin_audit_at_idx on public.admin_audit (at desc);

create or replace function public.audit_imutavel()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Única exceção: apagar um adolescente zera o member_id em audit_events (on delete set null).
  if tg_table_name = 'audit_events' and tg_op = 'UPDATE' then
    if new.member_id is null
       and (new.id, new.at, new.event, new.outcome, new.ip_hash, new.user_agent, new.lat, new.lng)
           is not distinct from (old.id, old.at, old.event, old.outcome, old.ip_hash, old.user_agent, old.lat, old.lng) then
      return new;
    end if;
  end if;
  raise exception 'Registros de auditoria não podem ser alterados nem apagados (%).', tg_table_name
    using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists admin_audit_imutavel on public.admin_audit;
create trigger admin_audit_imutavel before update or delete on public.admin_audit
  for each row execute function public.audit_imutavel();
drop trigger if exists admin_audit_sem_truncate on public.admin_audit;
create trigger admin_audit_sem_truncate before truncate on public.admin_audit
  for each statement execute function public.audit_imutavel();

drop trigger if exists audit_events_imutavel on public.audit_events;
create trigger audit_events_imutavel before update or delete on public.audit_events
  for each row execute function public.audit_imutavel();
drop trigger if exists audit_events_sem_truncate on public.audit_events;
create trigger audit_events_sem_truncate before truncate on public.audit_events
  for each statement execute function public.audit_imutavel();

-- Pela API, ninguém além do servidor; e nem o servidor edita ou apaga auditoria.
revoke update, delete, truncate on public.admin_audit, public.audit_events from anon, authenticated, service_role;

alter table public.leaders               enable row level security;
alter table public.leader_recovery_codes enable row level security;
alter table public.leader_sessions       enable row level security;
alter table public.auth_rate_limits      enable row level security;
alter table public.admin_audit           enable row level security;
