-- Permite check-in sem coordenadas quando GEOFENCE_DISABLED=true (modo teste).
-- Em produção o servidor continua exigindo a localização.
alter table public.checkins alter column latitude  drop not null;
alter table public.checkins alter column longitude drop not null;
