-- E-mail do responsável e registro do aviso de check-in enviado a ele.

alter table public.members add column if not exists guardian_email text
  check (guardian_email is null or guardian_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');

-- enviado | falhou | sem_email (cadastro antigo) | sem_config (SMTP não configurado)
alter table public.checkins add column if not exists guardian_email_status text;
alter table public.checkins add column if not exists guardian_email_at timestamptz;

drop view if exists public.presencas;
create view public.presencas
with (security_invoker = true) as
select c.service_date            as culto,
       to_char(c.checked_in_at at time zone 'America/Sao_Paulo', 'HH24:MI') as horario,
       m.name                    as nome,
       m.phone                   as telefone,
       m.guardian_name           as responsavel,
       m.guardian_phone          as telefone_responsavel,
       m.guardian_email          as email_responsavel,
       c.guardian_email_status   as aviso_responsavel,
       round(c.distance_m)       as distancia_m,
       round(c.face_distance::numeric, 3) as distancia_rosto,
       c.photo_path              as selfie,
       m.photo_path              as foto_cadastro
from public.checkins c
join public.members m on m.id = c.member_id
order by c.service_date desc, c.checked_in_at;
