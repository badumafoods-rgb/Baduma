-- Extend the existing BADUMA schema without replacing catalogue or orders.
create schema if not exists baduma_private;
revoke all on schema baduma_private from public, anon;
grant usage on schema baduma_private to authenticated;
alter table public.orders add column if not exists details jsonb not null default '{}';
alter table public.orders add column if not exists discount_lkr integer not null default 0 check(discount_lkr>=0);
alter table public.orders add column if not exists request_id uuid unique;
alter table public.orders drop constraint if exists orders_channel_check;
alter table public.orders add constraint orders_channel_check check(channel in ('delivery','dine_in','pos'));

create table if not exists public.promotions (
 code text primary key check(length(code) between 1 and 40), title text not null,
 kind text not null check(kind in ('percent','fixed')), value integer not null check(value>0),
 active boolean not null default true, image text,
 check(kind<>'percent' or value<=100), check(length(coalesce(image,''))<2000000)
);
alter table public.promotions enable row level security;
create policy promotions_read on public.promotions for select to anon,authenticated using(active or public.baduma_staff_role() in ('manager','admin'));
create policy promotions_manage on public.promotions for all to authenticated using(public.baduma_staff_role() in ('manager','admin')) with check(public.baduma_staff_role() in ('manager','admin'));
grant select on public.promotions to anon,authenticated;
grant insert,update,delete on public.promotions to authenticated;
create table if not exists public.rider_locations (
 user_id uuid primary key references auth.users(id), lat double precision not null check(lat between -90 and 90),
 lng double precision not null check(lng between -180 and 180), updated_at timestamptz not null default now()
);
alter table public.rider_locations enable row level security;
create policy rider_location_read on public.rider_locations for select to authenticated using(user_id=auth.uid() or public.baduma_staff_role() in ('admin','manager') or exists(select 1 from public.orders o where o.rider_id=rider_locations.user_id and o.customer_id=auth.uid() and o.status='out_for_delivery'));
create policy rider_location_write on public.rider_locations for all to authenticated using(user_id=auth.uid() and public.baduma_staff_role()='rider') with check(user_id=auth.uid() and public.baduma_staff_role()='rider');
grant select,insert,update on public.rider_locations to authenticated;
create policy customer_orders_read on public.orders for select to authenticated using(customer_id=auth.uid());
create policy cashier_orders_read on public.orders for select to authenticated using(public.baduma_staff_role()='cashier' and status in ('delivered_pending_handover','closed'));
create policy authorized_items_read on public.order_items for select to authenticated using(exists(select 1 from public.orders o where o.id=order_id));
create policy authorized_settlement_read on public.cash_settlements for select to authenticated using(exists(select 1 from public.orders o where o.id=order_id));
create policy settings_read on public.restaurant_settings for select to anon,authenticated using(true);
create policy tables_read on public.dining_tables for select to anon,authenticated using(active);
create policy employee_self_read on public.employees for select to authenticated using(user_id=auth.uid() or public.baduma_staff_role() in ('manager','admin'));
grant select on public.categories,public.products,public.product_variants,public.restaurant_settings,public.dining_tables to anon,authenticated;
grant select on public.orders,public.order_items,public.cash_settlements,public.employees,public.rider_locations to authenticated;

-- Privileged routines live outside the Data API schema. Every routine checks identity/role.
create or replace function baduma_private.place_order(p_details jsonb,p_items jsonb,p_request uuid,p_cash integer default null,p_code text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); oid uuid; mode text:=p_details->>'mode'; staff text:=public.baduma_staff_role();
 it jsonb; product public.products; variant public.product_variants; promo public.promotions;
 qty integer; price integer; subtotal integer:=0; fee integer:=0; discount integer:=0; km numeric; tid uuid; extras text[];
begin
 if uid is null then raise exception 'Sign in before placing an order'; end if;
 select id into oid from public.orders where request_id=p_request and customer_id=uid;
 if found then return oid; end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 100 then raise exception 'Choose 1–100 items'; end if;
 if mode not in ('delivery','table','pos') or mode is null then raise exception 'Invalid order type'; end if;
 if mode='pos' and coalesce(staff,'') not in ('manager','admin','cashier') then raise insufficient_privilege; end if;
 if mode='delivery' then
  if length(trim(coalesce(p_details->>'name','')))<1 or length(trim(coalesce(p_details->>'phone','')))<7 or length(trim(coalesce(p_details->>'address','')))<3 then raise exception 'Name, phone and address are required'; end if;
  km:=(p_details->>'distance')::numeric;
  if km is null or km<0 or km>100 then raise exception 'Enter a delivery distance from 0–100 km'; end if;
  select round(greatest(0,km-free_delivery_meters/1000.0)*delivery_lkr_per_km)::integer into fee from public.restaurant_settings where singleton;
  if fee is null then raise exception 'Delivery pricing is not configured'; end if;
 elsif mode='table' then
  select id into tid from public.dining_tables where label=p_details->>'table' and active;
  if tid is null then raise exception 'That table is not active. Ask staff for the table number'; end if;
 end if;
 -- Validate all prices against the catalogue. Client totals are never trusted.
 for it in select value from jsonb_array_elements(p_items) loop
  qty:=(it->>'quantity')::integer;
  if qty is null or qty not between 1 and 100 then raise exception 'Invalid quantity'; end if;
  select * into product from public.products where id=it->>'product_id' and available for share;
  if not found then raise exception 'An item is unavailable'; end if;
  select * into variant from public.product_variants where product_id=product.id and label=it->>'variant' for share;
  if not found then raise exception 'Choose a valid size'; end if;
  price:=variant.price_lkr;
  extras:=array(select jsonb_array_elements_text(coalesce(it->'extras','[]')));
  if cardinality(extras)>2 or cardinality(extras)<>(select count(distinct x) from unnest(extras) x) then raise exception 'Invalid extras'; end if;
  if exists(select 1 from unnest(extras) x where x not in ('Extra cheese','Extra butter')) then raise exception 'Invalid extra'; end if;
  if 'Extra cheese'=any(extras) then price:=price+150; end if;
  if 'Extra butter'=any(extras) then price:=price+75; end if;
  subtotal:=subtotal+price*qty;
 end loop;
 if p_code is not null and p_code<>'' then
  select * into promo from public.promotions where code=p_code and active;
  if not found then raise exception 'Promotion is unavailable'; end if;
  discount:=least(subtotal,case when promo.kind='percent' then round(subtotal*promo.value/100.0)::integer else promo.value end);
 end if;
 if mode='pos' and (p_cash is null or p_cash<subtotal-discount) then raise exception 'Cash must cover the total'; end if;
 insert into public.orders(customer_id,table_id,channel,status,contact_name,contact_phone,subtotal_lkr,quoted_delivery_lkr,final_delivery_lkr,details,discount_lkr,request_id)
 values(uid,tid,case mode when 'table' then 'dine_in' else mode end,case when mode='pos' then 'closed' else 'new' end,p_details->>'name',p_details->>'phone',subtotal,fee,fee,p_details||jsonb_build_object('promo_code',p_code,'cash',p_cash),discount,p_request) returning id into oid;
 for it in select value from jsonb_array_elements(p_items) loop
  select * into product from public.products where id=it->>'product_id';
  select * into variant from public.product_variants where product_id=product.id and label=it->>'variant' for share;
  extras:=array(select jsonb_array_elements_text(coalesce(it->'extras','[]')));
  price:=variant.price_lkr+case when 'Extra cheese'=any(extras) then 150 else 0 end+case when 'Extra butter'=any(extras) then 75 else 0 end;
  insert into public.order_items(order_id,product_id,item_name,variant_label,unit_price_lkr,quantity) values(oid,product.id,product.name,variant.label||case when cardinality(extras)>0 then ' + '||array_to_string(extras,' + ') else '' end,price,(it->>'quantity')::integer);
 end loop;
 return oid;
end $$;
revoke all on function baduma_private.place_order(jsonb,jsonb,uuid,integer,text) from public,anon;
grant execute on function baduma_private.place_order(jsonb,jsonb,uuid,integer,text) to authenticated;
create or replace function public.baduma_place_order(p_details jsonb,p_items jsonb,p_request uuid,p_cash integer default null,p_code text default null)
returns uuid language sql security invoker set search_path='' as $$select baduma_private.place_order(p_details,p_items,p_request,p_cash,p_code)$$;
revoke all on function public.baduma_place_order(jsonb,jsonb,uuid,integer,text) from public,anon;
grant execute on function public.baduma_place_order(jsonb,jsonb,uuid,integer,text) to authenticated;

create or replace function baduma_private.deliver(p_id uuid,p_cash integer,p_signature text) returns void language plpgsql security definer set search_path='' as $$
declare o public.orders;
begin
 if auth.uid() is null or coalesce(public.baduma_staff_role(),'')<>'rider' then raise insufficient_privilege; end if;
 select * into o from public.orders where id=p_id and rider_id=auth.uid() and status='out_for_delivery' for update;
 if not found then raise exception 'Delivery is no longer assigned to you'; end if;
 if p_cash<>o.subtotal_lkr+coalesce(o.final_delivery_lkr,o.quoted_delivery_lkr,0)-o.discount_lkr or p_cash is null then raise exception 'Enter the exact COD amount'; end if;
 if coalesce(p_signature,'') not like 'data:image/png;base64,%' or length(p_signature) not between 100 and 300000 then raise exception 'Capture the customer signature'; end if;
 insert into public.cash_settlements(order_id,signature_object_path,collected_lkr) values(p_id,p_signature,p_cash);
 update public.orders set status='delivered_pending_handover' where id=p_id;
end $$;
create or replace function baduma_private.handover(p_id uuid,p_cash integer) returns void language plpgsql security definer set search_path='' as $$
declare expected integer;
begin
 if auth.uid() is null or coalesce(public.baduma_staff_role(),'') not in ('admin','manager','cashier') then raise insufficient_privilege; end if;
 perform 1 from public.orders where id=p_id and status='delivered_pending_handover' for update;
 if not found then raise exception 'Order is not awaiting handover'; end if;
 select collected_lkr into expected from public.cash_settlements where order_id=p_id;
 if p_cash is distinct from expected then raise exception 'Cash must match the rider collection'; end if;
 update public.cash_settlements set received_lkr=p_cash,received_by=auth.uid(),received_at=now() where order_id=p_id;
 update public.orders set status='closed' where id=p_id;
end $$;
revoke all on function baduma_private.deliver(uuid,integer,text),baduma_private.handover(uuid,integer) from public,anon;
grant execute on function baduma_private.deliver(uuid,integer,text),baduma_private.handover(uuid,integer) to authenticated;
create or replace function public.baduma_deliver(p_id uuid,p_cash integer,p_signature text) returns void language sql security invoker set search_path='' as $$select baduma_private.deliver(p_id,p_cash,p_signature)$$;
create or replace function public.baduma_handover(p_id uuid,p_cash integer) returns void language sql security invoker set search_path='' as $$select baduma_private.handover(p_id,p_cash)$$;
revoke all on function public.baduma_deliver(uuid,integer,text),public.baduma_handover(uuid,integer) from public,anon;
grant execute on function public.baduma_deliver(uuid,integer,text),public.baduma_handover(uuid,integer) to authenticated;

-- Do not expose existing privileged helpers to anonymous callers.
revoke execute on function public.baduma_record_change() from public,anon,authenticated;
revoke execute on function public.baduma_active_riders(),public.baduma_dispatch_order(uuid,text,uuid) from public,anon;
grant execute on function public.baduma_active_riders(),public.baduma_dispatch_order(uuid,text,uuid) to authenticated;
-- staff role returns no data for anonymous users, and is used by read policies.
do $$declare t text; begin
 foreach t in array array['categories','products','product_variants','orders','order_items','cash_settlements','promotions','rider_locations','employees','restaurant_settings','dining_tables'] loop
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
   execute format('alter publication supabase_realtime add table public.%I',t);
  end if;
 end loop;
end $$;
