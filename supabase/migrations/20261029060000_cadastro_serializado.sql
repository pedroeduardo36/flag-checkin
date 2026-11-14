-- P1 · Registration without CPF: make the duplicate decision and the insert atomic.
--
-- Without the CPF's unique constraint, the server decides "new / possible duplicate / resubmission" by
-- comparing names in TypeScript and then inserts. Two simultaneous submissions could both read before
-- either inserted, decide "nothing similar" and create two unflagged registrations (mentor review on #2).
--
-- This function makes the insert conditional on that decision still holding: it serializes
-- registrations with the same birth date (transaction-scoped advisory lock) and refuses with
-- CADASTRO_CONCORRENTE (SQLSTATE 40001) when a same-day registration exists that the server didn't see,
-- or when the registration it flagged as the original is gone. The server then reads and decides again.

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
    (name, phone, birth_date, guardian_name, guardian_phone, guardian_email, guardian_email2, guardian_consent_at, possible_duplicate_of)
  values
    (p_dados->>'name', nullif(p_dados->>'phone', ''), nasc, p_dados->>'guardian_name', p_dados->>'guardian_phone',
     p_dados->>'guardian_email', nullif(p_dados->>'guardian_email2', ''), now(), p_duplicado_de)
  returning id into novo;
  return novo;
end;
$$;

revoke execute on function public.cadastrar_membro(jsonb, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.cadastrar_membro(jsonb, uuid[], uuid) to service_role;
