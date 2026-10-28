-- Trilha de auditoria das rotas públicas de check-in (resposta ao P0: os logs da Vercel Hobby e do
-- Supabase Free não guardavam o suficiente para investigar abusos). Só o servidor lê e grava (RLS sem políticas).
create table if not exists public.audit_events (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  event      text not null,          -- identificar | confirmar
  outcome    text not null,          -- token | detalhes_visita | NAO_ENCONTRADO | FORA_DO_LOCAL | ROSTO_NAO_CONFERE | ok | DUPLICADO ...
  member_id  uuid references public.members(id) on delete set null,
  ip_hash    text,                   -- HMAC do IP (nunca o IP em claro)
  user_agent text,
  lat        double precision,
  lng        double precision
);
create index if not exists audit_events_at_idx on public.audit_events (at desc);
create index if not exists audit_events_member_idx on public.audit_events (member_id, at desc);
alter table public.audit_events enable row level security;
