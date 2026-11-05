-- P1 · Remove the CPF (step 1 of 2) and flag possible duplicate registrations.
--
-- Check-in uses name + birth date and attendances point to members.id: the CPF (Brazilian tax ID) isn't
-- needed. This step is compatible with the previous app version (which still sends a CPF):
--   1. drops the CPF's not-null and unique constraints;
--   2. deletes the CPFs already stored;
--   3. adds the "possible duplicate" flag for a leader to review.
-- Step 2 (20261029120000_remover_coluna_cpf.sql) drops the column once the new version is live.

alter table public.members alter column cpf drop not null;
alter table public.members drop constraint if exists members_cpf_key;
update public.members set cpf = null where cpf is not null;

-- Registration similar to an existing one (same birth date and a compatible name). A leader reviews it:
-- "different people" clears the flag; "merge" moves the attendances to the original registration.
alter table public.members
  add column if not exists possible_duplicate_of uuid references public.members(id) on delete set null;
create index if not exists members_possible_duplicate_idx
  on public.members (possible_duplicate_of) where possible_duplicate_of is not null;

-- Atomic merge of the duplicate registration into the original. Returns the photo paths left unused
-- (the server deletes them from Storage). The original's ids and history stay intact.
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

  update public.members set possible_duplicate_of = p_original where possible_duplicate_of = p_duplicado;
  delete from public.members where id = p_duplicado;
  return sobras;
end;
$$;

revoke execute on function public.mesclar_cadastro(uuid, uuid) from public, anon, authenticated;
grant execute on function public.mesclar_cadastro(uuid, uuid) to service_role;
