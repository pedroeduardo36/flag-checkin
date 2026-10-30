-- The first check-in now has two photos: the REGISTRATION one (goes to the registration) and the CREATIVE one
-- (goes to the check-in). This column flags the teen's first check-in ever for the feed.
alter table public.checkins add column if not exists is_first boolean not null default false;
update public.checkins set is_first = true where photo_kind = 'registro';
