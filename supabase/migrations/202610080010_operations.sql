-- Apply after 009. Deposit ledger, expenses and maintenance; no sample records.
begin;
create table public.deposit_entries (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 tenant_id uuid not null, kind text not null check(kind in ('receive','refund','deduct')),
 amount bigint not null check(amount>0 and amount<=1000000000000), happened_on date not null,
 note text not null check(length(trim(note)) between 1 and 500), request_id uuid not null unique,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 foreign key(tenant_id,organization_id) references public.tenants(id,organization_id)
);
create table public.maintenance_requests (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),room_id uuid not null,
 title text not null check(length(trim(title)) between 1 and 120),description text not null default '' check(length(description)<=2000),
 priority text not null check(priority in ('low','normal','high')),status text not null default 'new' check(status in ('new','in_progress','done','cancelled')),
 created_at timestamptz not null default now(), unique(id,organization_id),
 foreign key(room_id,organization_id) references public.rooms(id,organization_id)
);
create table public.expenses (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),property_id uuid not null,
 room_id uuid,maintenance_id uuid,amount bigint not null check(amount>0 and amount<=1000000000000),
 category text not null check(category in ('maintenance','utilities','operations','other')),
 title text not null check(length(trim(title)) between 1 and 120),paid_on date not null,
 created_at timestamptz not null default now(),voided_at timestamptz,
 foreign key(property_id,organization_id) references public.properties(id,organization_id),
 foreign key(room_id,organization_id) references public.rooms(id,organization_id),
 foreign key(maintenance_id,organization_id) references public.maintenance_requests(id,organization_id)
);
create index deposit_tenant on public.deposit_entries(organization_id,tenant_id);
create index expense_period on public.expenses(organization_id,paid_on);
create index maintenance_room on public.maintenance_requests(organization_id,room_id);
alter table public.deposit_entries enable row level security;
alter table public.expenses enable row level security;
alter table public.maintenance_requests enable row level security;
grant select on public.deposit_entries,public.expenses,public.maintenance_requests to authenticated;
grant insert on public.expenses,public.maintenance_requests to authenticated;
grant update(title,description,priority,status) on public.maintenance_requests to authenticated;
do $$ declare t text;begin
 foreach t in array array['deposit_entries','expenses','maintenance_requests'] loop
 execute format('create policy read_workspace on public.%I for select to authenticated using(public.has_role(organization_id,array[''admin'',''manager'',''viewer'']))',t);
 end loop;
 foreach t in array array['expenses','maintenance_requests'] loop
 execute format('create policy insert_workspace on public.%I for insert to authenticated with check(public.has_role(organization_id,array[''admin'',''manager'']))',t);
 end loop;
end $$;
create policy maintain_workspace on public.maintenance_requests for update to authenticated using(public.has_role(organization_id,array['admin','manager'])) with check(public.has_role(organization_id,array['admin','manager']));
create function public.record_deposit(org uuid,target_tenant uuid,event_kind text,event_amount bigint,event_date date,event_note text,request uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare held bigint;result uuid;prior public.deposit_entries%rowtype;begin
 if not public.has_role(org,array['admin','manager']) then raise exception 'Bạn không có quyền quản lý đặt cọc'; end if;
 perform 1 from public.tenants where id=target_tenant and organization_id=org for update;
 if not found then raise exception 'Không tìm thấy người thuê'; end if;
 select * into prior from public.deposit_entries where request_id=request;
 if found then
  if prior.organization_id=org and prior.tenant_id=target_tenant and prior.kind=event_kind and prior.amount=event_amount and prior.happened_on=event_date and prior.note=trim(event_note) then return prior.id; end if;
  raise exception 'Mã ghi nhận đã được sử dụng';
 end if;
 if event_kind not in ('receive','refund','deduct') or event_kind is null or event_amount is null or event_amount<=0 or event_date is null or event_date>timezone('Asia/Ho_Chi_Minh',now())::date then raise exception 'Thông tin đặt cọc không hợp lệ'; end if;
 select coalesce(sum(case when kind='receive' then amount else -amount end),0) into held from public.deposit_entries where tenant_id=target_tenant and organization_id=org;
 if event_kind<>'receive' and event_amount>held then raise exception 'Số tiền vượt số cọc còn giữ'; end if;
 insert into public.deposit_entries(organization_id,tenant_id,kind,amount,happened_on,note,request_id,created_by) values(org,target_tenant,event_kind,event_amount,event_date,trim(event_note),request,auth.uid()) returning id into result;
 return result;
end $$;
revoke all on function public.record_deposit(uuid,uuid,text,bigint,date,text,uuid) from public;
grant execute on function public.record_deposit(uuid,uuid,text,bigint,date,text,uuid) to authenticated;
create function public.check_operation_links() returns trigger language plpgsql security definer set search_path='' as $$
declare prop uuid;maintenance_room uuid;begin
 if tg_table_name='expenses' then
  prop:=new.property_id;
  if new.room_id is not null and not exists(select 1 from public.rooms where id=new.room_id and property_id=prop and organization_id=new.organization_id) then raise exception 'Phòng không thuộc căn hộ'; end if;
  if new.maintenance_id is not null then
   select room_id into maintenance_room from public.maintenance_requests where id=new.maintenance_id and organization_id=new.organization_id;
   if maintenance_room is distinct from new.room_id then raise exception 'Chi phí phải thuộc đúng phòng của sự cố'; end if;
  end if;
  if new.paid_on>timezone('Asia/Ho_Chi_Minh',now())::date then raise exception 'Ngày chi không được ở tương lai'; end if;
 else select property_id into prop from public.rooms where id=new.room_id and organization_id=new.organization_id; end if;
 perform 1 from public.properties where id=prop and organization_id=new.organization_id and deleted_at is null for share;
 if not found then raise exception 'Căn hộ không tồn tại hoặc đã xóa'; end if;
 return new;
end $$;
revoke all on function public.check_operation_links() from public;
create trigger check_expense_links before insert on public.expenses for each row execute function public.check_operation_links();
create trigger check_maintenance_links before insert or update on public.maintenance_requests for each row execute function public.check_operation_links();
create function public.void_expense(org uuid,target_expense uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.has_role(org,array['admin','manager']) then raise exception 'Bạn không có quyền hủy khoản chi'; end if;
 update public.expenses set voided_at=coalesce(voided_at,now()) where id=target_expense and organization_id=org;
 if not found then raise exception 'Không tìm thấy khoản chi'; end if;
end $$;
revoke all on function public.void_expense(uuid,uuid) from public;
grant execute on function public.void_expense(uuid,uuid) to authenticated;
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
 or exists(select 1 from public.expenses where property_id=target_property and organization_id=org) or exists(select 1 from public.maintenance_requests m join public.rooms r on r.id=m.room_id where r.property_id=target_property and m.organization_id=org) then
  update public.properties set deleted_at=now() where id=target_property;
 else
  delete from public.property_service_rates where property_id=target_property and organization_id=org;
  delete from public.rooms where property_id=target_property and organization_id=org;
  delete from public.properties where id=target_property and organization_id=org;
 end if;
end $$;
notify pgrst,'reload schema';
commit;
