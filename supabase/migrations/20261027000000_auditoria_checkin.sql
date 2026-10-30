-- Audit trail for the public check-in routes (response to P0: Vercel Hobby and Supabase Free logs
-- didn't keep enough to investigate abuse). Only the server reads and writes (RLS without policies).
create table if not exists public.audit_events (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  event      text not null,          -- identificar | confirmar
  outcome    text not null,          -- token | detalhes_visita | NAO_ENCONTRADO | FORA_DO_LOCAL | ROSTO_NAO_CONFERE | ok | DUPLICADO ...
  member_id  uuid references public.members(id) on delete set null,
  ip_hash    text,                   -- HMAC of the IP (never the raw IP)
  user_agent text,
  lat        double precision,
  lng        double precision
);
create index if not exists audit_events_at_idx on public.audit_events (at desc);
create index if not exists audit_events_member_idx on public.audit_events (member_id, at desc);
alter table public.audit_events enable row level security;
