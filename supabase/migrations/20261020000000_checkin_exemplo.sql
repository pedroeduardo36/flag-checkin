-- Example check-in: always shown in the pastor's feed ("Exemplo" tag),
-- not counted in the day's total. Used to demo and test the pastor area.
alter table public.checkins add column if not exists is_example boolean not null default false;
create index if not exists checkins_is_example_idx on public.checkins (is_example) where is_example;
