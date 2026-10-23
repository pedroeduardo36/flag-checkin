-- O 1º check-in agora tem duas fotos: a de REGISTRO (vai para o cadastro) e a CRIATIVA (vai
-- para o check-in). Este campo marca o primeiro check-in da vida do adolescente para o feed.
alter table public.checkins add column if not exists is_first boolean not null default false;
update public.checkins set is_first = true where photo_kind = 'registro';
