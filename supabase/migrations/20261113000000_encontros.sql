-- Service schedule. Check-in only opens on a scheduled day (the server's service date, São Paulo time),
-- so a test or a stray check-in on another day doesn't create a service on the dashboard.
-- To add a service: Table Editor → encontros → Insert row, or
--   insert into public.encontros (service_date) values ('2026-12-05');

create table if not exists public.encontros (
  service_date date primary key,
  created_at   timestamptz not null default now()
);
alter table public.encontros enable row level security;
revoke all on public.encontros from anon, authenticated;

-- Services already held, and the ones planned until the end of 2026.
insert into public.encontros (service_date) values
  ('2026-10-23'), ('2026-11-06'), ('2026-11-20'), ('2026-11-28')
on conflict (service_date) do nothing;
