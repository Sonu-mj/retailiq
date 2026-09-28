-- RetailIQ Phase 7 — Supabase Auth/RLS production deployment layer
-- Apply after the Phase 1–6 PostgreSQL schema. Review table/column names against the target project first.
-- Never expose the service-role key to the browser.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text,
  role text not null default 'cashier' check (role in ('owner','manager','cashier')),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_outlets (
  user_id uuid not null references public.profiles(id) on delete cascade,
  outlet_id text not null references public.outlets(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id,outlet_id)
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  outlet_id text references public.outlets(id),
  action text not null,
  entity_type text not null,
  entity_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists bills_idempotency_key_unique on public.bills(idempotency_key) where idempotency_key is not null;
create index if not exists user_outlets_outlet_idx on public.user_outlets(outlet_id);
create index if not exists audit_logs_created_idx on public.audit_logs(created_at desc);
create index if not exists audit_logs_user_idx on public.audit_logs(user_id);
create index if not exists audit_logs_outlet_idx on public.audit_logs(outlet_id);

create or replace function public.bootstrap_profile()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id,full_name,email,role,is_active)
  values(new.id,coalesce(new.raw_user_meta_data->>'full_name',split_part(coalesce(new.email,''),'@',1)),new.email,'cashier',false)
  on conflict(id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.bootstrap_profile();

create or replace function public.current_profile_role()
returns text language sql stable security definer set search_path=public as $$
  select role from public.profiles where id=auth.uid() and is_active=true
$$;

create or replace function public.can_access_outlet(target_outlet_id text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.profiles p
    where p.id=auth.uid() and p.is_active=true and (
      p.role='owner' or exists(select 1 from public.user_outlets uo where uo.user_id=p.id and uo.outlet_id=target_outlet_id)
    )
  )
$$;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce(public.current_profile_role()='owner',false)
$$;

alter table public.profiles enable row level security;
alter table public.user_outlets enable row level security;
alter table public.audit_logs enable row level security;

create policy profiles_self_read on public.profiles for select using (id=auth.uid() or public.is_owner());
create policy profiles_owner_insert on public.profiles for insert with check (public.is_owner());
create policy profiles_owner_update on public.profiles for update using (public.is_owner()) with check (public.is_owner());
create policy user_outlets_visible on public.user_outlets for select using (user_id=auth.uid() or public.is_owner());
create policy user_outlets_owner_write on public.user_outlets for all using (public.is_owner()) with check (public.is_owner());
create policy audit_owner_read on public.audit_logs for select using (public.is_owner());
-- audit rows are written by trusted server code with service-role privileges; no client insert policy.

-- Apply outlet-aware RLS to operational tables. Existing server mutations should continue to validate role and outlet.
do $$
declare t text;
begin
  foreach t in array array['outlets','bills','return_records','wastage','outlet_costs','anomaly_events','demand_forecasts','staff_plans','business_insights'] loop
    if to_regclass('public.'||t) is not null then execute format('alter table public.%I enable row level security',t); end if;
  end loop;
end $$;

create policy outlets_scoped_read on public.outlets for select using (public.can_access_outlet(id));
create policy outlets_owner_write on public.outlets for all using (public.is_owner()) with check (public.is_owner());

create policy bills_scoped_read on public.bills for select using (public.can_access_outlet(outlet_id));
create policy bills_scoped_insert on public.bills for insert with check (public.can_access_outlet(outlet_id));
create policy bills_manager_update on public.bills for update using (public.can_access_outlet(outlet_id) and public.current_profile_role() in ('owner','manager')) with check (public.can_access_outlet(outlet_id));
-- No bill delete policy: completed history cannot be deleted from authenticated clients.

create policy returns_scoped_read on public.return_records for select using (public.can_access_outlet(outlet_id));
create policy returns_scoped_insert on public.return_records for insert with check (public.can_access_outlet(outlet_id));
create policy wastage_scoped_read on public.wastage for select using (public.can_access_outlet(outlet_id) and public.current_profile_role() in ('owner','manager'));
create policy wastage_scoped_write on public.wastage for insert with check (public.can_access_outlet(outlet_id) and public.current_profile_role() in ('owner','manager'));
create policy costs_scoped_read on public.outlet_costs for select using (public.can_access_outlet(outlet_id) and public.current_profile_role() in ('owner','manager'));
create policy costs_owner_write on public.outlet_costs for all using (public.is_owner()) with check (public.is_owner());
create policy anomaly_scoped_read on public.anomaly_events for select using (public.can_access_outlet(outlet_id) and public.current_profile_role() in ('owner','manager'));
create policy anomaly_scoped_update on public.anomaly_events for update using (public.can_access_outlet(outlet_id) and public.current_profile_role() in ('owner','manager')) with check (public.can_access_outlet(outlet_id));
create policy forecasts_scoped_read on public.demand_forecasts for select using (public.can_access_outlet(outlet_id) and public.current_profile_role() in ('owner','manager'));
create policy staff_plans_scoped_read on public.staff_plans for select using (public.can_access_outlet(outlet_id) and public.current_profile_role() in ('owner','manager'));
create policy insights_scoped_read on public.business_insights for select using ((outlet_id is null and public.is_owner()) or (outlet_id is not null and public.can_access_outlet(outlet_id) and public.current_profile_role() in ('owner','manager')));

-- Parent-derived policies for child rows.
alter table public.bill_items enable row level security;
create policy bill_items_scoped_read on public.bill_items for select using (exists(select 1 from public.bills b where b.id=bill_id and public.can_access_outlet(b.outlet_id)));
create policy bill_items_scoped_insert on public.bill_items for insert with check (exists(select 1 from public.bills b where b.id=bill_id and public.can_access_outlet(b.outlet_id)));

-- Shared catalog/customer reads require an active profile; owner writes remain explicit.
do $$
declare t text;
begin
  foreach t in array array['categories','products','customers'] loop
    if to_regclass('public.'||t) is not null then execute format('alter table public.%I enable row level security',t); end if;
  end loop;
end $$;
create policy categories_active_read on public.categories for select using (public.current_profile_role() is not null);
create policy categories_owner_write on public.categories for all using (public.is_owner()) with check (public.is_owner());
create policy products_active_read on public.products for select using (public.current_profile_role() is not null);
create policy products_owner_write on public.products for all using (public.is_owner()) with check (public.is_owner());
create policy customers_active_read on public.customers for select using (public.current_profile_role() is not null);
create policy customers_active_insert on public.customers for insert with check (public.current_profile_role() is not null);
create policy customers_manager_update on public.customers for update using (public.current_profile_role() in ('owner','manager')) with check (public.current_profile_role() in ('owner','manager'));

-- Final admin/security extension (2026-09-28)
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists employee_id text;
alter table public.profiles add column if not exists last_login_at timestamptz;
create unique index if not exists profiles_employee_id_unique on public.profiles(employee_id) where employee_id is not null;

-- Operational tables remain outlet-scoped at the database boundary. Cashiers can
-- bill within assigned active outlets but cannot read or mutate admin datasets.
do $$
declare t text;
begin
  foreach t in array array['inventory','inventory_movements','inventory_receipts','inventory_transfers','outlet_costs','wastage','anomaly_events','demand_forecasts','staff_plans'] loop
    if to_regclass('public.'||t) is not null then execute format('alter table public.%I enable row level security',t); end if;
  end loop;
end $$;

drop policy if exists inventory_scoped_read on public.inventory;
create policy inventory_scoped_read on public.inventory for select using (public.can_access_outlet(outlet_id));
drop policy if exists inventory_manager_write on public.inventory;
create policy inventory_manager_write on public.inventory for all using (public.can_access_outlet(outlet_id) and public.current_profile_role() in ('owner','manager')) with check (public.can_access_outlet(outlet_id) and public.current_profile_role() in ('owner','manager'));
drop policy if exists inventory_movements_scoped_read on public.inventory_movements;
create policy inventory_movements_scoped_read on public.inventory_movements for select using (public.can_access_outlet(outlet_id) and public.current_profile_role() in ('owner','manager'));
drop policy if exists inventory_movements_manager_insert on public.inventory_movements;
create policy inventory_movements_manager_insert on public.inventory_movements for insert with check (public.can_access_outlet(outlet_id) and public.current_profile_role() in ('owner','manager'));
drop policy if exists staff_plans_manager_update on public.staff_plans;
create policy staff_plans_manager_update on public.staff_plans for update using (public.can_access_outlet(outlet_id) and public.current_profile_role() in ('owner','manager')) with check (public.can_access_outlet(outlet_id) and public.current_profile_role() in ('owner','manager'));
-- No DELETE policies are granted for bills, returns, outlets, profiles, inventory
-- movements, or audit logs. Historical records survive deactivation.


-- Product image storage (2026-09-28)
-- Private bucket used by Admin > Products. The app stores
-- supabase:product-images/<owner UUID>/<object UUID>.<ext> in products.image_url
-- and resolves short-lived signed URLs at read time.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "retailiq product images read" on storage.objects;
create policy "retailiq product images read"
on storage.objects for select
to authenticated
using (
  bucket_id = 'product-images'
  and public.current_profile_role() is not null
);

drop policy if exists "retailiq owners upload product images" on storage.objects;
create policy "retailiq owners upload product images"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'product-images'
  and public.is_owner()
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

-- Intentionally no storage.objects UPDATE or DELETE policy: removing an image
-- or deactivating a product changes only products.image_url and never deletes
-- the underlying image or historical records.
