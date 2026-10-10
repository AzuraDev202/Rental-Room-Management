-- Apply after 008. Water can be billed per m³ or per resident/month.
begin;
alter table public.property_service_rates add column water_mode text not null default 'meter' check(water_mode in ('meter','person'));
alter table public.room_billing_cycles add column water_meter_ready boolean not null default true;
alter table public.tenants add column water_meter_on_arrival boolean not null default true;
alter table public.invoices add column water_mode text not null default 'meter' check(water_mode in ('meter','person')),add column water_count integer,add column water_unit_rate bigint,add column water_fee bigint not null default 0;
-- Preserve old values exactly; a checked formula and insert trigger now include flat water fees.
alter table public.invoices alter column total drop expression;
alter table public.invoices alter column total set not null;
alter table public.invoices add constraint invoice_total_formula check(total=(electricity_new::bigint-electricity_old)*electricity_rate+(water_new::bigint-water_old)*water_rate+trash_fee+wifi_fee+laundry_fee+room_rent+water_fee);
alter table public.invoices add constraint water_snapshot check((water_mode='meter' and water_fee=0) or (water_mode='person' and water_count>=0 and water_count is not null and water_unit_rate>=0 and water_unit_rate is not null and water_fee=water_count::bigint*water_unit_rate and water_rate=0 and water_new=water_old));
create function public.prepare_water_arrival() returns trigger language plpgsql security definer set search_path='' as $$
declare mode text;begin
 perform 1 from public.rooms where id=new.room_id and organization_id=new.organization_id for update;
 select s.water_mode into mode from public.property_service_rates s join public.rooms r on r.property_id=s.property_id where r.id=new.room_id for share of s;
 new.water_meter_on_arrival:=coalesce(mode,'meter')='meter';
 if mode='person' then select coalesce(max(water_new),0) into new.water_initial from public.invoices where room_id=new.room_id; end if;
 return new;
end $$;
revoke all on function public.prepare_water_arrival() from public;
create trigger a_prepare_water_arrival before insert on public.tenants for each row execute function public.prepare_water_arrival();
create function public.mark_water_arrival() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not new.water_meter_on_arrival then update public.room_billing_cycles set water_meter_ready=false where id=new.billing_cycle_id; end if;
 return new;
end $$;
revoke all on function public.mark_water_arrival() from public;
create trigger mark_water_arrival after insert on public.tenants for each row execute function public.mark_water_arrival();
create function public.set_water_baseline(org uuid,target_cycle uuid,water integer) returns void language plpgsql security definer set search_path='' as $$
declare cycle public.room_billing_cycles%rowtype;last_water integer;begin
 if not public.has_role(org,array['admin','manager']) then raise exception 'Bạn không có quyền ghi mốc nước'; end if;
 select * into cycle from public.room_billing_cycles where id=target_cycle and organization_id=org;
 if not found then raise exception 'Không tìm thấy đợt thuê'; end if;
 perform 1 from public.rooms where id=cycle.room_id for update;
 select * into cycle from public.room_billing_cycles where id=target_cycle for update;
 if cycle.water_meter_ready then raise exception 'Mốc nước đã được ghi'; end if;
 if cycle.starts_on>timezone('Asia/Ho_Chi_Minh',now())::date then raise exception 'Chưa đến ngày nhận phòng'; end if;
 if not exists(select 1 from public.property_service_rates s join public.rooms r on r.property_id=s.property_id where r.id=cycle.room_id and s.water_mode='meter') then raise exception 'Nước đang tính theo người'; end if;
 select max(water_new) into last_water from public.invoices where room_id=cycle.room_id;
 if water is null or water<0 or water<greatest(coalesce(last_water,0),coalesce(cycle.water_initial,0)) then raise exception 'Mốc nước phải là số nguyên không âm và không nhỏ hơn chỉ số đã chốt'; end if;
 update public.room_billing_cycles set water_initial=water,water_meter_ready=true where id=target_cycle;
end $$;
revoke all on function public.set_water_baseline(uuid,uuid,integer) from public;
grant execute on function public.set_water_baseline(uuid,uuid,integer) to authenticated;
create function public.set_arrival_readings(org uuid,target_cycle uuid,electricity integer,water integer) returns void language plpgsql security definer set search_path='' as $$
declare mode text;target_room uuid;begin
 if not public.has_role(org,array['admin','manager']) then raise exception 'Bạn không có quyền ghi chỉ số nhận phòng'; end if;
 select room_id into target_room from public.room_billing_cycles where id=target_cycle and organization_id=org;
 perform 1 from public.rooms where id=target_room for update;
 select s.water_mode into mode from public.property_service_rates s join public.rooms r on r.property_id=s.property_id where r.id=target_room for share of s;
 if mode='person' then select coalesce(max(water_new),0) into water from public.invoices where room_id=target_room; end if;
 perform public.set_initial_room_readings(org,target_cycle,electricity,water);
 update public.room_billing_cycles set water_meter_ready=(coalesce(mode,'meter')='meter') where id=target_cycle;
end $$;
revoke all on function public.set_arrival_readings(uuid,uuid,integer,integer) from public;
grant execute on function public.set_arrival_readings(uuid,uuid,integer,integer) to authenticated;
create function public.snapshot_water_and_total() returns trigger language plpgsql security definer set search_path='' as $$
begin
 select water_mode into new.water_mode from public.property_service_rates s join public.rooms r on r.property_id=s.property_id where r.id=new.room_id for share of s;
 new.water_mode:=coalesce(new.water_mode,'meter');
 new.water_unit_rate:=new.water_rate;
 if new.water_mode='person' then
  new.water_count:=new.laundry_count;new.water_fee:=new.water_unit_rate*new.water_count;new.water_rate:=0;
  select coalesce((select water_new from public.invoices where billing_cycle_id=new.billing_cycle_id order by period desc limit 1),(select water_initial from public.room_billing_cycles where id=new.billing_cycle_id),0) into new.water_old;
  new.water_new:=new.water_old;
  update public.room_billing_cycles set water_meter_ready=false where id=new.billing_cycle_id;
 else new.water_count:=null;new.water_fee:=0; end if;
 new.total:=(new.electricity_new::bigint-new.electricity_old)*new.electricity_rate+(new.water_new::bigint-new.water_old)*new.water_rate+new.trash_fee+new.wifi_fee+new.laundry_fee+new.room_rent+new.water_fee;
 return new;
end $$;
revoke all on function public.snapshot_water_and_total() from public;
-- Runs after snapshot_laundry_people, which locks residents and captures their count.
create trigger z_snapshot_water_and_total before insert on public.invoices for each row execute function public.snapshot_water_and_total();
create or replace function public.create_cycle_invoice(org uuid,target_room uuid,target_cycle uuid,invoice_period date,deadline date,e_old integer,e_new integer,w_old integer,w_new integer) returns uuid language plpgsql security definer set search_path='' as $$
declare rates public.property_service_rates%rowtype;room public.rooms%rowtype;previous public.invoices%rowtype;cycle public.room_billing_cycles%rowtype;result uuid;next_e integer;next_w integer;begin
 if not public.has_role(org,array['admin','manager']) then raise exception 'Bạn không có quyền lập hóa đơn'; end if;
 select * into room from public.rooms where id=target_room and organization_id=org for update;
 if not found then raise exception 'Không tìm thấy phòng'; end if;
 perform 1 from public.properties where id=room.property_id and deleted_at is null for share;
 if not found then raise exception 'Căn hộ đã xóa; không thể lập hóa đơn mới'; end if;
 perform 1 from public.property_service_rates where property_id=room.property_id for share;
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
  if e_old<>previous.electricity_new or ((select water_mode from public.property_service_rates where property_id=room.property_id)<>'person' and previous.water_mode<>'person' and w_old<>previous.water_new) then raise exception 'Chỉ số cũ phải khớp kỳ hóa đơn trước của đợt thuê'; end if;
   if (select water_mode from public.property_service_rates where property_id=room.property_id)<>'person' and previous.water_mode='person' and (not cycle.water_meter_ready or ((select water_mode from public.property_service_rates where property_id=room.property_id)<>'person' and w_old is distinct from cycle.water_initial)) then raise exception 'Cần ghi mốc nước khi chuyển sang tính theo m³'; end if;
 elsif target_cycle is not null then
  if cycle.electricity_initial is null then raise exception 'Cần ghi chỉ số nhận phòng trước khi lập hóa đơn đầu tiên'; end if;
  if e_old is distinct from cycle.electricity_initial or ((select water_mode from public.property_service_rates where property_id=room.property_id)<>'person' and w_old is distinct from cycle.water_initial) then raise exception 'Chỉ số cũ phải khớp mốc điện/nước lúc nhận phòng'; end if;
 end if;
 if target_cycle is not null then
  select c.electricity_initial,case when c.water_meter_ready then c.water_initial else null end into next_e,next_w from public.room_billing_cycles c where c.room_id=target_room and c.starts_on>cycle.starts_on and c.electricity_initial is not null and exists(select 1 from public.tenants where billing_cycle_id=c.id) order by c.starts_on limit 1;
  if found and (e_new>next_e or ((select water_mode from public.property_service_rates where property_id=room.property_id)<>'person' and w_new>next_w)) then raise exception 'Chỉ số tổng kết không được vượt mốc nhận phòng của đợt sau'; end if;
 end if;
 select * into rates from public.property_service_rates where organization_id=org and property_id=room.property_id for share;
 if rates.water_mode='meter' and target_cycle is not null and not cycle.water_meter_ready then raise exception 'Cần ghi mốc nước khi chọn tính theo m³'; end if;
 if not found then raise exception 'Chưa thiết lập đơn giá cho căn hộ này'; end if;
 insert into public.invoices(organization_id,room_id,billing_cycle_id,period,due_date,electricity_old,electricity_new,water_old,water_new,electricity_rate,water_rate,trash_fee,wifi_fee,laundry_fee,room_rent,created_by)
 values(org,target_room,target_cycle,invoice_period,deadline,e_old,e_new,w_old,w_new,rates.electricity,rates.water,rates.trash,rates.wifi,rates.laundry,room.monthly_rent,auth.uid()) returning id into result;
 return result;
end $$;
create function public.create_water_invoice(org uuid,target_room uuid,target_cycle uuid,invoice_period date,deadline date,e_old integer,e_new integer,w_old integer,w_new integer) returns uuid language sql security invoker set search_path='' as $$
 select public.create_cycle_invoice(org,target_room,target_cycle,invoice_period,deadline,e_old,e_new,w_old,w_new);
$$;
revoke all on function public.create_water_invoice(uuid,uuid,uuid,date,date,integer,integer,integer,integer) from public;
grant execute on function public.create_water_invoice(uuid,uuid,uuid,date,date,integer,integer,integer,integer) to authenticated;
notify pgrst,'reload schema';
commit;
