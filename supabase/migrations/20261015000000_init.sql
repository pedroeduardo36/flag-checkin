-- Check-in Flag · Juventude O2 — schema inicial
-- Aplicar: "npx supabase db push" (CLI) ou colar no SQL Editor do Supabase e clicar em Run.

create extension if not exists pgcrypto;

-- Adolescentes cadastrados
create table if not exists public.members (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  cpf                 char(11) not null unique,          -- só dígitos
  phone               text not null,
  birth_date          date not null,
  photo_path          text not null,                      -- caminho no bucket "fotos"
  guardian_name       text not null,
  guardian_phone      text not null,
  guardian_consent_at timestamptz not null,               -- autorização do responsável (LGPD art. 14)
  created_at          timestamptz not null default now()
);

-- Um check-in por adolescente por dia de culto
create table if not exists public.checkins (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references public.members(id) on delete cascade,
  service_date  date not null,                            -- data no fuso de Brasília
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

-- RLS ligado e SEM políticas: só o servidor (service_role) lê e grava.
-- Ninguém consegue acessar os dados com a chave pública "anon".
alter table public.members  enable row level security;
alter table public.checkins enable row level security;

-- Lista de presença pronta para os líderes (Table Editor > presencas)
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

-- Bucket PRIVADO para as fotos (acesso só por URL assinada gerada no servidor)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', false, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
