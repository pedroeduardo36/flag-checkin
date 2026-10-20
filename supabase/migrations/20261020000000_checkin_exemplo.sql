-- Check-in de exemplo: aparece sempre no feed do pastor (etiqueta "Exemplo"),
-- fora do contador do dia. Serve para demonstrar e testar a área do pastor.
alter table public.checkins add column if not exists is_example boolean not null default false;
create index if not exists checkins_is_example_idx on public.checkins (is_example) where is_example;
