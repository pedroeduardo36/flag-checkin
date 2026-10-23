-- Segundo e-mail (opcional) do responsável: os dois recebem o aviso de check-in.
alter table public.members add column if not exists guardian_email2 text
  check (guardian_email2 is null or guardian_email2 ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');

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
       m.guardian_email2         as email_responsavel_2,
       c.guardian_email_status   as aviso_responsavel,
       c.photo_kind              as tipo_foto,
       round(c.distance_m)       as distancia_m,
       round(c.face_distance::numeric, 3) as distancia_rosto,
       c.photo_path              as foto_checkin,
       m.photo_path              as foto_cadastro
from public.checkins c
left join public.members m on m.id = c.member_id
order by c.service_date desc, c.checked_in_at;
