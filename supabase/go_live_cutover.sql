-- RetailIQ production cutover patch
-- Run once in Supabase Dashboard > SQL Editor before deploying to Vercel.
-- This script is idempotent and never deletes business rows.

begin;

alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists employee_id text;
alter table public.profiles add column if not exists last_login_at timestamptz;
alter table public.staff_plans add column if not exists scheduled_staff integer;

-- Atomic checkout boundary. It locks every stock row before validating and
-- writes the bill, line items, stock movements and audit row in one transaction.
create or replace function public.retailiq_complete_bill(
  p_bill jsonb,
  p_items jsonb,
  p_movements jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_role text;
  v_outlet_id text := p_bill->>'outlet_id';
  v_status text := p_bill->>'status';
  v_item jsonb;
  v_stock public.inventory%rowtype;
  v_bill_number text;
begin
  select role into v_role from public.profiles where id=auth.uid() and is_active=true;
  if v_role is null then
    return jsonb_build_object('ok',false,'bill_number','','error','Authentication is required.');
  end if;
  if not public.can_access_outlet(v_outlet_id) then
    return jsonb_build_object('ok',false,'bill_number','','error','You do not have access to this outlet.');
  end if;
  if exists(select 1 from public.bills where idempotency_key=p_bill->>'idempotency_key') then
    return jsonb_build_object('ok',false,'bill_number','','error','This checkout was already processed. Open Bill History to view the saved bill.');
  end if;
  if not exists(select 1 from public.outlets where id=v_outlet_id and is_active=true) then
    return jsonb_build_object('ok',false,'bill_number','','error','Select an active outlet before completing the bill.');
  end if;

  if v_status='completed' then
    for v_item in select value from jsonb_array_elements(p_items)
    loop
      select * into v_stock from public.inventory
      where outlet_id=v_outlet_id and product_id=v_item->>'product_id'
      for update;
      if not found then
        return jsonb_build_object('ok',false,'bill_number','','error',(v_item->>'product_name_snapshot') || ': stock is not configured for this outlet.');
      end if;
      if v_stock.current_quantity < (v_item->>'quantity')::numeric then
        return jsonb_build_object('ok',false,'bill_number','','error','Insufficient stock for ' || (v_item->>'product_name_snapshot') || '. Available ' || v_stock.current_quantity || '.');
      end if;
    end loop;
  end if;

  insert into public.bills(id,bill_number,idempotency_key,outlet_id,customer_id,bill_timestamp,subtotal,discount,tax,total,payment_method,status,created_at)
  values(p_bill->>'id',null,p_bill->>'idempotency_key',v_outlet_id,nullif(p_bill->>'customer_id',''),(p_bill->>'bill_timestamp')::timestamptz,(p_bill->>'subtotal')::double precision,(p_bill->>'discount')::double precision,(p_bill->>'tax')::double precision,(p_bill->>'total')::double precision,p_bill->>'payment_method',v_status,(p_bill->>'created_at')::timestamptz)
  returning bill_number into v_bill_number;

  insert into public.bill_items(id,bill_id,product_id,product_name_snapshot,category_name_snapshot,quantity,selling_price,cost_price,line_total,created_at)
  select x.id,x.bill_id,x.product_id,x.product_name_snapshot,x.category_name_snapshot,x.quantity,x.selling_price,x.cost_price,x.line_total,x.created_at
  from jsonb_to_recordset(p_items) as x(id text,bill_id text,product_id text,product_name_snapshot text,category_name_snapshot text,quantity integer,selling_price double precision,cost_price double precision,line_total double precision,created_at timestamptz);

  if v_status='completed' then
    for v_item in select value from jsonb_array_elements(p_items)
    loop
      update public.inventory set current_quantity=current_quantity-(v_item->>'quantity')::numeric,updated_at=now()
      where outlet_id=v_outlet_id and product_id=v_item->>'product_id';
    end loop;
    insert into public.inventory_movements(id,outlet_id,product_id,movement_type,quantity,reference_type,reference_id,unit_cost,notes,created_by,created_at)
    select x.id,x.outlet_id,x.product_id,x.movement_type,x.quantity,x.reference_type,x.reference_id,x.unit_cost,x.notes,x.created_by,x.created_at
    from jsonb_to_recordset(p_movements) as x(id text,outlet_id text,product_id text,movement_type text,quantity double precision,reference_type text,reference_id text,unit_cost double precision,notes text,created_by uuid,created_at timestamptz);
  end if;

  insert into public.audit_logs(id,user_id,action,entity_type,entity_id,outlet_id,metadata,created_at)
  values('AUD_'||gen_random_uuid()::text,auth.uid(),case when v_status='completed' then 'bill_created' else 'bill_held' end,'bill',p_bill->>'id',v_outlet_id,jsonb_build_object('bill_number',v_bill_number,'total',(p_bill->>'total')::double precision,'payment_method',p_bill->>'payment_method')::text,now());
  return jsonb_build_object('ok',true,'bill_number',v_bill_number,'error','');
exception
  when unique_violation then
    return jsonb_build_object('ok',false,'bill_number','','error','This checkout was already processed. Open Bill History to view the saved bill.');
end;
$$;

grant execute on function public.retailiq_complete_bill(jsonb,jsonb,jsonb) to authenticated;

-- The in-app cutover runs with the signed-in owner's JWT, never a service-role
-- key. These narrowly scoped policies let an authenticated owner insert missing
-- historical rows. Updates are granted only to tables that have updated_at so
-- the app can compare timestamps and keep the newer copy. No delete policy is
-- created by this patch.
do $$
declare
  t text;
  policy_name text;
begin
  foreach t in array array[
    'outlets','categories','profiles','products','customers','user_outlets',
    'invoice_sequences','return_sequences','bills','bill_items','returns',
    'wastage','outlet_costs','anomaly_events','intelligence_runs',
    'forecast_runs','demand_forecasts','workforce_settings','staff_plans',
    'inventory_settings','inventory','inventory_movements',
    'inventory_receipts','inventory_receipt_items','inventory_transfers',
    'inventory_transfer_items','offers','business_insights','audit_logs'
  ] loop
    if to_regclass('public.'||t) is not null then
      execute format('alter table public.%I enable row level security',t);
      policy_name := 'retailiq_owner_cutover_insert_'||t;
      execute format('drop policy if exists %I on public.%I',policy_name,t);
      execute format('create policy %I on public.%I for insert to authenticated with check (public.is_owner())',policy_name,t);
    end if;
  end loop;

  foreach t in array array[
    'profiles','outlet_costs','workforce_settings','inventory_settings',
    'inventory','offers','business_insights','invoice_sequences','return_sequences'
  ] loop
    if to_regclass('public.'||t) is not null then
      policy_name := 'retailiq_owner_cutover_update_'||t;
      execute format('drop policy if exists %I on public.%I',policy_name,t);
      execute format('create policy %I on public.%I for update to authenticated using (public.is_owner()) with check (public.is_owner())',policy_name,t);
    end if;
  end loop;
end $$;

commit;
