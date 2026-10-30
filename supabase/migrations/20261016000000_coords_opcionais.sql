-- Allows check-in without coordinates when GEOFENCE_DISABLED=true (test mode).
-- In production the server still requires the location.
alter table public.checkins alter column latitude  drop not null;
alter table public.checkins alter column longitude drop not null;
