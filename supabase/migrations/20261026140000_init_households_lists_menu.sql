-- Private schema for helpers that should not be exposed via the API
create schema if not exists private;
grant usage on schema private to authenticated;

-- Profiles ---------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now()
);

-- Households -------------------------------------------------------------
create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  invite_code text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index households_created_by_idx on public.households(created_by);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index household_members_user_id_idx on public.household_members(user_id);

-- Shopping list ----------------------------------------------------------
create table public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  quantity text check (char_length(quantity) <= 40),
  category text check (char_length(category) <= 40),
  checked boolean not null default false,
  checked_by uuid references auth.users(id) on delete set null,
  checked_at timestamptz,
  added_by uuid default auth.uid() references auth.users(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create index shopping_items_household_idx on public.shopping_items(household_id, archived_at);
create index shopping_items_added_by_idx on public.shopping_items(added_by);
create index shopping_items_checked_by_idx on public.shopping_items(checked_by);

-- Weekly menu ------------------------------------------------------------
create table public.meal_plan (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  day date not null,
  title text not null check (char_length(title) between 1 and 120),
  notes text check (char_length(notes) <= 500),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index meal_plan_household_day_idx on public.meal_plan(household_id, day);
create index meal_plan_created_by_idx on public.meal_plan(created_by);

-- Helpers ----------------------------------------------------------------
create or replace function private.is_household_member(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = hid and m.user_id = (select auth.uid())
  );
$$;
revoke execute on function private.is_household_member(uuid) from public, anon;
grant execute on function private.is_household_member(uuid) to authenticated;

-- New auth user -> profile row
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke execute on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- RPC: create a household and become its owner
create or replace function public.create_household(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Niet ingelogd';
  end if;
  insert into public.households (name, created_by)
  values (trim(p_name), v_uid)
  returning id into v_id;
  insert into public.household_members (household_id, user_id, role)
  values (v_id, v_uid, 'owner');
  return v_id;
end;
$$;
revoke execute on function public.create_household(text) from public, anon;
grant execute on function public.create_household(text) to authenticated;

-- RPC: join a household with its invite code
create or replace function public.join_household(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Niet ingelogd';
  end if;
  select id into v_id from public.households where invite_code = lower(trim(p_code));
  if v_id is null then
    raise exception 'Ongeldige uitnodigingscode';
  end if;
  insert into public.household_members (household_id, user_id)
  values (v_id, v_uid)
  on conflict do nothing;
  return v_id;
end;
$$;
revoke execute on function public.join_household(text) from public, anon;
grant execute on function public.join_household(text) to authenticated;

-- Row Level Security -----------------------------------------------------
alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.shopping_items enable row level security;
alter table public.meal_plan enable row level security;

create policy "profiles_select_self_or_housemates" on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1
      from public.household_members a
      join public.household_members b on a.household_id = b.household_id
      where a.user_id = (select auth.uid()) and b.user_id = profiles.id
    )
  );
create policy "profiles_update_self" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "households_select_members" on public.households
  for select to authenticated
  using (private.is_household_member(id));
create policy "households_update_owner" on public.households
  for update to authenticated
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));
create policy "households_delete_owner" on public.households
  for delete to authenticated
  using (created_by = (select auth.uid()));

create policy "members_select_members" on public.household_members
  for select to authenticated
  using (private.is_household_member(household_id));
create policy "members_delete_self" on public.household_members
  for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "items_all_members" on public.shopping_items
  for all to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));

create policy "meals_all_members" on public.meal_plan
  for all to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));

-- Realtime ---------------------------------------------------------------
alter publication supabase_realtime add table public.shopping_items, public.meal_plan;
