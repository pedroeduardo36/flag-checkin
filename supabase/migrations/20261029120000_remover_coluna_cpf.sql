-- P1 · Remover o CPF (etapa 2 de 2): apaga a coluna.
-- Aplicar SÓ DEPOIS que a versão sem CPF estiver no ar: a versão anterior ainda grava CPF no cadastro.
-- Os valores já foram apagados na etapa 1 (20261029000000_cpf_opcional_duplicados.sql).
-- Ids, presenças e fotos não mudam. Nenhuma view usa a coluna (presencas nunca incluiu CPF).

alter table public.members drop column if exists cpf;
