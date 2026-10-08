-- Apply after migrations 001-004. Remove vacant properties from current management,
-- retaining their historical tenant/document references when history exists.
begin;
alter table public.properties add column deleted_at timestamptz;
alter table public.properties drop constraint properties_organization_id_name_key;
create unique index properties_current_name on public.properties(organization_id,name) where deleted_at is null;
-- Only the authorized deletion RPC may set the archive marker.
revoke insert,update on public.properties from authenticated;
grant insert(id,organization_id,name,address,monthly_rent),update(name,address,monthly_rent) on public.properties to authenticated;

create function public.guard_archived_property_write() returns trigger
language plpgsql security definer set search_path='' as $$
declare target uuid; archived timestamptz; old_target uuid;
begin
 if tg_table_name='properties' then
  if tg_op='UPDATE' and old.deleted_at is not null then raise exception 'Căn hộ đã xóa; chỉ có thể xem lịch sử'; end if;
  return new;
 elsif tg_table_name in ('rooms','property_service_rates') then target:=new.property_id;
 else select property_id into target from public.rooms where id=new.room_id; end if;
 if tg_op='UPDATE' then
  if tg_table_name in ('rooms','property_service_rates') then old_target:=old.property_id;
  else select property_id into old_target from public.rooms where id=old.room_id; end if;
  select deleted_at into archived from public.properties where id=old_target for share;
  if archived is not null then
   if tg_table_name='tenants' then
    if new.room_id=old.room_id and new.organization_id=old.organization_id and new.move_in=old.move_in and new.move_out is not distinct from old.move_out then return new; end if;
   end if;
   raise exception 'Căn hộ đã xóa; không thể thay đổi dữ liệu phòng';
  end if;
 end if;
 select deleted_at into archived from public.properties where id=target for share;
 if archived is not null then
  -- Personal contact corrections are still allowed for archived tenant profiles.
  if tg_table_name='tenants' and tg_op='UPDATE' then
   if new.room_id=old.room_id and new.organization_id=old.organization_id and new.move_in=old.move_in and new.move_out is not distinct from old.move_out then return new; end if;
  end if;
  raise exception 'Căn hộ đã xóa; không thể thêm hoặc thay đổi dữ liệu phòng';
 end if;
 return new;
end $$;
revoke all on function public.guard_archived_property_write() from public;
do $$ declare t text; begin
 foreach t in array array['properties','rooms','tenants','contracts','invoices','property_service_rates'] loop
  execute format('create trigger guard_archived_property_write before insert or update on public.%I for each row execute function public.guard_archived_property_write()',t);
 end loop;
end $$;

create or replace function public.can_upload_contract(path text) returns boolean
language plpgsql volatile security definer set search_path='' as $$
begin
 perform 1 from public.rooms r join public.properties p on p.id=r.property_id
 where r.organization_id::text=split_part(path,'/',1) and r.id::text=split_part(path,'/',2)
 and p.deleted_at is null and public.has_role(r.organization_id,array['admin','manager']) for share of p for key share of r;
 return found;
end $$;
alter policy contract_file_delete on storage.objects using(bucket_id='contracts' and public.can_upload_contract(name));
alter policy contract_delete on public.contracts using(public.has_role(organization_id,array['admin','manager']) and exists(select 1 from public.rooms r join public.properties p on p.id=r.property_id where r.id=room_id and p.deleted_at is null));

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
 if exists(select 1 from public.tenants t join public.rooms r on r.id=t.room_id where r.property_id=target_property and (t.move_out is null or t.move_out>today))
 then raise exception 'Căn hộ còn người đang ở hoặc lịch vào ở chưa kết thúc. Hãy ghi nhận chuyển đi hoặc xử lý lịch vào ở trước khi xóa'; end if;
 if exists(select 1 from public.tenants t join public.rooms r on r.id=t.room_id where r.property_id=target_property)
 or exists(select 1 from public.contracts c join public.rooms r on r.id=c.room_id where r.property_id=target_property)
 or exists(select 1 from public.invoices i join public.rooms r on r.id=i.room_id where r.property_id=target_property)
 or exists(select 1 from storage.objects o join public.rooms r on r.id::text=split_part(o.name,'/',2) where o.bucket_id='contracts' and split_part(o.name,'/',1)=org::text and r.property_id=target_property)
 then
  update public.properties set deleted_at=now() where id=target_property;
 else
  delete from public.property_service_rates where property_id=target_property and organization_id=org;
  delete from public.rooms where property_id=target_property and organization_id=org;
  delete from public.properties where id=target_property and organization_id=org;
 end if;
end $$;
notify pgrst, 'reload schema';
commit;
