-- P2: checkout pelo navegador. A saída é gravada NA MESMA linha do check-in, em colunas próprias:
-- o registro de presença (horário de chegada, foto, distância, rosto) não muda, e confirmar de novo
-- não cria outra linha. Nada grava a saída sozinho: sem confirmação, a saída fica "não registrada".

alter table public.checkins add column if not exists checked_out_at       timestamptz; -- horário da saída (do servidor, ou o informado pelo líder na correção)
alter table public.checkins add column if not exists checkout_by          text;        -- participante | lider
alter table public.checkins add column if not exists checkout_leader_id   uuid references public.leaders(id) on delete set null;
alter table public.checkins add column if not exists checkout_recorded_at timestamptz; -- quando a saída foi gravada ou desfeita (o feed acompanha por aqui)
alter table public.checkins add column if not exists checkout_distance_m  real;        -- só a distância até a igreja, se o celular informou
alter table public.checkins add column if not exists checkout_email_status text;

alter table public.checkins drop constraint if exists checkins_checkout_valido;
alter table public.checkins add constraint checkins_checkout_valido check (
  (checked_out_at is null and checkout_by is null and checkout_leader_id is null and checkout_distance_m is null)
  or (checked_out_at is not null and checked_out_at >= checked_in_at
      and (checkout_by = 'participante' and checkout_leader_id is null or checkout_by = 'lider'))
);

-- Feed ao vivo: "o que mudou desde X" (check-ins novos ou saídas gravadas/desfeitas).
create index if not exists checkins_checkout_recorded_idx on public.checkins (service_date, checkout_recorded_at);

-- Lista de presença no Table Editor ganha a saída.
drop view if exists public.presencas;
create view public.presencas
with (security_invoker = true) as
select c.service_date            as culto,
       to_char(c.checked_in_at at time zone 'America/Sao_Paulo', 'HH24:MI') as horario,
       coalesce(to_char(c.checked_out_at at time zone 'America/Sao_Paulo', 'HH24:MI'), 'não registrada') as saida,
       c.checkout_by             as saida_confirmada_por,
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
