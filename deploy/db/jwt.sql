-- FILE: deploy/db/jwt.sql
-- PURPOSE: Store the JWT settings on the postgres database on first boot. Same
--          as supabase/docker volumes/db/jwt.sql.
\set jwt_secret `echo "$JWT_SECRET"`
\set jwt_exp `echo "$JWT_EXP"`

ALTER DATABASE postgres SET "app.settings.jwt_secret" TO :'jwt_secret';
ALTER DATABASE postgres SET "app.settings.jwt_exp" TO :'jwt_exp';
