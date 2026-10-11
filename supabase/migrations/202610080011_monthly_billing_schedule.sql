-- Run after 010. Existing invoices and amounts are preserved.
begin;
alter table public.invoices add column service_period date;
alter table public.invoices add constraint invoice_service_period_month check(service_period is null or service_period=(period-interval '1 month')::date);
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
 if deadline is distinct from invoice_period+4 then raise exception 'Hạn thu tiền phải là ngày 5 của tháng lập hóa đơn'; end if;
 if target_cycle is null then raise exception 'Cần chọn đợt thuê'; end if;
 if target_cycle is null and exists(select 1 from public.room_billing_cycles where room_id=target_room and starts_on<(invoice_period+interval '1 month')::date) then raise exception 'Cần chọn đợt thuê và mốc nhận phòng'; end if;
 if target_cycle is not null then
  select * into cycle from public.room_billing_cycles where id=target_cycle and organization_id=org and room_id=target_room for update;
  if not found then raise exception 'Đợt thuê không thuộc đúng phòng'; end if;
  if cycle.starts_on>=invoice_period then raise exception 'Phòng mới chỉ lập hóa đơn từ tháng sau tháng vào ở'; end if;
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
create or replace function public.snapshot_laundry_people() returns trigger language plpgsql security definer set search_path='' as $$
begin
 new.service_period:=(new.period-interval '1 month')::date;
 perform 1 from public.rooms where id=new.room_id and organization_id=new.organization_id for update;
 perform 1 from public.tenants t where t.room_id=new.room_id and t.organization_id=new.organization_id and t.billing_cycle_id is not distinct from new.billing_cycle_id and t.move_in<new.period and t.move_in<=timezone('Asia/Ho_Chi_Minh',new.created_at)::date and (t.move_out is null or (t.move_out>(new.period-interval '1 month')::date and t.move_out>t.move_in)) order by t.id for share;
 select count(*)::integer into new.laundry_count from public.tenants t where t.room_id=new.room_id and t.organization_id=new.organization_id and t.billing_cycle_id is not distinct from new.billing_cycle_id and t.move_in<new.period and t.move_in<=timezone('Asia/Ho_Chi_Minh',new.created_at)::date and (t.move_out is null or (t.move_out>(new.period-interval '1 month')::date and t.move_out>t.move_in));
 new.laundry_rate:=new.laundry_fee;
 new.laundry_fee:=new.laundry_rate*new.laundry_count;
 return new;
end $$;
create or replace function public.snapshot_document_tenants() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='invoices' then
  perform 1 from public.tenants t where t.room_id=new.room_id and t.organization_id=new.organization_id and t.billing_cycle_id is not distinct from new.billing_cycle_id and t.move_in<(new.period+interval '1 month')::date and t.move_in<=timezone('Asia/Ho_Chi_Minh',new.created_at)::date and (t.move_out is null or (t.move_out>coalesce(new.service_period,new.period) and t.move_out>t.move_in)) order by t.id for share;
  insert into public.invoice_tenants(organization_id,invoice_id,tenant_id) select new.organization_id,new.id,t.id from public.tenants t where t.room_id=new.room_id and t.organization_id=new.organization_id and t.billing_cycle_id is not distinct from new.billing_cycle_id and t.move_in<(new.period+interval '1 month')::date and t.move_in<=timezone('Asia/Ho_Chi_Minh',new.created_at)::date and (t.move_out is null or (t.move_out>coalesce(new.service_period,new.period) and t.move_out>t.move_in));
 else
  perform 1 from public.tenants t where t.room_id=new.room_id and t.organization_id=new.organization_id and t.move_in<=new.ends_on and t.move_in<=timezone('Asia/Ho_Chi_Minh',new.created_at)::date and (t.move_out is null or (t.move_out>new.starts_on and t.move_out>t.move_in)) order by t.id for share;
  insert into public.contract_tenants(organization_id,contract_id,tenant_id) select new.organization_id,new.id,t.id from public.tenants t where t.room_id=new.room_id and t.organization_id=new.organization_id and t.move_in<=new.ends_on and t.move_in<=timezone('Asia/Ho_Chi_Minh',new.created_at)::date and (t.move_out is null or (t.move_out>new.starts_on and t.move_out>t.move_in));
 end if;return new;
end $$;
create function public.create_monthly_invoice(org uuid,target_room uuid,target_cycle uuid,invoice_period date,deadline date,e_old integer,e_new integer,w_old integer,w_new integer) returns uuid language sql security invoker set search_path='' as $$
 select public.create_cycle_invoice(org,target_room,target_cycle,invoice_period,deadline,e_old,e_new,w_old,w_new);
$$;
revoke all on function public.create_monthly_invoice(uuid,uuid,uuid,date,date,integer,integer,integer,integer) from public;
grant execute on function public.create_monthly_invoice(uuid,uuid,uuid,date,date,integer,integer,integer,integer) to authenticated;
notify pgrst,'reload schema';
commit;
