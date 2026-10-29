-- P1 · Remover o CPF (etapa 1 de 2) e sinalizar possíveis cadastros duplicados.
--
-- O check-in usa nome + data de nascimento e as presenças apontam para members.id: o CPF não é
-- necessário. Esta etapa é compatível com a versão anterior do app (que ainda envia CPF):
--   1. tira a obrigatoriedade e a unicidade do CPF;
--   2. apaga os CPFs já guardados;
--   3. cria a marcação de "possível duplicado" para revisão de um líder.
-- A etapa 2 (20261029120000_remover_coluna_cpf.sql) apaga a coluna depois que a versão nova estiver no ar.

alter table public.members alter column cpf drop not null;
alter table public.members drop constraint if exists members_cpf_key;
update public.members set cpf = null where cpf is not null;

-- Cadastro parecido com um já existente (mesmo nascimento e nome compatível). Um líder revisa:
-- "são pessoas diferentes" limpa a marcação; "mesclar" junta as presenças no cadastro original.
alter table public.members
  add column if not exists possible_duplicate_of uuid references public.members(id) on delete set null;
create index if not exists members_possible_duplicate_idx
  on public.members (possible_duplicate_of) where possible_duplicate_of is not null;

-- Mescla atômica do cadastro duplicado no original. Devolve os caminhos de foto que ficaram sem uso
-- (o servidor apaga do Storage). IDs e histórico do cadastro original ficam intactos.
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

  -- Presença no mesmo culto nos dois cadastros: vale a do original; a do duplicado sai com a foto.
  select coalesce(array_agg(c.photo_path) filter (where c.photo_path is not null), '{}')
    into sobras
    from public.checkins c
   where c.member_id = p_duplicado
     and exists (select 1 from public.checkins o where o.member_id = p_original and o.service_date = c.service_date);
  delete from public.checkins c
   where c.member_id = p_duplicado
     and exists (select 1 from public.checkins o where o.member_id = p_original and o.service_date = c.service_date);
  update public.checkins set member_id = p_original where member_id = p_duplicado;

  -- Foto de referência: o original fica com a dele; se não tiver, herda a do duplicado.
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
