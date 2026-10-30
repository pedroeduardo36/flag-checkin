-- P1 · Privacy rules and data minimization (issue #1, item 4).
--
-- 1. Guardian email verification: the email owner confirms the registration and gives consent,
--    including the specific consent for facial biometrics (LGPD art. 11 and 14). Without it, no check-in.
-- 2. Coordinates: the app now stores only the distance to the church.
-- 3. Retention: expurgar_dados() applies the periods in docs/privacy/data-inventory.md.
--
-- This migration deletes no data. Deletion is done by expurgar_dados(), which runs daily (Vercel Cron)
-- e pode ser simulada antes: select public.expurgar_dados(true);

-- ---------- 1. Verification and consent ----------
alter table public.members
  add column if not exists guardian_email_verified_at  timestamptz,
  add column if not exists guardian_email2_verified_at timestamptz,
  add column if not exists biometric_consent_at        timestamptz, -- specific consent, given by the email owner
  add column if not exists consent_version             text,
  -- Deadline to confirm. Registrations older than this version (legacy consent, which didn't explain
  -- biometrics) can check in until the deadline; new ones (the app writes null) only after confirming.
  -- The default covers anyone registering through the previous app version until this one is deployed.
  add column if not exists verify_by                   date default (current_date + 30);

update public.members set verify_by = date '2026-11-30'
 where guardian_email_verified_at is null and (verify_by is null or verify_by > date '2026-11-30');

create table if not exists public.guardian_verifications (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references public.members(id) on delete cascade,
  email      text not null,
  token_hash text not null unique,  -- sha256 of the link token; the token only exists in the email
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz
);
create index if not exists guardian_verifications_member_idx on public.guardian_verifications (member_id);
alter table public.guardian_verifications enable row level security;

-- ---------- 2. Distance instead of coordinates in the check-in audit ----------
alter table public.audit_events add column if not exists distance_m real;

-- ---------- 3. Retention ----------
-- The audit trail stays immutable for the app. The only exception is the retention purge done by
-- expurgar_dados() (which sets app.expurgo only inside its own transaction), and only for expired entries.
create or replace function public.audit_imutavel()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' and current_setting('app.expurgo', true) = 'on' then
    if tg_table_name = 'audit_events' then
      if old.at < now() - interval '90 days' then return old; end if;
    elsif tg_table_name = 'admin_audit' then
      if old.at < now() - interval '2 years' then return old; end if;
    end if;
  end if;
  -- Deleting a teen nulls member_id in audit_events (on delete set null).
  if tg_table_name = 'audit_events' and tg_op = 'UPDATE' then
    if new.member_id is null
       and (new.id, new.at, new.event, new.outcome, new.ip_hash, new.user_agent, new.lat, new.lng, new.distance_m)
           is not distinct from (old.id, old.at, old.event, old.outcome, old.ip_hash, old.user_agent, old.lat, old.lng, old.distance_m) then
      return new;
    end if;
  end if;
  raise exception 'Registros de auditoria não podem ser alterados nem apagados (%).', tg_table_name
    using errcode = 'insufficient_privilege';
end;
$$;

-- Applies the retention periods. Returns what it did and the photo paths for the server to delete from Storage.
-- p_simular = true: does everything, counts and rolls back (nothing changes). Use it to check before the real run.
create or replace function public.expurgar_dados(p_simular boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb := '{}';
  fotos text[] := '{}';
  tmp text[];
  n integer;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  detalhe text;
begin
  perform set_config('app.expurgo', 'on', true);

  -- Precise coordinates: not stored (the distance is enough). Clears any that still exist.
  update public.checkins set latitude = null, longitude = null where latitude is not null or longitude is not null;
  get diagnostics n = row_count;
  r := r || jsonb_build_object('coordenadas_checkin', n);
  update public.audit_events set lat = null, lng = null where lat is not null or lng is not null;
  get diagnostics n = row_count;
  r := r || jsonb_build_object('coordenadas_auditoria', n);

  -- Creative check-in photo: 30 days (the attendance stays; only the photo goes).
  with alvo as (
    select id, photo_path from public.checkins
     where photo_path is not null and not is_example and service_date < hoje - 30
  ), upd as (
    update public.checkins c set photo_path = null, user_agent = null from alvo where c.id = alvo.id returning alvo.photo_path
  )
  select coalesce(array_agg(photo_path), '{}') into tmp from upd;
  fotos := fotos || tmp;
  r := r || jsonb_build_object('fotos_checkin', cardinality(tmp));
  update public.checkins set user_agent = null where user_agent is not null and service_date < hoje - 30;

  -- Visitor (name, phone, optional photo): 180 days.
  with del as (
    delete from public.checkins where member_id is null and not is_example and service_date < hoje - 180 returning photo_path
  )
  select coalesce(array_agg(photo_path) filter (where photo_path is not null), '{}'), count(*) into tmp, n from del;
  fotos := fotos || tmp;
  r := r || jsonb_build_object('visitantes', n);

  -- Registration: not confirmed by the guardian in time, or no attendance for 12 months.
  -- Removed entirely: data, reference photo, face descriptor and attendances (cascade).
  create temporary table alvo_cadastro on commit drop as
  select m.id,
         m.guardian_email_verified_at is null
           and coalesce(m.verify_by, (m.created_at at time zone 'America/Sao_Paulo')::date + 7) < hoje as sem_confirmacao
    from public.members m
   where not exists (select 1 from public.checkins e where e.member_id = m.id and e.is_example)
     and ((m.guardian_email_verified_at is null
           and coalesce(m.verify_by, (m.created_at at time zone 'America/Sao_Paulo')::date + 7) < hoje)
       or (m.created_at < now() - interval '12 months'
           and not exists (select 1 from public.checkins c where c.member_id = m.id and c.service_date >= hoje - 365)));
  select coalesce(array_agg(p), '{}') into tmp from (
    select photo_path as p from public.members where id in (select id from alvo_cadastro) and photo_path is not null
    union all
    select photo_path from public.checkins where member_id in (select id from alvo_cadastro) and photo_path is not null
  ) x;
  fotos := fotos || tmp;
  r := r || jsonb_build_object(
    'cadastros_sem_confirmacao', (select count(*) from alvo_cadastro where sem_confirmacao),
    'cadastros_inativos', (select count(*) from alvo_cadastro where not sem_confirmacao));
  update public.members set possible_duplicate_of = null where possible_duplicate_of in (select id from alvo_cadastro);
  delete from public.members where id in (select id from alvo_cadastro);

  -- Technical logs.
  delete from public.audit_events where at < now() - interval '90 days';
  get diagnostics n = row_count;
  r := r || jsonb_build_object('auditoria_checkin', n);
  delete from public.admin_audit where at < now() - interval '2 years';
  get diagnostics n = row_count;
  r := r || jsonb_build_object('auditoria_lideres', n);
  delete from public.auth_rate_limits where window_start < now() - interval '1 day';
  delete from public.leaders where status = 'desativado' and disabled_at < now() - interval '2 years';
  delete from public.leader_sessions where coalesce(revoked_at, expires_at) < now() - interval '30 days';
  delete from public.guardian_verifications where coalesce(used_at, expires_at) < now() - interval '30 days';

  r := r || jsonb_build_object('fotos', to_jsonb(fotos));
  if p_simular then
    raise exception 'expurgo_simulado' using detail = r::text;
  end if;
  return r;
exception
  when raise_exception then
    if sqlerrm = 'expurgo_simulado' then
      get stacked diagnostics detalhe = pg_exception_detail;
      return detalhe::jsonb || '{"simulacao": true}';
    end if;
    raise;
end;
$$;

revoke execute on function public.expurgar_dados(boolean) from public, anon, authenticated;
grant execute on function public.expurgar_dados(boolean) to service_role;
