-- Apply in Supabase SQL Editor. Preserves existing compatible profiles.
begin;
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text,
  bio text not null default '',
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[a-z0-9_]{3,20}$'),
  constraint profiles_display_name_length check (char_length(display_name) <= 40),
  constraint profiles_bio_length check (char_length(bio) <= 240)
);
create unique index if not exists profiles_username_unique_lower on public.profiles(lower(username));
create unique index if not exists profiles_one_per_user on public.profiles(user_id);
alter table public.profiles alter column user_id set not null;
alter table public.profiles alter column username set not null;
alter table public.profiles alter column bio set not null;
alter table public.profiles alter column is_public set not null;
alter table public.profiles alter column created_at set not null;
alter table public.profiles alter column updated_at set not null;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.profiles'::regclass and conname='profiles_username_format') then alter table public.profiles add constraint profiles_username_format check(username~'^[a-z0-9_]{3,20}$'); end if;
  if not exists(select 1 from pg_constraint where conrelid='public.profiles'::regclass and conname='profiles_display_name_length') then alter table public.profiles add constraint profiles_display_name_length check(char_length(display_name)<=40); end if;
  if not exists(select 1 from pg_constraint where conrelid='public.profiles'::regclass and conname='profiles_bio_length') then alter table public.profiles add constraint profiles_bio_length check(char_length(bio)<=240); end if;
end $$;
alter table public.profiles enable row level security;
revoke all on public.profiles from anon;
revoke delete, truncate, references, trigger on public.profiles from authenticated;
grant select, insert, update on public.profiles to authenticated;
drop policy if exists study_metro_profile_owner_boundary on public.profiles;
create policy study_metro_profile_owner_boundary on public.profiles as restrictive for all to public
  using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
do $$ begin
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='study_metro_profile_read_own') then
    create policy study_metro_profile_read_own on public.profiles for select to authenticated using ((select auth.uid())=user_id);
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='study_metro_profile_insert_own') then
    create policy study_metro_profile_insert_own on public.profiles for insert to authenticated with check ((select auth.uid())=user_id);
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='study_metro_profile_update_own') then
    create policy study_metro_profile_update_own on public.profiles for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
  end if;
end $$;
create or replace function public.study_metro_profile_updated_at() returns trigger language plpgsql set search_path='' as $$ begin new.updated_at:=greatest(clock_timestamp(),old.updated_at+interval '1 microsecond');new.username:=old.username;new.user_id:=old.user_id;new.created_at:=old.created_at;return new;end;$$;
drop trigger if exists study_metro_profile_timestamp on public.profiles;
create trigger study_metro_profile_timestamp before update on public.profiles for each row execute function public.study_metro_profile_updated_at();

-- Public API returns only approved identity fields and aggregate stats. It never returns email,
-- bio, exams, station names, journey details, notes, timetable records or the state document.
create or replace function public.get_study_metro_public_profile(lookup_username text)
returns table(username text,display_name text,is_public boolean,joined_at timestamptz,focus_seconds bigint,journeys bigint,completed_stations bigint,subject_lines text[])
language sql stable security definer set search_path='' as $$
  select p.username,
    case when p.is_public then coalesce(nullif(p.display_name,''),p.username) end,
    p.is_public,
    case when p.is_public then p.created_at end,
    case when p.is_public then coalesce((select sum((j->>'focusedSeconds')::bigint) from jsonb_array_elements(case when jsonb_typeof(s.state->'history')='array' then s.state->'history' else '[]'::jsonb end) j where (j->>'focusedSeconds')~'^[0-9]+$' and length(j->>'focusedSeconds')<=18),0) end,
    case when p.is_public then jsonb_array_length(case when jsonb_typeof(s.state->'history')='array' then s.state->'history' else '[]'::jsonb end)::bigint end,
    case when p.is_public then coalesce((select count(*) from jsonb_array_elements(case when jsonb_typeof(s.state->'stations')='array' then s.state->'stations' else '[]'::jsonb end) st where st->>'status' in ('completed','mastered','revision_due')),0) end,
    case when p.is_public then coalesce((select array_agg(left(l->>'name',40) order by ord) from jsonb_array_elements(case when jsonb_typeof(s.state->'lines')='array' then s.state->'lines' else '[]'::jsonb end) with ordinality as lines(l,ord) where nullif(l->>'name','') is not null),array[]::text[]) end
  from public.profiles p left join public.user_state s on s.user_id=p.user_id
  where p.username=lookup_username limit 1;
$$;
revoke all on function public.get_study_metro_public_profile(text) from public;
grant execute on function public.get_study_metro_public_profile(text) to anon,authenticated;
commit;
