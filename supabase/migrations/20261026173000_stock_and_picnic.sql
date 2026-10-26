-- Voorraad per plek, en Picnic-bezorgingen die je controleert voor ze in de voorraad gaan.

-- Locations ----------------------------------------------------------------
create table public.locations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 40),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  constraint locations_household_name_key unique (household_id, name)
);

-- Stock --------------------------------------------------------------------
create table public.stock_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  name text not null check (char_length(trim(name)) between 1 and 120),
  unit text check (char_length(unit) <= 40),
  quantity int not null default 1 check (quantity between 0 and 999),
  best_before date,
  picnic_article_id text,
  image_id text,
  added_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index stock_items_household_idx on public.stock_items(household_id);
create index stock_items_location_idx on public.stock_items(location_id);
create index stock_items_added_by_idx on public.stock_items(added_by);

alter table public.shopping_items add column picnic_article_id text;

-- Picnic -------------------------------------------------------------------
create table public.picnic_links (
  household_id uuid primary key references public.households(id) on delete cascade,
  account_email text,
  status text not null default 'connected' check (status in ('awaiting_2fa', 'connected', 'needs_login')),
  connected_by uuid references auth.users(id) on delete set null,
  connected_at timestamptz,
  last_sync_at timestamptz,
  last_error text,
  next_delivery jsonb
);
create index picnic_links_connected_by_idx on public.picnic_links(connected_by);

-- The Picnic session key. Only the server function (service role) can read it.
create table public.picnic_secrets (
  household_id uuid primary key references public.households(id) on delete cascade,
  auth_key text not null,
  updated_at timestamptz not null default now()
);

create table public.picnic_deliveries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  delivery_id text not null,
  delivered_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'done', 'dismissed')),
  item_count int not null default 0,
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_by uuid references auth.users(id) on delete set null,
  constraint picnic_deliveries_household_delivery_key unique (household_id, delivery_id)
);
create index picnic_deliveries_handled_by_idx on public.picnic_deliveries(handled_by);

create table public.picnic_delivery_items (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.picnic_deliveries(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  article_id text not null,
  name text not null,
  unit text,
  quantity int not null default 1,
  image_id text,
  perishable boolean not null default false
);
create index picnic_delivery_items_delivery_idx on public.picnic_delivery_items(delivery_id);
create index picnic_delivery_items_household_idx on public.picnic_delivery_items(household_id);

-- Where each Picnic product went last time, so the next delivery is pre-filled.
create table public.picnic_products (
  household_id uuid not null references public.households(id) on delete cascade,
  article_id text not null,
  name text not null,
  location_id uuid references public.locations(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (household_id, article_id)
);
create index picnic_products_location_idx on public.picnic_products(location_id);

-- Default locations ------------------------------------------------------------
insert into public.locations (household_id, name, sort_order)
select h.id, l.name, l.sort_order
from public.households h
cross join (values ('Koelkast', 1), ('Vriezer', 2), ('Voorraadkast', 3)) as l(name, sort_order)
on conflict do nothing;

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
  insert into public.locations (household_id, name, sort_order)
  values (v_id, 'Koelkast', 1), (v_id, 'Vriezer', 2), (v_id, 'Voorraadkast', 3);
  return v_id;
end;
$$;

-- Triggers -----------------------------------------------------------------------
create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger stock_items_touch
  before update on public.stock_items
  for each row execute function private.touch_updated_at();

-- When something runs out: remove it from stock and put it on the restock list,
-- unless there is still some left elsewhere or it is already on the list.
create or replace function private.stock_item_depleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.stock_items where id = new.id;

  if not exists (
    select 1 from public.stock_items s
    where s.household_id = new.household_id
      and lower(s.name) = lower(new.name)
      and s.quantity > 0
  ) and not exists (
    select 1 from public.shopping_items i
    where i.household_id = new.household_id
      and lower(i.name) = lower(new.name)
      and i.archived_at is null
      and not i.checked
  ) then
    insert into public.shopping_items (household_id, name, picnic_article_id, added_by)
    values (new.household_id, new.name, new.picnic_article_id, auth.uid());
  end if;

  return null;
end;
$$;
revoke execute on function private.stock_item_depleted() from public, anon, authenticated;

create trigger stock_items_depleted
  after update of quantity on public.stock_items
  for each row
  when (new.quantity <= 0)
  execute function private.stock_item_depleted();

-- Confirm a Picnic delivery: put the chosen items in stock in one go -------------
-- p_items: [{ article_id, name, unit, image_id, quantity, location_id, best_before }]
-- Items without a location_id are skipped.
create or replace function public.confirm_picnic_delivery(p_delivery uuid, p_items jsonb)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_household uuid;
  v_item jsonb;
  v_location uuid;
  v_best date;
  v_qty int;
  v_existing uuid;
  v_count int := 0;
begin
  select household_id into v_household
  from public.picnic_deliveries
  where id = p_delivery and status = 'pending';
  if v_household is null then
    raise exception 'Deze bezorging is al verwerkt';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_location := nullif(v_item->>'location_id', '')::uuid;
    continue when v_location is null;
    v_best := nullif(v_item->>'best_before', '')::date;
    v_qty := greatest(1, least(999, coalesce((v_item->>'quantity')::int, 1)));

    select id into v_existing
    from public.stock_items
    where household_id = v_household
      and picnic_article_id = v_item->>'article_id'
      and location_id = v_location
      and best_before is not distinct from v_best
    limit 1;

    if v_existing is not null then
      update public.stock_items
      set quantity = least(999, quantity + v_qty)
      where id = v_existing;
    else
      insert into public.stock_items
        (household_id, location_id, name, unit, quantity, best_before, picnic_article_id, image_id)
      values
        (v_household, v_location, v_item->>'name', nullif(v_item->>'unit', ''), v_qty, v_best,
         v_item->>'article_id', nullif(v_item->>'image_id', ''));
    end if;

    insert into public.picnic_products (household_id, article_id, name, location_id, updated_at)
    values (v_household, v_item->>'article_id', v_item->>'name', v_location, now())
    on conflict (household_id, article_id)
    do update set location_id = excluded.location_id, name = excluded.name, updated_at = now();

    -- Delivered, so it no longer needs restocking.
    update public.shopping_items
    set checked = true, checked_at = now(), archived_at = now()
    where household_id = v_household
      and archived_at is null
      and (picnic_article_id = v_item->>'article_id' or lower(name) = lower(v_item->>'name'));

    v_count := v_count + 1;
  end loop;

  update public.picnic_deliveries
  set status = 'done', handled_at = now(), handled_by = auth.uid()
  where id = p_delivery;

  return v_count;
end;
$$;
revoke execute on function public.confirm_picnic_delivery(uuid, jsonb) from public, anon;
grant execute on function public.confirm_picnic_delivery(uuid, jsonb) to authenticated;

-- Row Level Security ----------------------------------------------------------------
alter table public.locations enable row level security;
alter table public.stock_items enable row level security;
alter table public.picnic_links enable row level security;
alter table public.picnic_secrets enable row level security;
alter table public.picnic_deliveries enable row level security;
alter table public.picnic_delivery_items enable row level security;
alter table public.picnic_products enable row level security;

create policy "locations_all_members" on public.locations
  for all to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));

create policy "stock_all_members" on public.stock_items
  for all to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));

create policy "picnic_products_all_members" on public.picnic_products
  for all to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));

create policy "picnic_links_select_members" on public.picnic_links
  for select to authenticated
  using (private.is_household_member(household_id));

create policy "picnic_deliveries_select_members" on public.picnic_deliveries
  for select to authenticated
  using (private.is_household_member(household_id));
create policy "picnic_deliveries_update_members" on public.picnic_deliveries
  for update to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));

create policy "picnic_delivery_items_select_members" on public.picnic_delivery_items
  for select to authenticated
  using (private.is_household_member(household_id));

-- picnic_secrets: no policies on purpose; only the service role reads and writes it.
revoke all on table public.picnic_secrets from anon, authenticated;

-- Realtime -------------------------------------------------------------------------
alter publication supabase_realtime add table public.stock_items, public.picnic_deliveries;
