-- FILE: deploy/db/roles.sql
-- PURPOSE: Give Supabase's service roles the stack's POSTGRES_PASSWORD on first
--          boot, so Auth, PostgREST and Storage can connect. Same as
--          supabase/docker volumes/db/roles.sql, minus supabase_functions_admin:
--          that role comes from supabase/docker's webhooks.sql, which this stack
--          does not mount (no migration uses supabase_functions), so altering
--          it would fail the init. Runs once, on an empty volume.
\set pgpass `echo "$POSTGRES_PASSWORD"`

ALTER USER authenticator WITH PASSWORD :'pgpass';
ALTER USER pgbouncer WITH PASSWORD :'pgpass';
ALTER USER supabase_auth_admin WITH PASSWORD :'pgpass';
ALTER USER supabase_storage_admin WITH PASSWORD :'pgpass';
