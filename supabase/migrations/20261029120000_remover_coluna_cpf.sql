-- P1 · Remove the CPF (step 2 of 2): drops the column.
-- Apply ONLY AFTER the CPF-free version is live: the previous version still writes a CPF on registration.
-- The values were already deleted in step 1 (20261029000000_cpf_opcional_duplicados.sql).
-- Ids, attendances and photos don't change. No view uses the column (presencas never included the CPF).

alter table public.members drop column if exists cpf;
