-- Novo fluxo:
-- 1) O responsável cadastra o adolescente antes do culto, SEM foto. A foto de referência
--    é tirada no primeiro check-in (members.photo_path / face_descriptor ficam vazios até lá).
-- 2) O check-in identifica por nome completo + data de nascimento.
-- 3) Visitantes fazem check-in só com nome e telefone (foto criativa opcional).

alter table public.members alter column photo_path drop not null;
alter table public.members alter column phone drop not null;
create index if not exists members_birth_date_idx on public.members (birth_date);

-- Check-in de visitante: sem membro, com nome e telefone próprios.
alter table public.checkins alter column member_id drop not null;
alter table public.checkins alter column photo_path drop not null;
alter table public.checkins add column if not exists visitor_name text;
alter table public.checkins add column if not exists visitor_phone text;
alter table public.checkins add column if not exists photo_kind text
  check (photo_kind is null or photo_kind in ('registro', 'criativa'));
alter table public.checkins drop constraint if exists checkins_member_ou_visitante;
alter table public.checkins add constraint checkins_member_ou_visitante
  check ((member_id is not null and visitor_name is null) or (member_id is null and visitor_name is not null and visitor_phone is not null));

-- Um check-in por visitante (telefone) por dia.
create unique index if not exists checkins_visitante_dia_idx
  on public.checkins (visitor_phone, service_date) where member_id is null;

drop view if exists public.presencas;
create view public.presencas
with (security_invoker = true) as
select c.service_date            as culto,
       to_char(c.checked_in_at at time zone 'America/Sao_Paulo', 'HH24:MI') as horario,
       case when c.member_id is null then 'visitante' else 'cadastrado' end as tipo,
       coalesce(m.name, c.visitor_name)   as nome,
       coalesce(m.phone, c.visitor_phone) as telefone,
       m.guardian_name           as responsavel,
       m.guardian_phone          as telefone_responsavel,
       m.guardian_email          as email_responsavel,
       c.guardian_email_status   as aviso_responsavel,
       c.photo_kind              as tipo_foto,
       round(c.distance_m)       as distancia_m,
       round(c.face_distance::numeric, 3) as distancia_rosto,
       c.photo_path              as foto_checkin,
       m.photo_path              as foto_cadastro
from public.checkins c
left join public.members m on m.id = c.member_id
order by c.service_date desc, c.checked_in_at;
