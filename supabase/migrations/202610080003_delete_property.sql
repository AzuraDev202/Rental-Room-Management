-- Apply after migrations 001 and 002. Delete only properties without business history.
begin;
-- Storage operations hold a room key lock so deletion cannot race an upload.
create function public.can_upload_contract(path text) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare org uuid;
begin
 select r.organization_id into org from public.rooms r
 where r.organization_id::text=split_part(path,'/',1) and r.id::text=split_part(path,'/',2)
 and public.has_role(r.organization_id,array['admin','manager']) for key share;
 return found;
end $$;

revoke all on function public.can_upload_contract(text) from public;
grant execute on function public.can_upload_contract(text) to authenticated;
alter policy contract_file_upload on storage.objects with check(bucket_id='contracts' and public.can_upload_contract(name));

create function public.delete_property(org uuid, target_property uuid, confirmation_name text) returns void
language plpgsql security definer set search_path='' as $$
declare property public.properties%rowtype;
begin
 if not public.has_role(org,array['admin','manager']) then raise exception 'Bạn không có quyền xóa căn hộ'; end if;
 select * into property from public.properties where id=target_property and organization_id=org for update;
 if not found then raise exception 'Không tìm thấy căn hộ'; end if;
 if confirmation_name is distinct from property.name then raise exception 'Tên xác nhận không khớp với tên căn hộ'; end if;
 perform 1 from public.rooms where property_id=target_property and organization_id=org order by id for update;
 if exists(select 1 from public.tenants t join public.rooms r on r.id=t.room_id where r.property_id=target_property)
 or exists(select 1 from public.contracts c join public.rooms r on r.id=c.room_id where r.property_id=target_property)
 or exists(select 1 from public.invoices i join public.rooms r on r.id=i.room_id where r.property_id=target_property)
 then raise exception 'Không thể xóa căn hộ đã có hồ sơ người thuê, hợp đồng hoặc hóa đơn. Lịch sử được giữ nguyên'; end if;
 if exists(select 1 from storage.objects o join public.rooms r on r.id::text=split_part(o.name,'/',2)
 where o.bucket_id='contracts' and split_part(o.name,'/',1)=org::text and r.property_id=target_property)
 then raise exception 'Không thể xóa căn hộ còn tệp hợp đồng trong kho lưu trữ'; end if;
 delete from public.property_service_rates where property_id=target_property and organization_id=org;
 delete from public.rooms where property_id=target_property and organization_id=org;
 delete from public.properties where id=target_property and organization_id=org;
end $$;
revoke all on function public.delete_property(uuid,uuid,text) from public;
grant execute on function public.delete_property(uuid,uuid,text) to authenticated;
notify pgrst, 'reload schema';
commit;
