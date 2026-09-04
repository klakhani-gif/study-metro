-- Run in the Supabase SQL editor if the existing table does not already have
-- equivalent constraints, owner-only RLS, grants and a version-update trigger.
-- No rows are deleted or replaced. The transaction fails safely for incompatible data.
begin;

create table if not exists public.user_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);
create unique index if not exists study_metro_user_state_owner on public.user_state(user_id);
alter table public.user_state alter column user_id set not null;
alter table public.user_state alter column state set not null;
alter table public.user_state alter column updated_at set not null;
alter table public.user_state enable row level security;
revoke all on public.user_state from anon;
revoke delete, truncate, references, trigger on public.user_state from authenticated;
grant select, insert, update on public.user_state to authenticated;

-- The restrictive boundary also constrains any pre-existing permissive policies.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_state' and policyname='study_metro_owner_boundary') then
    create policy study_metro_owner_boundary on public.user_state as restrictive
      for all to public using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_state' and policyname='study_metro_read_own') then
    create policy study_metro_read_own on public.user_state for select to authenticated using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_state' and policyname='study_metro_insert_own') then
    create policy study_metro_insert_own on public.user_state for insert to authenticated with check ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_state' and policyname='study_metro_update_own') then
    create policy study_metro_update_own on public.user_state for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
end $$;

-- updated_at is a concurrency token, not just a display date. Every writer,
-- including SQL/dashboard edits, must advance it. No security-definer privileges.
create or replace function public.study_metro_advance_state_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  return new;
end;
$$;
drop trigger if exists study_metro_state_version on public.user_state;
create trigger study_metro_state_version before update on public.user_state
for each row execute function public.study_metro_advance_state_version();

commit;
