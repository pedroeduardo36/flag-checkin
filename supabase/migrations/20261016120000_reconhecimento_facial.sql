-- Face recognition: the registration's face descriptor and the distance measured at each check-in.

-- 128-number vector produced by FaceRecognitionNet from the registration photo.
-- It stays on the server (RLS without policies) and is never sent to the browser.
alter table public.members
  add column if not exists face_descriptor real[]
  check (face_descriptor is null or array_length(face_descriptor, 1) = 128);

-- Euclidean distance between the check-in selfie and the registration (lower = more alike).
alter table public.checkins add column if not exists face_distance real;

-- Shows the distance in the attendance list, for leaders to audit.
-- (drop + create: the new column changes the view's column order)
drop view if exists public.presencas;
create view public.presencas
with (security_invoker = true) as
select c.service_date            as culto,
       to_char(c.checked_in_at at time zone 'America/Sao_Paulo', 'HH24:MI') as horario,
       m.name                    as nome,
       m.phone                   as telefone,
       m.guardian_name           as responsavel,
       m.guardian_phone          as telefone_responsavel,
       round(c.distance_m)       as distancia_m,
       round(c.face_distance::numeric, 3) as distancia_rosto,
       c.photo_path              as selfie,
       m.photo_path              as foto_cadastro
from public.checkins c
join public.members m on m.id = c.member_id
order by c.service_date desc, c.checked_in_at;
