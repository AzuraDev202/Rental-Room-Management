-- Apply after 012. Preserve all previously issued invoices and payments.
begin;
alter table public.invoices add column fixed_period date,add column fixed_room_days integer,add column fixed_person_days integer,add column fixed_month_days integer,add column arrival_bill boolean not null default false;
alter table public.invoices add constraint invoice_fixed_days check(fixed_period is null or (fixed_period=period and fixed_month_days between 28 and 31 and fixed_room_days between 0 and fixed_month_days and fixed_person_days>=0));
alter table public.invoices drop constraint invoice_laundry_snapshot;
alter table public.invoices add constraint invoice_laundry_snapshot check((laundry_rate is null and laundry_count is null) or (laundry_rate>=0 and laundry_count>=0 and laundry_fee=case when fixed_period is null then laundry_rate*laundry_count else round(laundry_rate::numeric*fixed_person_days/fixed_month_days)::bigint end));
alter table public.invoices drop constraint water_snapshot;
alter table public.invoices add constraint water_snapshot check((water_mode='meter' and water_fee=0) or (water_mode='person' and water_count>=0 and water_count is not null and water_unit_rate>=0 and water_unit_rate is not null and water_fee=case when fixed_period is null then water_count::bigint*water_unit_rate else round(water_unit_rate::numeric*fixed_person_days/fixed_month_days)::bigint end and water_rate=0 and water_new=water_old));
create or replace function public.snapshot_laundry_people() returns trigger language plpgsql security definer set search_path='' as $$
declare starts date;room_start date;next_month date:=(new.period+interval '1 month')::date;today date:=timezone('Asia/Ho_Chi_Minh',new.created_at)::date;begin
 perform 1 from public.rooms where id=new.room_id and organization_id=new.organization_id for update;
 select starts_on into starts from public.room_billing_cycles where id=new.billing_cycle_id;
 new.service_period:=(new.period-interval '1 month')::date;
 new.fixed_period:=new.period;
 new.fixed_month_days:=next_month-new.period;
 new.arrival_bill:=starts>=new.period;
 room_start:=greatest(new.period,starts);
 perform 1 from public.tenants t where t.billing_cycle_id=new.billing_cycle_id order by t.id for share;
 select count(*)::integer,coalesce(sum(greatest(0,least(coalesce(t.move_out,next_month),next_month)-greatest(t.move_in,new.period))),0)::integer into new.laundry_count,new.fixed_person_days from public.tenants t where t.billing_cycle_id=new.billing_cycle_id and t.move_in<next_month and t.move_in<=today and (t.move_out is null or (t.move_out>new.period and t.move_out>t.move_in));
 new.fixed_room_days:=case when new.laundry_count>0 then next_month-room_start else 0 end;
 new.room_rent:=round(new.room_rent::numeric*new.fixed_room_days/new.fixed_month_days)::bigint;
 new.trash_fee:=round(new.trash_fee::numeric*new.fixed_room_days/new.fixed_month_days)::bigint;
 new.wifi_fee:=round(new.wifi_fee::numeric*new.fixed_room_days/new.fixed_month_days)::bigint;
 new.laundry_rate:=new.laundry_fee;
 new.laundry_fee:=round(new.laundry_rate::numeric*new.fixed_person_days/new.fixed_month_days)::bigint;
 return new;
end $$;
create or replace function public.snapshot_water_and_total() returns trigger language plpgsql security definer set search_path='' as $$
begin
 select water_mode into new.water_mode from public.property_service_rates s join public.rooms r on r.property_id=s.property_id where r.id=new.room_id for share of s;
 new.water_mode:=coalesce(new.water_mode,'meter');
 new.water_unit_rate:=new.water_rate;
 if new.water_mode='person' then
  new.water_count:=new.laundry_count;new.water_fee:=round(new.water_unit_rate::numeric*new.fixed_person_days/new.fixed_month_days)::bigint;new.water_rate:=0;
  select coalesce((select water_new from public.invoices where billing_cycle_id=new.billing_cycle_id order by period desc limit 1),(select water_initial from public.room_billing_cycles where id=new.billing_cycle_id),0) into new.water_old;
  new.water_new:=new.water_old;
  update public.room_billing_cycles set water_meter_ready=false where id=new.billing_cycle_id;
 else new.water_count:=null;new.water_fee:=0; end if;
 new.total:=(new.electricity_new::bigint-new.electricity_old)*new.electricity_rate+(new.water_new::bigint-new.water_old)*new.water_rate+new.trash_fee+new.wifi_fee+new.laundry_fee+new.room_rent+new.water_fee;
 return new;
end $$;
create or replace function public.create_cycle_invoice(org uuid,target_room uuid,target_cycle uuid,invoice_period date,deadline date,e_old integer,e_new integer,w_old integer,w_new integer) returns uuid language plpgsql security definer set search_path='' as $$
declare rates public.property_service_rates%rowtype;room public.rooms%rowtype;previous public.invoices%rowtype;cycle public.room_billing_cycles%rowtype;result uuid;next_e integer;next_w integer;begin
 if not public.has_role(org,array['admin','manager']) then raise exception 'Bạn không có quyền lập hóa đơn'; end if;
 select * into room from public.rooms where id=target_room and organization_id=org for update;
 if not found then raise exception 'Không tìm thấy phòng'; end if;
 perform 1 from public.properties where id=room.property_id and deleted_at is null for share;
 if not found then raise exception 'Căn hộ đã xóa; không thể lập hóa đơn mới'; end if;
 perform 1 from public.property_service_rates where property_id=room.property_id for share;
 if invoice_period>date_trunc('month',timezone('Asia/Ho_Chi_Minh',now()))::date then raise exception 'Không thể lập hóa đơn cho tháng tương lai'; end if;
 if invoice_period is null or extract(day from invoice_period)<>1 then raise exception 'Kỳ hóa đơn phải là ngày 1 hàng tháng'; end if;
 
 if target_cycle is null then raise exception 'Cần chọn đợt thuê'; end if;
 if target_cycle is null and exists(select 1 from public.room_billing_cycles where room_id=target_room and starts_on<(invoice_period+interval '1 month')::date) then raise exception 'Cần chọn đợt thuê và mốc nhận phòng'; end if;
 if target_cycle is not null then
  select * into cycle from public.room_billing_cycles where id=target_cycle and organization_id=org and room_id=target_room for update;
  if not found then raise exception 'Đợt thuê không thuộc đúng phòng'; end if;
  if cycle.starts_on>=(invoice_period+interval '1 month')::date or cycle.starts_on>timezone('Asia/Ho_Chi_Minh',now())::date then raise exception 'Chưa đến ngày nhận phòng trong kỳ hóa đơn'; end if;
  if deadline is distinct from greatest(invoice_period+4,case when cycle.starts_on>=invoice_period then cycle.starts_on else invoice_period end) then raise exception 'Hạn thu tiền không đúng lịch hóa đơn'; end if;
  if cycle.starts_on>=invoice_period and (e_new is distinct from e_old or w_new is distinct from w_old) then raise exception 'Hóa đơn nhận phòng không tính chi phí theo chỉ số'; end if;
  if (not cycle.is_legacy or exists(select 1 from public.tenants where billing_cycle_id=target_cycle)) and not exists(select 1 from public.tenants t where t.billing_cycle_id=target_cycle and t.move_in<(invoice_period+interval '1 month')::date and (t.move_out is null or (t.move_out>(invoice_period-interval '1 month')::date and t.move_out>t.move_in))) then raise exception 'Đợt thuê không có người ở trong kỳ này'; end if;
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
 values(org,target_room,target_cycle,invoice_period,deadline,e_old,e_new,w_old,w_new,rates.electricity,rates.water,rates.trash,rates.wifi,rates.laundry,case when exists(select 1 from public.tenants t where t.billing_cycle_id=target_cycle and t.move_in<(invoice_period+interval '1 month')::date and (t.move_out is null or (t.move_out>invoice_period and t.move_out>t.move_in))) then room.monthly_rent else 0 end,auth.uid()) returning id into result;
 return result;
end $$;
create function public.create_advance_invoice(org uuid,target_room uuid,target_cycle uuid,invoice_period date,deadline date,e_old integer,e_new integer,w_old integer,w_new integer) returns uuid language sql security invoker set search_path='' as $$
 select public.create_cycle_invoice(org,target_room,target_cycle,invoice_period,deadline,e_old,e_new,w_old,w_new);
$$;
revoke all on function public.create_advance_invoice(uuid,uuid,uuid,date,date,integer,integer,integer,integer) from public;
grant execute on function public.create_advance_invoice(uuid,uuid,uuid,date,date,integer,integer,integer,integer) to authenticated;
notify pgrst,'reload schema';
commit;
