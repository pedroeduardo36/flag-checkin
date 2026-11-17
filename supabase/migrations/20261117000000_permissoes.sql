-- Least privilege for the Data API roles. The app only talks to the database with service_role, from the
-- server. RLS already hid every row from anon/authenticated, but the default grants still allowed TRUNCATE
-- (which RLS doesn't cover) and kept every future table open to them. Functions keep their own grants.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
