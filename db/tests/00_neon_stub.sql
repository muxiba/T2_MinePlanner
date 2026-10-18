-- Simula, num Postgres comum, o que o Neon fornece: auth.user_id() (lê o JWT) e neon_auth."user".
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role anonymous nologin; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create or replace function auth.user_id() returns text language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '') $$;
grant usage on schema auth to authenticated, anonymous;
grant execute on function auth.user_id() to authenticated, anonymous;
create schema if not exists neon_auth;
create table if not exists neon_auth."user" (id uuid primary key, name text, email text not null);
