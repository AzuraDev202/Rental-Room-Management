-- Apply after 011. Corrections retain invoices and deposit ledger history.
begin;
alter table public.room_billing_cycles add column lease_ends_on date check(lease_ends_on is null or lease_ends_on>=starts_on);
create function public.edit_room_lease(org uuid,target_cycle uuid,end_date date,deposit_amount bigint,electricity integer,water integer) returns void language plpgsql security definer set search_path='' as $$
declare cycle public.room_billing_cycles%rowtype;target_room uuid;mode text;held bigint;remaining bigint;person record;recipient uuid;previous_e integer;previous_w integer;begin
 if not public.has_role(org,array['admin','manager']) then raise exception 'Bạn không có quyền sửa thông tin thuê phòng'; end if;
 select room_id into target_room from public.room_billing_cycles where id=target_cycle and organization_id=org;
 if not found then raise exception 'Không tìm thấy đợt thuê'; end if;
 perform 1 from public.rooms where id=target_room and organization_id=org for update;
 perform 1 from public.properties p join public.rooms r on r.property_id=p.id where r.id=target_room and p.deleted_at is null for share of p;
 if not found then raise exception 'Căn hộ đã xóa; không thể sửa thông tin thuê phòng'; end if;
 select * into cycle from public.room_billing_cycles where id=target_cycle for update;
 if end_date is not null and end_date<cycle.starts_on then raise exception 'Ngày kết thúc không được trước ngày vào ở'; end if;
 if deposit_amount is null or deposit_amount<0 then raise exception 'Tiền cọc phải là số nguyên không âm'; end if;
 select coalesce(s.water_mode,'meter') into mode from public.rooms r left join public.property_service_rates s on s.property_id=r.property_id where r.id=target_room;
 if electricity is null or electricity<0 or (mode='meter' and (water is null or water<0)) then raise exception 'Chỉ số ban đầu phải là số nguyên không âm'; end if;
 if exists(select 1 from public.invoices where billing_cycle_id=target_cycle) then
  if electricity is distinct from cycle.electricity_initial or (mode='meter' and water is distinct from cycle.water_initial) then raise exception 'Đợt thuê đã có hóa đơn; không thể sửa chỉ số ban đầu'; end if;
 else
  select electricity_new,water_new into previous_e,previous_w from public.invoices where room_id=target_room and billing_cycle_id is distinct from target_cycle and period<=date_trunc('month',cycle.starts_on)::date order by period desc,created_at desc limit 1;
  if found and (electricity<previous_e or (mode='meter' and water<previous_w)) then raise exception 'Chỉ số ban đầu không được nhỏ hơn chỉ số đã chốt trước đó'; end if;
  update public.room_billing_cycles set electricity_initial=electricity,water_initial=case when mode='meter' then water else water_initial end,water_meter_ready=(mode='meter') where id=target_cycle;
 end if;
 perform 1 from public.tenants where billing_cycle_id=target_cycle order by id for update;
 select id into recipient from public.tenants where billing_cycle_id=target_cycle and organization_id=org order by move_in,id limit 1;
 if recipient is null then raise exception 'Đợt thuê chưa có người thuê'; end if;
 select coalesce(sum(case when d.kind='receive' then d.amount else -d.amount end),0) into held from public.deposit_entries d join public.tenants t on t.id=d.tenant_id where t.billing_cycle_id=target_cycle and d.organization_id=org;
 if deposit_amount>held then
  perform public.record_deposit(org,recipient,'receive',deposit_amount-held,timezone('Asia/Ho_Chi_Minh',now())::date,'Điều chỉnh tiền cọc của phòng',gen_random_uuid());
 elsif deposit_amount<held then
  remaining:=held-deposit_amount;
  for person in select t.id,coalesce(sum(case when d.kind='receive' then d.amount else -d.amount end),0) as held from public.tenants t left join public.deposit_entries d on d.tenant_id=t.id where t.billing_cycle_id=target_cycle group by t.id order by t.id loop
   if person.held>0 and remaining>0 then
    perform public.record_deposit(org,person.id,'deduct',least(person.held,remaining)::bigint,timezone('Asia/Ho_Chi_Minh',now())::date,'Điều chỉnh tiền cọc của phòng',gen_random_uuid());
    remaining:=remaining-least(person.held,remaining);
   end if;
  end loop;
 end if;
 update public.room_billing_cycles set lease_ends_on=end_date where id=target_cycle;
 if end_date is not null then
  if exists(select 1 from public.contracts c join public.contract_tenants l on l.contract_id=c.id join public.tenants t on t.id=l.tenant_id where t.billing_cycle_id=target_cycle and c.starts_on>end_date) then raise exception 'Ngày kết thúc không được trước ngày bắt đầu hợp đồng đã tải lên'; end if;
  update public.contracts c set ends_on=end_date where c.room_id=target_room and exists(select 1 from public.contract_tenants l join public.tenants t on t.id=l.tenant_id where l.contract_id=c.id and t.billing_cycle_id=target_cycle);
 end if;
end $$;
revoke all on function public.edit_room_lease(uuid,uuid,date,bigint,integer,integer) from public;
grant execute on function public.edit_room_lease(uuid,uuid,date,bigint,integer,integer) to authenticated;
notify pgrst,'reload schema';
commit;
