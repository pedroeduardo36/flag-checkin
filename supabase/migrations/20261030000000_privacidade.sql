-- P1 · Privacy rules and data minimization (issue #1, item 4).
--
-- 1. Guardian email verification: the email owner confirms the registration and gives consent,
--    including the specific consent for facial biometrics (LGPD art. 11 and 14). Without it, no check-in.
-- 2. Coordinates: the app now stores only the distance to the church.
-- 3. Retention: expurgar_dados() applies the periods in docs/privacy/data-inventory.md. Photo files are
--    deleted through a durable queue (photo_deletions), retried until Storage confirms.
-- 4. Merging duplicates keeps a confirmed guardian and its consent evidence.
--
-- This migration deletes no data. Deletion is done by expurgar_dados(), which runs daily (Vercel Cron)
-- and can be dry-run first: select public.expurgar_dados(true);

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

-- Same atomic registration as 20261029060000, now storing the consent text version. verify_by = null:
-- a new registration only checks in after the email owner confirms.
create or replace function public.cadastrar_membro(p_dados jsonb, p_vistos uuid[], p_duplicado_de uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  nasc date := (p_dados->>'birth_date')::date;
  novo uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('cadastro:' || nasc::text, 0));

  if exists (select 1 from public.members m where m.birth_date = nasc and not (m.id = any (coalesce(p_vistos, '{}'))))
     or (p_duplicado_de is not null and not exists (select 1 from public.members m where m.id = p_duplicado_de)) then
    raise exception 'CADASTRO_CONCORRENTE' using errcode = '40001';
  end if;

  insert into public.members
    (name, phone, birth_date, guardian_name, guardian_phone, guardian_email, guardian_email2, guardian_consent_at,
     consent_version, verify_by, possible_duplicate_of)
  values
    (p_dados->>'name', nullif(p_dados->>'phone', ''), nasc, p_dados->>'guardian_name', p_dados->>'guardian_phone',
     p_dados->>'guardian_email', nullif(p_dados->>'guardian_email2', ''), now(),
     p_dados->>'consent_version', null, p_duplicado_de)
  returning id into novo;
  return novo;
end;
$$;

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
  -- The purge clears the precise coordinates of older entries (the distance stays). Nothing else may change.
  if tg_table_name = 'audit_events' and tg_op = 'UPDATE' and current_setting('app.expurgo', true) = 'on'
     and new.lat is null and new.lng is null
     and to_jsonb(new) - 'lat' - 'lng' = to_jsonb(old) - 'lat' - 'lng' then
    return new;
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

-- A leader deactivated for 2 years is deleted by the purge. Accounts they created stay, without the reference
-- (the creation itself stays in admin_audit).
alter table public.leaders drop constraint if exists leaders_created_by_fkey;
alter table public.leaders
  add constraint leaders_created_by_fkey foreign key (created_by) references public.leaders(id) on delete set null;

-- Photo files to delete from Storage. Whatever removes a photo from the database queues its path in the same
-- transaction; the server deletes the files and drops the row only once Storage confirms, retrying otherwise.
create table if not exists public.photo_deletions (
  path       text primary key,
  reason     text not null,
  queued_at  timestamptz not null default now(),
  attempts   integer not null default 0,
  last_error text
);
alter table public.photo_deletions enable row level security;

create or replace function public.agendar_exclusao_fotos(p_caminhos text[], p_motivo text)
returns integer
language sql
security definer
set search_path = public
as $$
  with novos as (
    insert into public.photo_deletions (path, reason)
    select distinct c, p_motivo from unnest(coalesce(p_caminhos, '{}')) c where c is not null
    on conflict (path) do nothing
    returning 1
  )
  select count(*)::integer from novos;
$$;

-- A failed Storage deletion: the path stays queued, with the attempt counted for monitoring.
create or replace function public.registrar_falha_exclusao_fotos(p_caminhos text[], p_erro text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.photo_deletions set attempts = attempts + 1, last_error = p_erro where path = any (p_caminhos);
$$;

-- Deletes a whole registration (family request or refusal): data, descriptor, attendances (cascade) and,
-- through the queue, every photo. Returns the number of photos queued, or null if it doesn't exist.
create or replace function public.apagar_cadastro(p_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  caminhos text[];
begin
  perform 1 from public.members where id = p_id for update;
  if not found then return null; end if;
  select coalesce(array_agg(c) filter (where c is not null), '{}') into caminhos from (
    select photo_path c from public.members where id = p_id
    union all
    select photo_path from public.checkins where member_id = p_id
  ) x;
  update public.members set possible_duplicate_of = null where possible_duplicate_of = p_id;
  delete from public.members where id = p_id;
  perform public.agendar_exclusao_fotos(caminhos, 'cadastro_apagado');
  return cardinality(caminhos);
end;
$$;

-- Withdraws biometrics: clears the reference photo, the descriptor and the consent, and queues the photo.
create or replace function public.revogar_biometria(p_id uuid, p_versao text, p_prazo date)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  caminho text;
begin
  select photo_path into caminho from public.members where id = p_id for update;
  if not found then return false; end if;
  update public.members
     set photo_path = null, face_descriptor = null, biometric_consent_at = null, guardian_email_verified_at = null,
         consent_version = p_versao, verify_by = p_prazo
   where id = p_id;
  perform public.agendar_exclusao_fotos(array[caminho], 'biometria_revogada');
  return true;
end;
$$;

-- Merge of a duplicate into the original (replaces the 20261029000000 version). Besides attendances and the
-- reference photo, the guardian contact and consent travel as ONE block, never an address with another
-- address's verification: if only the duplicate was confirmed, the original takes its guardian block, so the
-- surviving registration can check in and isn't purged as unconfirmed. Confirmation links (consent evidence)
-- move to the original instead of cascading away. Unused photos are queued for deletion and also returned.
create or replace function public.mesclar_cadastro(p_duplicado uuid, p_original uuid)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  dup public.members%rowtype;
  orig public.members%rowtype;
  sobras text[];
  prazo_orig date;
  prazo_dup date;
begin
  if p_duplicado = p_original then
    raise exception 'Cadastro duplicado e original são o mesmo';
  end if;
  select * into orig from public.members where id = p_original for update;
  if not found then raise exception 'Cadastro original não existe'; end if;
  select * into dup from public.members where id = p_duplicado for update;
  if not found then raise exception 'Cadastro duplicado não existe'; end if;

  -- Attendance on the same service in both registrations: the original's wins; the duplicate's goes with its photo.
  select coalesce(array_agg(c.photo_path) filter (where c.photo_path is not null), '{}')
    into sobras
    from public.checkins c
   where c.member_id = p_duplicado
     and exists (select 1 from public.checkins o where o.member_id = p_original and o.service_date = c.service_date);
  delete from public.checkins c
   where c.member_id = p_duplicado
     and exists (select 1 from public.checkins o where o.member_id = p_original and o.service_date = c.service_date);
  update public.checkins set member_id = p_original where member_id = p_duplicado;

  -- Reference photo: the original keeps its own; if it has none, it inherits the duplicate's.
  if orig.face_descriptor is null and dup.face_descriptor is not null then
    update public.members set photo_path = dup.photo_path, face_descriptor = dup.face_descriptor where id = p_original;
    if orig.photo_path is not null then sobras := sobras || orig.photo_path; end if;
  elsif dup.photo_path is not null then
    sobras := sobras || dup.photo_path;
  end if;

  if orig.guardian_email_verified_at is null and dup.guardian_email_verified_at is not null then
    update public.members
       set guardian_name = dup.guardian_name, guardian_phone = dup.guardian_phone,
           guardian_email = dup.guardian_email, guardian_email_verified_at = dup.guardian_email_verified_at,
           guardian_email2 = dup.guardian_email2, guardian_email2_verified_at = dup.guardian_email2_verified_at,
           guardian_consent_at = dup.guardian_consent_at, biometric_consent_at = dup.biometric_consent_at,
           consent_version = dup.consent_version, verify_by = null
     where id = p_original;
  elsif orig.guardian_email_verified_at is null then
    -- Neither confirmed: keep the later deadline, so merging doesn't bring the purge forward.
    prazo_orig := coalesce(orig.verify_by, (orig.created_at at time zone 'America/Sao_Paulo')::date + 7);
    prazo_dup := coalesce(dup.verify_by, (dup.created_at at time zone 'America/Sao_Paulo')::date + 7);
    update public.members set verify_by = greatest(prazo_orig, prazo_dup) where id = p_original;
  end if;
  update public.guardian_verifications set member_id = p_original where member_id = p_duplicado;

  update public.members set possible_duplicate_of = p_original where possible_duplicate_of = p_duplicado;
  delete from public.members where id = p_duplicado;
  perform public.agendar_exclusao_fotos(sobras, 'cadastro_mesclado');
  return sobras;
end;
$$;

-- Applies the retention periods. Returns what it did; the photo files go to the photo_deletions queue.
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

  r := r || jsonb_build_object('fotos', cardinality(fotos));
  perform public.agendar_exclusao_fotos(fotos, 'retencao');
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
revoke execute on function public.agendar_exclusao_fotos(text[], text) from public, anon, authenticated;
grant execute on function public.agendar_exclusao_fotos(text[], text) to service_role;
revoke execute on function public.registrar_falha_exclusao_fotos(text[], text) from public, anon, authenticated;
grant execute on function public.registrar_falha_exclusao_fotos(text[], text) to service_role;
revoke execute on function public.apagar_cadastro(uuid) from public, anon, authenticated;
grant execute on function public.apagar_cadastro(uuid) to service_role;
revoke execute on function public.revogar_biometria(uuid, text, date) from public, anon, authenticated;
grant execute on function public.revogar_biometria(uuid, text, date) to service_role;
revoke execute on function public.mesclar_cadastro(uuid, uuid) from public, anon, authenticated;
grant execute on function public.mesclar_cadastro(uuid, uuid) to service_role;
revoke execute on function public.cadastrar_membro(jsonb, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.cadastrar_membro(jsonb, uuid[], uuid) to service_role;
