-- Apply after 202610080001_hh_home.sql. Existing invoices remain unchanged.
-- Keep the original organization rates as a private migration archive.
begin;
create table public.property_service_rates (
 property_id uuid primary key,
 organization_id uuid not null references public.organizations(id),
 electricity bigint not null, water bigint not null, trash bigint not null, wifi bigint not null, laundry bigint not null,
 updated_at timestamptz not null default now(),
 foreign key(property_id,organization_id) references public.properties(id,organization_id),
 check(least(electricity,water,trash,wifi,laundry)>=0),
 check(greatest(electricity,water,trash,wifi,laundry)<=1000000000000)
);
alter table public.property_service_rates enable row level security;
revoke all on public.property_service_rates from public,anon,authenticated;
grant select,insert,update on public.property_service_rates to authenticated;
create policy property_rates_read on public.property_service_rates for select to authenticated
 using(public.has_role(organization_id,array['admin','manager','viewer']));
create policy property_rates_insert on public.property_service_rates for insert to authenticated
 with check(public.has_role(organization_id,array['admin','manager']));
create policy property_rates_update on public.property_service_rates for update to authenticated
 using(public.has_role(organization_id,array['admin','manager'])) with check(public.has_role(organization_id,array['admin','manager']));
-- Copy the old settings to every existing property, preserving configured prices.
insert into public.property_service_rates(property_id,organization_id,electricity,water,trash,wifi,laundry,updated_at)
 select p.id,p.organization_id,s.electricity,s.water,s.trash,s.wifi,s.laundry,s.updated_at
 from public.properties p join public.service_rates s on s.organization_id=p.organization_id;
create or replace function public.create_workspace(workspace_name text, member_name text) returns uuid language plpgsql security definer set search_path='' as $$
declare org uuid; user_email text; begin
 if auth.uid() is null then raise exception 'Bạn cần đăng nhập'; end if;
 if length(trim(member_name)) not between 1 and 120 then raise exception 'Họ tên không hợp lệ'; end if;
 select email into user_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
 if user_email is null then raise exception 'Vui lòng xác nhận email'; end if;
 insert into public.organizations(name) values(trim(workspace_name)) returning id into org;
 insert into public.memberships values(org,auth.uid(),'admin',trim(member_name),user_email);
 return org;
end $$;
create or replace function public.create_invoice(org uuid, target_room uuid, invoice_period date, deadline date, e_old integer, e_new integer, w_old integer, w_new integer) returns uuid language plpgsql security definer set search_path='' as $$
declare rates public.property_service_rates%rowtype; room public.rooms%rowtype; previous public.invoices%rowtype; result uuid; begin
 if not public.has_role(org,array['admin','manager']) then raise exception 'Bạn không có quyền lập hóa đơn'; end if;
 select * into room from public.rooms where id=target_room and organization_id=org for update;
 if not found then raise exception 'Không tìm thấy phòng'; end if;
 if invoice_period>date_trunc('month',timezone('Asia/Ho_Chi_Minh',now()))::date then raise exception 'Không thể lập hóa đơn cho tháng tương lai'; end if;
 if deadline<invoice_period then raise exception 'Hạn thanh toán không được trước kỳ hóa đơn'; end if;
 if exists(select 1 from public.invoices where room_id=target_room and period>=invoice_period) then raise exception 'Kỳ hóa đơn đã tồn tại hoặc trước kỳ đã lập'; end if;
 select * into previous from public.invoices where room_id=target_room order by period desc limit 1;
 if found and (e_old<>previous.electricity_new or w_old<>previous.water_new) then raise exception 'Chỉ số cũ phải khớp kỳ hóa đơn trước'; end if;
 select * into rates from public.property_service_rates where organization_id=org and property_id=room.property_id;
 if not found then raise exception 'Chưa thiết lập đơn giá cho căn hộ này'; end if;
 insert into public.invoices(organization_id,room_id,period,due_date,electricity_old,electricity_new,water_old,water_new,electricity_rate,water_rate,trash_fee,wifi_fee,laundry_fee,room_rent,created_by)
 values(org,target_room,invoice_period,deadline,e_old,e_new,w_old,w_new,rates.electricity,rates.water,rates.trash,rates.wifi,rates.laundry,room.monthly_rent,auth.uid()) returning id into result;
 return result;
end $$;

alter table public.service_rates rename to legacy_organization_service_rates;
revoke all on public.legacy_organization_service_rates from public,anon,authenticated;
notify pgrst, 'reload schema';
commit;
