-- Apply after 001-005. Separate billing cycles when a vacant room is occupied again.
begin;
create table public.room_billing_cycles (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,room_id uuid not null,
 starts_on date not null,electricity_initial integer,water_initial integer,is_legacy boolean not null default false,
 check(electricity_initial>=0 and water_initial>=0),check((electricity_initial is null)=(water_initial is null)),
 foreign key(room_id,organization_id) references public.rooms(id,organization_id),unique(id,organization_id,room_id)
);
alter table public.room_billing_cycles enable row level security;
revoke all on public.room_billing_cycles from public,anon,authenticated;
grant select on public.room_billing_cycles to authenticated;
create policy billing_cycles_read on public.room_billing_cycles for select to authenticated using(public.has_role(organization_id,array['admin','manager','viewer']));
alter table public.tenants add column billing_cycle_id uuid,add column electricity_initial integer,add column water_initial integer,add column was_scheduled boolean not null default false;
alter table public.tenants add constraint tenant_initial_readings check(electricity_initial>=0 and water_initial>=0);
alter table public.tenants add constraint tenant_billing_cycle foreign key(billing_cycle_id,organization_id,room_id) references public.room_billing_cycles(id,organization_id,room_id);
alter table public.invoices add column billing_cycle_id uuid;
alter table public.invoices add constraint invoice_billing_cycle foreign key(billing_cycle_id,organization_id,room_id) references public.room_billing_cycles(id,organization_id,room_id);
-- Existing records remain one legacy room history, without inventing missing readings.
insert into public.room_billing_cycles(organization_id,room_id,starts_on,electricity_initial,water_initial,is_legacy)
 select r.organization_id,r.id,least((select min(move_in) from public.tenants where room_id=r.id),(select min(period) from public.invoices where room_id=r.id)),
 (select electricity_old from public.invoices where room_id=r.id order by period limit 1),
 (select water_old from public.invoices where room_id=r.id order by period limit 1),true
 from public.rooms r where exists(select 1 from public.tenants where room_id=r.id) or exists(select 1 from public.invoices where room_id=r.id);
-- Do not fire the previous stay guard while adding the new reference to unchanged stays.
update public.tenants t set billing_cycle_id=c.id,was_scheduled=(t.move_in>timezone('Asia/Ho_Chi_Minh',now())::date) from public.room_billing_cycles c where c.room_id=t.room_id;
update public.invoices i set billing_cycle_id=c.id from public.room_billing_cycles c where c.room_id=i.room_id;
alter table public.invoices drop constraint invoices_room_id_period_key;
create unique index invoices_cycle_period on public.invoices(room_id,period,billing_cycle_id) nulls not distinct;
create index tenants_billing_cycle on public.tenants(billing_cycle_id);
create trigger guard_archived_billing_cycle before insert or update on public.room_billing_cycles for each row execute function public.guard_archived_property_write();

create function public.initialize_room_billing_cycle() returns trigger language plpgsql security definer set search_path='' as $$
declare existing_cycle uuid; occupied boolean; previous_end integer; previous_water integer;
begin
 new.was_scheduled:=(new.move_in>timezone('Asia/Ho_Chi_Minh',now())::date);
 perform 1 from public.rooms where id=new.room_id and organization_id=new.organization_id for update;
 if not found then raise exception 'Phòng không thuộc không gian quản lý' using errcode='23503'; end if;
 -- Share the existing billing cycle only if somebody is still living here on arrival day.
 select t.billing_cycle_id into existing_cycle from public.tenants t where t.room_id=new.room_id and t.move_in<=new.move_in and (t.move_out is null or t.move_out>new.move_in) order by t.move_in,t.id limit 1;
 occupied:=found;
 if occupied then
  new.billing_cycle_id:=existing_cycle; new.electricity_initial:=null;new.water_initial:=null;
 else
  if new.move_in>timezone('Asia/Ho_Chi_Minh',now())::date then new.electricity_initial:=null;new.water_initial:=null;
  elsif new.electricity_initial is null or new.water_initial is null then raise exception 'Phòng trống nhận người thuê mới: cần ghi chỉ số điện và nước ban đầu'; end if;
  -- Do not insert a retroactive independent cycle through a future booking/current stay.
  if exists(select 1 from public.tenants t where t.room_id=new.room_id and t.move_in>new.move_in and (t.move_out is null or t.move_out>t.move_in) and (new.move_out is null or new.move_out>t.move_in)) then raise exception 'Phòng có lịch vào ở sau ngày này. Hãy xử lý lịch thuê trước khi tạo đợt ở mới'; end if;
  select electricity_new,water_new into previous_end,previous_water from public.invoices where room_id=new.room_id and period<=date_trunc('month',new.move_in)::date order by period desc,created_at desc limit 1;
  if found and (new.electricity_initial<previous_end or new.water_initial<previous_water) then raise exception 'Chỉ số nhận phòng không được nhỏ hơn chỉ số đã tổng kết trước đó'; end if;
  insert into public.room_billing_cycles(organization_id,room_id,starts_on,electricity_initial,water_initial)
  values(new.organization_id,new.room_id,new.move_in,new.electricity_initial,new.water_initial) returning id into new.billing_cycle_id;
 end if;
 return new;
end $$;
revoke all on function public.initialize_room_billing_cycle() from public;
create trigger initialize_room_billing_cycle before insert on public.tenants for each row execute function public.initialize_room_billing_cycle();
revoke update on public.tenants from authenticated;
grant update(full_name,gender,birth_date,identity_number,phone,email,room_id,move_in,move_out) on public.tenants to authenticated;
create function public.protect_room_billing_cycle() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.billing_cycle_id is distinct from old.billing_cycle_id and old.was_scheduled and old.move_in>=timezone('Asia/Ho_Chi_Minh',now())::date and new.room_id=old.room_id and new.move_in=old.move_in and new.electricity_initial is null and new.water_initial is null then return new; end if;
 if new.billing_cycle_id is distinct from old.billing_cycle_id or new.electricity_initial is distinct from old.electricity_initial or new.water_initial is distinct from old.water_initial or new.room_id is distinct from old.room_id or new.move_in is distinct from old.move_in then raise exception 'Mốc nhận phòng và đợt ở được giữ nguyên; chỉ chỉnh thông tin cá nhân hoặc ghi nhận chuyển đi'; end if;
 return new;
end $$;
revoke all on function public.protect_room_billing_cycle() from public;
create trigger protect_room_billing_cycle before update on public.tenants for each row execute function public.protect_room_billing_cycle();

-- A future booking must lose the old baseline if the room becomes vacant before its arrival.
create function public.reconcile_future_room_cycles() returns trigger language plpgsql security definer set search_path='' as $$
declare planned public.tenants%rowtype; expected uuid;begin
 if new.move_out is not distinct from old.move_out then return new; end if;
 perform 1 from public.rooms where id=new.room_id for update;
 for planned in select * from public.tenants where room_id=new.room_id and was_scheduled and move_in>=timezone('Asia/Ho_Chi_Minh',now())::date and (move_out is null or move_out>move_in) order by move_in,id loop
  select t.billing_cycle_id into expected from public.tenants t where t.room_id=new.room_id and (t.move_in<planned.move_in or (t.move_in=planned.move_in and t.id<planned.id)) and (t.move_out is null or t.move_out>planned.move_in) order by t.move_in,t.id limit 1;
  if not found then
   select id into expected from public.room_billing_cycles where id=planned.billing_cycle_id and starts_on=planned.move_in and electricity_initial is null;
   if not found then insert into public.room_billing_cycles(organization_id,room_id,starts_on) values(planned.organization_id,planned.room_id,planned.move_in) returning id into expected; end if;
  end if;
  if expected is distinct from planned.billing_cycle_id then update public.tenants set billing_cycle_id=expected where id=planned.id; end if;
 end loop;
 return new;
end $$;
revoke all on function public.reconcile_future_room_cycles() from public;
create trigger reconcile_future_room_cycles after update of move_out on public.tenants for each row execute function public.reconcile_future_room_cycles();

create function public.set_initial_room_readings(org uuid,target_cycle uuid,electricity integer,water integer) returns void language plpgsql security definer set search_path='' as $$
declare cycle public.room_billing_cycles%rowtype;previous_end integer;previous_water integer;begin
 if not public.has_role(org,array['admin','manager']) then raise exception 'Bạn không có quyền ghi chỉ số nhận phòng'; end if;
 select * into cycle from public.room_billing_cycles where id=target_cycle and organization_id=org;
 if not found then raise exception 'Không tìm thấy đợt thuê'; end if;
 perform 1 from public.rooms where id=cycle.room_id for update;
 select * into cycle from public.room_billing_cycles where id=target_cycle for update;
 if cycle.starts_on>timezone('Asia/Ho_Chi_Minh',now())::date then raise exception 'Chưa đến ngày nhận phòng để ghi chỉ số'; end if;
 if cycle.electricity_initial is not null or exists(select 1 from public.invoices where billing_cycle_id=target_cycle) then raise exception 'Mốc nhận phòng đã lưu hoặc đợt thuê đã có hóa đơn'; end if;
 if electricity is null or water is null or least(electricity,water)<0 then raise exception 'Chỉ số phải là số nguyên không âm'; end if;
 select electricity_new,water_new into previous_end,previous_water from public.invoices where room_id=cycle.room_id and period<=date_trunc('month',cycle.starts_on)::date order by period desc,created_at desc limit 1;
 if found and (electricity<previous_end or water<previous_water) then raise exception 'Chỉ số nhận phòng không được nhỏ hơn chỉ số đã tổng kết trước đó'; end if;
 update public.room_billing_cycles set electricity_initial=electricity,water_initial=water where id=target_cycle;
end $$;
revoke all on function public.set_initial_room_readings(uuid,uuid,integer,integer) from public;
grant execute on function public.set_initial_room_readings(uuid,uuid,integer,integer) to authenticated;

create function public.create_cycle_invoice(org uuid,target_room uuid,target_cycle uuid,invoice_period date,deadline date,e_old integer,e_new integer,w_old integer,w_new integer) returns uuid language plpgsql security definer set search_path='' as $$
declare rates public.property_service_rates%rowtype;room public.rooms%rowtype;previous public.invoices%rowtype;cycle public.room_billing_cycles%rowtype;result uuid;next_e integer;next_w integer;begin
 if not public.has_role(org,array['admin','manager']) then raise exception 'Bạn không có quyền lập hóa đơn'; end if;
 select * into room from public.rooms where id=target_room and organization_id=org for update;
 if not found then raise exception 'Không tìm thấy phòng'; end if;
 perform 1 from public.properties where id=room.property_id and deleted_at is null for share;
 if not found then raise exception 'Căn hộ đã xóa; không thể lập hóa đơn mới'; end if;
 if invoice_period>date_trunc('month',timezone('Asia/Ho_Chi_Minh',now()))::date then raise exception 'Không thể lập hóa đơn cho tháng tương lai'; end if;
 if deadline<invoice_period then raise exception 'Hạn thanh toán không được trước kỳ hóa đơn'; end if;
 if target_cycle is null and exists(select 1 from public.room_billing_cycles where room_id=target_room and starts_on<(invoice_period+interval '1 month')::date) then raise exception 'Cần chọn đợt thuê và mốc nhận phòng'; end if;
 if target_cycle is not null then
  select * into cycle from public.room_billing_cycles where id=target_cycle and organization_id=org and room_id=target_room for update;
  if not found then raise exception 'Đợt thuê không thuộc đúng phòng'; end if;
  if cycle.starts_on>=(invoice_period+interval '1 month')::date then raise exception 'Kỳ hóa đơn trước ngày nhận phòng'; end if;
  if (not cycle.is_legacy or exists(select 1 from public.tenants where billing_cycle_id=target_cycle)) and not exists(select 1 from public.tenants t where t.billing_cycle_id=target_cycle and t.move_in<(invoice_period+interval '1 month')::date and (t.move_out is null or (t.move_out>invoice_period and t.move_out>t.move_in))) then raise exception 'Đợt thuê không có người ở trong kỳ này'; end if;
 end if;
 if exists(select 1 from public.invoices where room_id=target_room and billing_cycle_id is not distinct from target_cycle and period>=invoice_period) then raise exception 'Kỳ hóa đơn đã tồn tại hoặc trước kỳ đã lập trong đợt thuê'; end if;
 select * into previous from public.invoices where room_id=target_room and billing_cycle_id is not distinct from target_cycle order by period desc limit 1;
 if found then
  if e_old<>previous.electricity_new or w_old<>previous.water_new then raise exception 'Chỉ số cũ phải khớp kỳ hóa đơn trước của đợt thuê'; end if;
 elsif target_cycle is not null then
  if cycle.electricity_initial is null then raise exception 'Cần ghi chỉ số nhận phòng trước khi lập hóa đơn đầu tiên'; end if;
  if e_old is distinct from cycle.electricity_initial or w_old is distinct from cycle.water_initial then raise exception 'Chỉ số cũ phải khớp mốc điện/nước lúc nhận phòng'; end if;
 end if;
 if target_cycle is not null then
  select c.electricity_initial,c.water_initial into next_e,next_w from public.room_billing_cycles c where c.room_id=target_room and c.starts_on>cycle.starts_on and c.electricity_initial is not null and exists(select 1 from public.tenants where billing_cycle_id=c.id) order by c.starts_on limit 1;
  if found and (e_new>next_e or w_new>next_w) then raise exception 'Chỉ số tổng kết không được vượt mốc nhận phòng của đợt sau'; end if;
 end if;
 select * into rates from public.property_service_rates where organization_id=org and property_id=room.property_id;
 if not found then raise exception 'Chưa thiết lập đơn giá cho căn hộ này'; end if;
 insert into public.invoices(organization_id,room_id,billing_cycle_id,period,due_date,electricity_old,electricity_new,water_old,water_new,electricity_rate,water_rate,trash_fee,wifi_fee,laundry_fee,room_rent,created_by)
 values(org,target_room,target_cycle,invoice_period,deadline,e_old,e_new,w_old,w_new,rates.electricity,rates.water,rates.trash,rates.wifi,rates.laundry,room.monthly_rent,auth.uid()) returning id into result;
 return result;
end $$;
revoke all on function public.create_cycle_invoice(uuid,uuid,uuid,date,date,integer,integer,integer,integer) from public;
grant execute on function public.create_cycle_invoice(uuid,uuid,uuid,date,date,integer,integer,integer,integer) to authenticated;
-- Backward compatible callers select the single applicable cycle; ambiguous months require an explicit choice.
create or replace function public.create_invoice(org uuid,target_room uuid,invoice_period date,deadline date,e_old integer,e_new integer,w_old integer,w_new integer) returns uuid language plpgsql security definer set search_path='' as $$
declare cycle uuid;count_cycles integer;begin
 if not public.has_role(org,array['admin','manager']) then raise exception 'Bạn không có quyền lập hóa đơn'; end if;
 select count(*)::integer into count_cycles from public.room_billing_cycles c where c.room_id=target_room and c.organization_id=org and c.starts_on<(invoice_period+interval '1 month')::date and ((c.is_legacy and not exists(select 1 from public.tenants where billing_cycle_id=c.id)) or exists(select 1 from public.tenants t where t.billing_cycle_id=c.id and t.move_in<(invoice_period+interval '1 month')::date and (t.move_out is null or (t.move_out>invoice_period and t.move_out>t.move_in))));
 if count_cycles>1 then raise exception 'Tháng có nhiều đợt thuê; hãy chọn đợt thuê để lập hóa đơn'; end if;
 select c.id into cycle from public.room_billing_cycles c where c.room_id=target_room and c.organization_id=org and c.starts_on<(invoice_period+interval '1 month')::date and ((c.is_legacy and not exists(select 1 from public.tenants where billing_cycle_id=c.id)) or exists(select 1 from public.tenants t where t.billing_cycle_id=c.id and t.move_in<(invoice_period+interval '1 month')::date and (t.move_out is null or (t.move_out>invoice_period and t.move_out>t.move_in))));
 return public.create_cycle_invoice(org,target_room,cycle,invoice_period,deadline,e_old,e_new,w_old,w_new);
end $$;
-- Invoice participants must come from the selected billing cycle, including departed residents.
create or replace function public.snapshot_document_tenants() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='invoices' then
  perform 1 from public.tenants t where t.room_id=new.room_id and t.organization_id=new.organization_id and t.billing_cycle_id is not distinct from new.billing_cycle_id and t.move_in<(new.period+interval '1 month')::date and t.move_in<=timezone('Asia/Ho_Chi_Minh',new.created_at)::date and (t.move_out is null or (t.move_out>new.period and t.move_out>t.move_in)) order by t.id for share;
  insert into public.invoice_tenants(organization_id,invoice_id,tenant_id) select new.organization_id,new.id,t.id from public.tenants t where t.room_id=new.room_id and t.organization_id=new.organization_id and t.billing_cycle_id is not distinct from new.billing_cycle_id and t.move_in<(new.period+interval '1 month')::date and t.move_in<=timezone('Asia/Ho_Chi_Minh',new.created_at)::date and (t.move_out is null or (t.move_out>new.period and t.move_out>t.move_in));
 else
  perform 1 from public.tenants t where t.room_id=new.room_id and t.organization_id=new.organization_id and t.move_in<=new.ends_on and t.move_in<=timezone('Asia/Ho_Chi_Minh',new.created_at)::date and (t.move_out is null or (t.move_out>new.starts_on and t.move_out>t.move_in)) order by t.id for share;
  insert into public.contract_tenants(organization_id,contract_id,tenant_id) select new.organization_id,new.id,t.id from public.tenants t where t.room_id=new.room_id and t.organization_id=new.organization_id and t.move_in<=new.ends_on and t.move_in<=timezone('Asia/Ho_Chi_Minh',new.created_at)::date and (t.move_out is null or (t.move_out>new.starts_on and t.move_out>t.move_in));
 end if;return new;
end $$;
-- Empty property deletion also removes unused billing cycles; historical properties are still archived.
create or replace function public.delete_property(org uuid, target_property uuid, confirmation_name text) returns void
language plpgsql security definer set search_path='' as $$
declare property public.properties%rowtype; today date:=timezone('Asia/Ho_Chi_Minh',now())::date;
begin
 if not public.has_role(org,array['admin','manager']) then raise exception 'Bạn không có quyền xóa căn hộ'; end if;
 select * into property from public.properties where id=target_property and organization_id=org and deleted_at is null for update;
 if not found then raise exception 'Không tìm thấy căn hộ'; end if;
 if confirmation_name is distinct from property.name then raise exception 'Tên xác nhận không khớp với tên căn hộ'; end if;
 perform 1 from public.rooms where property_id=target_property and organization_id=org order by id for update;
 perform 1 from public.tenants t join public.rooms r on r.id=t.room_id where r.property_id=target_property order by t.id for update of t;
 -- Include scheduled stays: deleting a booked property would silently lose a booking.
 if exists(select 1 from public.tenants t join public.rooms r on r.id=t.room_id where r.property_id=target_property and (t.move_out is null or (t.move_out>today and t.move_out>t.move_in)))
 then raise exception 'Căn hộ còn người đang ở hoặc lịch vào ở chưa kết thúc. Hãy ghi nhận chuyển đi hoặc xử lý lịch vào ở trước khi xóa'; end if;
 if exists(select 1 from public.tenants t join public.rooms r on r.id=t.room_id where r.property_id=target_property)
 or exists(select 1 from public.contracts c join public.rooms r on r.id=c.room_id where r.property_id=target_property)
 or exists(select 1 from public.invoices i join public.rooms r on r.id=i.room_id where r.property_id=target_property)
 or exists(select 1 from storage.objects o join public.rooms r on r.id::text=split_part(o.name,'/',2) where o.bucket_id='contracts' and split_part(o.name,'/',1)=org::text and r.property_id=target_property)
 then
  update public.properties set deleted_at=now() where id=target_property;
 else
  delete from public.property_service_rates where property_id=target_property and organization_id=org;
  delete from public.room_billing_cycles where room_id in (select id from public.rooms where property_id=target_property);
  delete from public.rooms where property_id=target_property and organization_id=org;
  delete from public.properties where id=target_property and organization_id=org;
 end if;
end $$;
notify pgrst, 'reload schema';
commit;
