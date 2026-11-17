-- BADUMA staff hierarchy and granular permissions. Existing master admin stays intact.
alter table public.employees add column if not exists username text unique;
alter table public.employees add column if not exists permissions text[] not null default '{}';
alter table public.employees add column if not exists created_by uuid references auth.users(id);
alter table public.employees add column if not exists updated_at timestamptz not null default now();
update public.employees set permissions=case role
 when 'manager' then array['orders.view','orders.manage','pos.use','products.manage','promotions.manage','expenses.view','expenses.manage','cash.handover']
 when 'rider' then array['delivery.use'] when 'cashier' then array['pos.use','cash.handover'] else '{}'::text[] end
where permissions='{}'::text[];

create or replace function baduma_private.has_permission(p_key text) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (coalesce(public.baduma_admin(),false) or exists(
  select 1 from public.employees where user_id=auth.uid() and active and p_key=any(permissions)
 ));
$$;
revoke all on function baduma_private.has_permission(text) from public;
grant usage on schema baduma_private to anon;
grant execute on function baduma_private.has_permission(text) to anon,authenticated;
create or replace function public.baduma_has_permission(p_key text) returns boolean language sql stable security invoker set search_path='' as $$select baduma_private.has_permission(p_key)$$;
revoke all on function public.baduma_has_permission(text) from public;
grant execute on function public.baduma_has_permission(text) to anon,authenticated;
create or replace function baduma_private.me() returns jsonb language sql stable security definer set search_path='' as $$
 select case when auth.uid() is null then jsonb_build_object('role','','permissions','[]'::jsonb)
 when public.baduma_admin() then jsonb_build_object('role','admin','name','Master Admin','username','masteradmin','permissions',array['orders.view','orders.manage','pos.use','products.manage','promotions.manage','expenses.view','expenses.manage','cash.handover','users.manage'])
 else coalesce((select jsonb_build_object('role',role,'name',name,'username',username,'permissions',permissions,'active',active) from public.employees where user_id=auth.uid() and active),jsonb_build_object('role','','permissions','[]'::jsonb)) end;
$$;
revoke all on function baduma_private.me() from public,anon;
grant execute on function baduma_private.me() to authenticated;
create or replace function public.baduma_me() returns jsonb language sql stable security invoker set search_path='' as $$select baduma_private.me()$$;
revoke all on function public.baduma_me() from public,anon;
grant execute on function public.baduma_me() to authenticated;

-- Replace permissive role policies; unticking a permission must also revoke API access.
do $$declare r record; begin
 for r in select schemaname,tablename,policyname from pg_policies where schemaname='public' and tablename in ('employees','expenses','orders','products','product_variants','promotions','rider_locations') loop
  execute format('drop policy %I on %I.%I',r.policyname,r.schemaname,r.tablename);
 end loop;
end $$;
create policy employees_read on public.employees for select to authenticated using(
 user_id=auth.uid() or public.baduma_admin() or (public.baduma_has_permission('users.manage') and created_by=auth.uid())
);
-- Staff writes run only through the authenticated staff-admin service.
revoke insert,update,delete on public.employees from anon,authenticated;
grant select on public.employees to authenticated;
create policy expense_read on public.expenses for select to authenticated using(public.baduma_has_permission('expenses.view') or public.baduma_has_permission('expenses.manage'));
create policy expense_insert on public.expenses for insert to authenticated with check(public.baduma_has_permission('expenses.manage') and created_by=auth.uid());
create policy expense_update on public.expenses for update to authenticated using(public.baduma_has_permission('expenses.manage')) with check(public.baduma_has_permission('expenses.manage'));
grant select,insert,update on public.expenses to authenticated;
grant usage,select on sequence public.expenses_id_seq to authenticated;
create policy catalog_products on public.products for select to anon,authenticated using(true);
create policy product_insert on public.products for insert to authenticated with check(public.baduma_has_permission('products.manage'));
create policy product_update on public.products for update to authenticated using(public.baduma_has_permission('products.manage')) with check(public.baduma_has_permission('products.manage'));
create policy catalog_variants on public.product_variants for select to anon,authenticated using(true);
create policy variants_write on public.product_variants for all to authenticated using(public.baduma_has_permission('products.manage')) with check(public.baduma_has_permission('products.manage'));
grant insert,update on public.products to authenticated;
grant insert,update,delete on public.product_variants to authenticated;
create policy promotions_read on public.promotions for select to anon,authenticated using(active or public.baduma_has_permission('promotions.manage'));
create policy promotions_write on public.promotions for all to authenticated using(public.baduma_has_permission('promotions.manage')) with check(public.baduma_has_permission('promotions.manage'));
create policy orders_read on public.orders for select to authenticated using(
 customer_id=auth.uid() or public.baduma_has_permission('orders.view') or public.baduma_has_permission('orders.manage')
 or (public.baduma_has_permission('pos.use') and channel='pos')
 or (public.baduma_has_permission('cash.handover') and status in ('delivered_pending_handover','closed'))
 or (public.baduma_has_permission('delivery.use') and rider_id=auth.uid())
);
create policy location_read on public.rider_locations for select to authenticated using(
 (user_id=auth.uid() and public.baduma_has_permission('delivery.use')) or public.baduma_has_permission('orders.view') or public.baduma_has_permission('orders.manage')
 or exists(select 1 from public.orders o where o.rider_id=rider_locations.user_id and o.customer_id=auth.uid() and o.status='out_for_delivery')
);
create policy location_write on public.rider_locations for all to authenticated using(user_id=auth.uid() and public.baduma_has_permission('delivery.use') and public.baduma_staff_role()='rider') with check(user_id=auth.uid() and public.baduma_has_permission('delivery.use') and public.baduma_staff_role()='rider');

create or replace function baduma_private.dispatch(p_id uuid,p_next text,p_rider uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not baduma_private.has_permission('orders.manage') then raise insufficient_privilege; end if;
 if p_next='out_for_delivery' and not exists(select 1 from public.employees where user_id=p_rider and role='rider' and active and 'delivery.use'=any(permissions)) then raise exception 'Choose an active driver with delivery permission'; end if;
 update public.orders set status=p_next,rider_id=case when p_next='out_for_delivery' then p_rider else rider_id end
 where id=p_id and ((status='new' and p_next in ('accepted','rejected')) or (status='accepted' and p_next='preparing') or (status='preparing' and p_next='ready') or (status='ready' and channel='delivery' and p_next='out_for_delivery') or (status='ready' and channel='dine_in' and p_next='closed'));
 if not found then raise exception 'Order changed or transition unavailable'; end if;
end $$;
create or replace function public.baduma_dispatch_order(p_id uuid,p_next text,p_rider uuid default null) returns void language sql security invoker set search_path='' as $$select baduma_private.dispatch(p_id,p_next,p_rider)$$;
revoke all on function baduma_private.dispatch(uuid,text,uuid) from public,anon;
grant execute on function baduma_private.dispatch(uuid,text,uuid) to authenticated;
create or replace function baduma_private.riders() returns table(user_id uuid,name text) language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not baduma_private.has_permission('orders.manage') then raise insufficient_privilege; end if;
 return query select e.user_id,e.name from public.employees e where e.active and e.role='rider' and 'delivery.use'=any(e.permissions) order by e.name;
end $$;
create or replace function public.baduma_active_riders() returns table(user_id uuid,name text) language sql stable security invoker set search_path='' as $$select * from baduma_private.riders()$$;
revoke all on function baduma_private.riders() from public,anon;
grant execute on function baduma_private.riders() to authenticated;

create or replace function public.baduma_save_product(p_id text,p_name text,p_category text,p_prep integer,p_available boolean,p_variants jsonb) returns void language plpgsql security invoker set search_path='' as $$
begin
 if not public.baduma_has_permission('products.manage') then raise insufficient_privilege; end if;
 if p_id !~ '^[a-z0-9][a-z0-9-]{1,99}$' or length(trim(p_name)) not between 1 and 160 then raise exception 'Enter a valid product ID and name'; end if;
 if jsonb_typeof(p_variants) is distinct from 'array' or jsonb_array_length(p_variants) not between 1 and 12 then raise exception 'Supply 1–12 sizes'; end if;
 insert into public.products(id,name,category_id,prep_minutes,available) values(p_id,trim(p_name),p_category,p_prep,p_available)
 on conflict(id) do update set name=excluded.name,category_id=excluded.category_id,prep_minutes=excluded.prep_minutes,available=excluded.available;
 delete from public.product_variants where product_id=p_id;
 insert into public.product_variants(product_id,label,price_lkr) select p_id,trim(v.label),v.price_lkr from jsonb_to_recordset(p_variants) as v(label text,price_lkr integer) where length(trim(v.label)) between 1 and 40;
 if (select count(*) from public.product_variants where product_id=p_id)<>jsonb_array_length(p_variants) then raise exception 'Invalid sizes'; end if;
end $$;
revoke all on function public.baduma_save_product(text,text,text,integer,boolean,jsonb) from public,anon;
grant execute on function public.baduma_save_product(text,text,text,integer,boolean,jsonb) to authenticated;
create or replace function public.baduma_save_product_details(p_id text,p_name text,p_category text,p_prep integer,p_available boolean,p_variants jsonb,p_ingredients text[],p_spice text,p_image text) returns void language plpgsql security invoker set search_path='' as $$
begin
 if not public.baduma_has_permission('products.manage') then raise insufficient_privilege; end if;
 if p_image is not null and p_image<>'' and (length(p_image)>2000 or p_image!~ '^https://') then raise exception 'Use an HTTPS image URL'; end if;
 perform public.baduma_save_product(p_id,p_name,p_category,p_prep,p_available,p_variants);
 update public.products set ingredients=coalesce(p_ingredients,'{}'),spice_level=p_spice,image_path=nullif(p_image,'') where id=p_id;
end $$;
revoke all on function public.baduma_save_product_details(text,text,text,integer,boolean,jsonb,text[],text,text) from public,anon;
grant execute on function public.baduma_save_product_details(text,text,text,integer,boolean,jsonb,text[],text,text) to authenticated;

-- Existing privileged workflows now consult live permissions on every action.
do $$declare definition text; begin
 select pg_get_functiondef('baduma_private.place_order(jsonb,jsonb,uuid,integer,text)'::regprocedure) into definition;
 definition:=replace(definition,$old$mode='pos' and coalesce(staff,'') not in ('manager','admin','cashier')$old$,$new$mode='pos' and not baduma_private.has_permission('pos.use')$new$);
 execute definition;
 select pg_get_functiondef('baduma_private.deliver(uuid,integer,text)'::regprocedure) into definition;
 definition:=replace(definition,$old$coalesce(public.baduma_staff_role(),'')<>'rider'$old$,$new$(coalesce(public.baduma_staff_role(),'')<>'rider' or not baduma_private.has_permission('delivery.use'))$new$);
 execute definition;
 select pg_get_functiondef('baduma_private.handover(uuid,integer)'::regprocedure) into definition;
 definition:=replace(definition,$old$coalesce(public.baduma_staff_role(),'') not in ('admin','manager','cashier')$old$,$new$not baduma_private.has_permission('cash.handover')$new$);
 execute definition;
end $$;
do $$begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='expenses') then alter publication supabase_realtime add table public.expenses; end if;
end $$;
