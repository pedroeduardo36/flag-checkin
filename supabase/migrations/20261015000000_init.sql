-- Check-in Flag · Juventude O2 — schema inicial
-- Apply with "npx supabase db push" (CLI) or paste into the Supabase SQL Editor and click Run.

create extension if not exists pgcrypto;

-- Adolescentes cadastrados
create table if not exists public.members (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  cpf                 char(11) not null unique,          -- digits only
  phone               text not null,
  birth_date          date not null,
  photo_path          text not null,                      -- path inside the "fotos" bucket
  guardian_name       text not null,
  guardian_phone      text not null,
  guardian_consent_at timestamptz not null,               -- guardian authorization (LGPD art. 14)
  created_at          timestamptz not null default now()
);

-- One check-in per teen per service day
create table if not exists public.checkins (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references public.members(id) on delete cascade,
  service_date  date not null,                            -- date in the Brasília time zone
  checked_in_at timestamptz not null default now(),
  latitude      double precision not null,
  longitude     double precision not null,
  accuracy_m    real,
  distance_m    real,
  photo_path    text not null,                            -- selfie antifraude
  user_agent    text,
  unique (member_id, service_date)
);
create index if not exists checkins_service_date_idx on public.checkins (service_date);

-- RLS on and NO policies: only the server (service_role) reads and writes.
-- Nobody can reach the data with the public "anon" key.
alter table public.members  enable row level security;
alter table public.checkins enable row level security;

-- Ready-made attendance list for leaders (Table Editor > presencas)
create or replace view public.presencas
with (security_invoker = true) as
select c.service_date            as culto,
       to_char(c.checked_in_at at time zone 'America/Sao_Paulo', 'HH24:MI') as horario,
       m.name                    as nome,
       m.phone                   as telefone,
       m.guardian_name           as responsavel,
       m.guardian_phone          as telefone_responsavel,
       round(c.distance_m)       as distancia_m,
       c.photo_path              as selfie,
       m.photo_path              as foto_cadastro
from public.checkins c
join public.members m on m.id = c.member_id
order by c.service_date desc, c.checked_in_at;

-- PRIVATE bucket for photos (access only through signed URLs generated on the server)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', false, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
