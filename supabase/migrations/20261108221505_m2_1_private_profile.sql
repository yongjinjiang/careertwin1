-- CareerTwin1 M2.1: private Profile schema, minimal runtime role and owner isolation.
-- Business data is reachable only through the server API, which connects as careertwin1_app
-- and binds the verified Supabase user ID per transaction:
--   begin; select set_config('app.user_id', '<verified uuid>', true); ...; commit;
-- The role is created NOLOGIN here. Its LOGIN/password is set out-of-band from private config,
-- never in a migration: alter role careertwin1_app with login password '...';

create schema careertwin1_private;
revoke all on schema careertwin1_private from public;
revoke all on schema careertwin1_private from anon, authenticated, service_role;

-- A pre-existing role with unknown attributes or memberships is refused rather than reused.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'careertwin1_app') then
    raise exception 'role careertwin1_app already exists; inspect it before applying this migration';
  end if;
end
$$;
create role careertwin1_app nologin noinherit;

-- Verified user of the current transaction; NULL (no rows, no writes) when unbound.
create function careertwin1_private.current_owner_id() returns uuid
  language sql stable
  set search_path = ''
  as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;
revoke all on function careertwin1_private.current_owner_id() from public;

create table careertwin1_private.profile_state (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  -- Whole-Profile version; compare-and-set writes arrive in M2.2.
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now()
);

create table careertwin1_private.profile_records (
  owner_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  type text not null check (type in ('project', 'basic_info')),
  format_version integer not null default 1 check (format_version = 1),
  display_name text not null,
  original_text text not null,
  organization text,
  start_year integer check (start_year between 1000 and 9999),
  end_year integer check (end_year between 1000 and 9999),
  is_current boolean not null default false,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (owner_id, id),
  constraint profile_records_type_shape check (
    (type = 'project' and id ~ '^project:.+$')
    -- IS NOT DISTINCT FROM: a NULL organization must fail, not pass as UNKNOWN.
    or (type = 'basic_info' and id = 'basic_info' and display_name = 'Basic Info'
        and organization is not distinct from 'basic info' and start_year is null and end_year is null and not is_current)
  ),
  constraint profile_records_current_has_no_end check (not is_current or end_year is null),
  constraint profile_records_year_order check (start_year is null or end_year is null or start_year <= end_year)
);
-- At most one Basic Info per user (the fixed id already implies it; this states it explicitly).
create unique index profile_records_one_basic_info on careertwin1_private.profile_records (owner_id) where type = 'basic_info';

alter table careertwin1_private.profile_state enable row level security;
alter table careertwin1_private.profile_state force row level security;
alter table careertwin1_private.profile_records enable row level security;
alter table careertwin1_private.profile_records force row level security;

revoke all on all tables in schema careertwin1_private from public, anon, authenticated, service_role;

grant usage on schema careertwin1_private to careertwin1_app;
grant execute on function careertwin1_private.current_owner_id() to careertwin1_app;
grant select, insert, update, delete on careertwin1_private.profile_state to careertwin1_app;
grant select, insert, update, delete on careertwin1_private.profile_records to careertwin1_app;

create policy profile_state_select on careertwin1_private.profile_state for select to careertwin1_app
  using (owner_id = careertwin1_private.current_owner_id());
create policy profile_state_insert on careertwin1_private.profile_state for insert to careertwin1_app
  with check (owner_id = careertwin1_private.current_owner_id());
create policy profile_state_update on careertwin1_private.profile_state for update to careertwin1_app
  using (owner_id = careertwin1_private.current_owner_id())
  with check (owner_id = careertwin1_private.current_owner_id());
create policy profile_state_delete on careertwin1_private.profile_state for delete to careertwin1_app
  using (owner_id = careertwin1_private.current_owner_id());

create policy profile_records_select on careertwin1_private.profile_records for select to careertwin1_app
  using (owner_id = careertwin1_private.current_owner_id());
create policy profile_records_insert on careertwin1_private.profile_records for insert to careertwin1_app
  with check (owner_id = careertwin1_private.current_owner_id());
create policy profile_records_update on careertwin1_private.profile_records for update to careertwin1_app
  using (owner_id = careertwin1_private.current_owner_id())
  with check (owner_id = careertwin1_private.current_owner_id());
create policy profile_records_delete on careertwin1_private.profile_records for delete to careertwin1_app
  using (owner_id = careertwin1_private.current_owner_id());
