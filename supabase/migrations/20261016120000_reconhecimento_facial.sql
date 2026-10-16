-- Reconhecimento facial: descritor do rosto do cadastro e distância medida em cada check-in.

-- Vetor de 128 números gerado pelo FaceRecognitionNet a partir da foto do cadastro.
-- Fica só no servidor (RLS sem políticas), nunca é enviado ao navegador.
alter table public.members
  add column if not exists face_descriptor real[]
  check (face_descriptor is null or array_length(face_descriptor, 1) = 128);

-- Distância euclidiana entre a selfie do check-in e o cadastro (menor = mais parecido).
alter table public.checkins add column if not exists face_distance real;

-- Mostra a distância na lista de presença, para auditoria dos líderes.
-- (drop + create: a coluna nova muda a ordem das colunas da view)
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
