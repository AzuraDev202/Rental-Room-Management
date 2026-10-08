-- HH HOME: no sample records. Apply once on a new Supabase project.
create extension if not exists pgcrypto;
create table public.organizations (
 id uuid primary key default gen_random_uuid(), name text not null check (length(trim(name)) between 1 and 120), created_at timestamptz not null default now()
);
create table public.memberships (
 organization_id uuid not null references public.organizations(id), user_id uuid not null references auth.users(id),
 role text not null check (role in ('admin','manager','viewer')), display_name text not null, email text not null,
 primary key(organization_id,user_id)
);
create table public.invitations (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 email text not null, role text not null check(role in ('manager','viewer')), created_at timestamptz not null default now(),
 unique(organization_id,email)
);
create table public.properties (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 name text not null check(length(trim(name)) between 1 and 120), address text not null check(length(trim(address)) between 1 and 500),
 monthly_rent bigint not null check(monthly_rent between 0 and 1000000000000), created_at timestamptz not null default now(),
 unique(id,organization_id), unique(organization_id,name)
);
create table public.rooms (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 property_id uuid not null, name text not null check(length(trim(name)) between 1 and 80),
 monthly_rent bigint not null check(monthly_rent between 0 and 1000000000000),
 foreign key(property_id,organization_id) references public.properties(id,organization_id), unique(id,organization_id), unique(property_id,name)
);
create table public.tenants (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), room_id uuid not null,
 full_name text not null check(length(trim(full_name)) between 1 and 120), gender text not null check(gender in ('Nam','Nữ','Khác')),
 birth_date date not null, identity_number text not null check(identity_number ~ '^[0-9]{12}$'),
 phone text not null check(phone ~ '^0[0-9]{9}$'), email text, move_in date not null, move_out date,
 check(birth_date <= move_in), check(move_out is null or move_out >= move_in),
 foreign key(room_id,organization_id) references public.rooms(id,organization_id), unique(organization_id,identity_number)
);
create table public.service_rates (
 organization_id uuid primary key references public.organizations(id), electricity bigint not null default 0,
 water bigint not null default 0, trash bigint not null default 0, wifi bigint not null default 0, laundry bigint not null default 0,
 updated_at timestamptz not null default now(), check(least(electricity,water,trash,wifi,laundry)>=0),
 check(greatest(electricity,water,trash,wifi,laundry)<=1000000000000)
);
create table public.contracts (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), room_id uuid not null,
 file_name text not null, storage_path text not null unique, starts_on date not null, ends_on date not null,
 created_at timestamptz not null default now(), check(ends_on>=starts_on),
 check(split_part(storage_path,'/',1)=organization_id::text and split_part(storage_path,'/',2)=room_id::text),
 foreign key(room_id,organization_id) references public.rooms(id,organization_id)
);
create table public.invoices (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), room_id uuid not null,
 period date not null check(extract(day from period)=1), due_date date not null,
 electricity_old integer not null, electricity_new integer not null, water_old integer not null, water_new integer not null,
 electricity_rate bigint not null, water_rate bigint not null, trash_fee bigint not null, wifi_fee bigint not null, laundry_fee bigint not null, room_rent bigint not null,
 total bigint generated always as ((electricity_new::bigint-electricity_old)*electricity_rate + (water_new::bigint-water_old)*water_rate + trash_fee+wifi_fee+laundry_fee+room_rent) stored,
 created_at timestamptz not null default now(), created_by uuid not null references auth.users(id),
 check(electricity_old>=0 and electricity_new>=electricity_old and water_old>=0 and water_new>=water_old),
 check(least(electricity_rate,water_rate,trash_fee,wifi_fee,laundry_fee,room_rent)>=0),
 check(total between 0 and 1000000000000),
 foreign key(room_id,organization_id) references public.rooms(id,organization_id), unique(id,organization_id), unique(room_id,period)
);
create table public.payments (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), invoice_id uuid not null,
 amount bigint not null check(amount>0), paid_at timestamptz not null default now(), recorded_by uuid not null references auth.users(id),
 foreign key(invoice_id,organization_id) references public.invoices(id,organization_id)
);
create index memberships_user on public.memberships(user_id);
create index tenants_room on public.tenants(room_id);
create index invoices_org_period on public.invoices(organization_id,period);
create index payments_org_time on public.payments(organization_id,paid_at);
create index contracts_room on public.contracts(room_id);

create function public.has_role(org uuid, allowed text[]) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.memberships where organization_id=org and user_id=auth.uid() and role=any(allowed));
$$;
revoke all on function public.has_role(uuid,text[]) from public;
grant execute on function public.has_role(uuid,text[]) to authenticated;

-- Every tenant, room and file must belong to the same organization (composite FKs).
do $$ declare t text; begin
 foreach t in array array['organizations','memberships','invitations','properties','rooms','tenants','service_rates','contracts','invoices','payments'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on table public.%I from public, anon, authenticated',t);
 end loop;
end $$;
grant select on public.organizations,public.memberships,public.properties,public.rooms,public.tenants,public.service_rates,public.contracts,public.invoices,public.payments to authenticated;
grant select,insert,delete on public.invitations to authenticated;
grant insert,update on public.properties,public.rooms,public.tenants,public.service_rates to authenticated;
grant insert,delete on public.contracts to authenticated;
create policy org_read on public.organizations for select to authenticated using(public.has_role(id,array['admin','manager','viewer']));
create policy member_read on public.memberships for select to authenticated using(public.has_role(organization_id,array['admin','manager','viewer']));
create policy invitation_read on public.invitations for select to authenticated using(public.has_role(organization_id,array['admin']));
create policy invitation_add on public.invitations for insert to authenticated with check(public.has_role(organization_id,array['admin']) and email=lower(trim(email)));
create policy invitation_delete on public.invitations for delete to authenticated using(public.has_role(organization_id,array['admin']));
do $$ declare t text; begin
 foreach t in array array['properties','rooms','tenants','service_rates','contracts','invoices','payments'] loop
  execute format('create policy data_read on public.%I for select to authenticated using(public.has_role(organization_id,array[''admin'',''manager'',''viewer'']))',t);
 end loop;
 foreach t in array array['properties','rooms','tenants','service_rates'] loop
  execute format('create policy data_insert on public.%I for insert to authenticated with check(public.has_role(organization_id,array[''admin'',''manager'']))',t);
  execute format('create policy data_update on public.%I for update to authenticated using(public.has_role(organization_id,array[''admin'',''manager''])) with check(public.has_role(organization_id,array[''admin'',''manager'']))',t);
 end loop;
end $$;
create policy contract_insert on public.contracts for insert to authenticated with check(public.has_role(organization_id,array['admin','manager']));
create policy contract_delete on public.contracts for delete to authenticated using(public.has_role(organization_id,array['admin','manager']));

create function public.create_workspace(workspace_name text, member_name text) returns uuid language plpgsql security definer set search_path='' as $$
declare org uuid; user_email text; begin
 if auth.uid() is null then raise exception 'Bạn cần đăng nhập'; end if;
 if length(trim(member_name)) not between 1 and 120 then raise exception 'Họ tên không hợp lệ'; end if;
 select email into user_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
 if user_email is null then raise exception 'Vui lòng xác nhận email'; end if;
 insert into public.organizations(name) values(trim(workspace_name)) returning id into org;
 insert into public.memberships values(org,auth.uid(),'admin',trim(member_name),user_email);
 insert into public.service_rates(organization_id) values(org);
 return org;
end $$;
create function public.accept_invitations(member_name text) returns integer language plpgsql security definer set search_path='' as $$
declare user_email text; accepted integer; begin
 if auth.uid() is null then raise exception 'Bạn cần đăng nhập'; end if;
 if length(trim(member_name)) not between 1 and 120 then raise exception 'Họ tên không hợp lệ'; end if;
 select lower(email) into user_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
 if user_email is null then raise exception 'Vui lòng xác nhận email'; end if;
 insert into public.memberships(organization_id,user_id,role,display_name,email)
 select organization_id,auth.uid(),role,trim(member_name),user_email from public.invitations where email=user_email
 on conflict(organization_id,user_id) do nothing;
 get diagnostics accepted=row_count;
 delete from public.invitations where email=user_email;
 return accepted;
end $$;
create function public.set_member_role(org uuid, target_user uuid, new_role text) returns void language plpgsql security definer set search_path='' as $$
begin
 -- Serialize role changes and preserve at least one admin.
 perform 1 from public.organizations where id=org for update;
 if not public.has_role(org,array['admin']) then raise exception 'Bạn không có quyền quản trị'; end if;
 if new_role not in ('admin','manager','viewer') then raise exception 'Vai trò không hợp lệ'; end if;
 if exists(select 1 from public.memberships where organization_id=org and user_id=target_user and role='admin') and new_role<>'admin'
 and (select count(*) from public.memberships where organization_id=org and role='admin')=1 then raise exception 'Cần giữ ít nhất một quản trị viên'; end if;
 update public.memberships set role=new_role where organization_id=org and user_id=target_user;
 if not found then raise exception 'Không tìm thấy thành viên'; end if;
end $$;
create function public.create_property(org uuid, property_name text, property_address text, rent bigint, room_count integer) returns uuid language plpgsql security definer set search_path='' as $$
declare property uuid; begin
 if not public.has_role(org,array['admin','manager']) then raise exception 'Bạn không có quyền thêm căn hộ'; end if;
 if room_count is null or room_count not between 1 and 100 then raise exception 'Số phòng phải từ 1 đến 100'; end if;
 insert into public.properties(organization_id,name,address,monthly_rent) values(org,trim(property_name),trim(property_address),rent) returning id into property;
 insert into public.rooms(organization_id,property_id,name,monthly_rent) select org,property,'Phòng '||n,0 from generate_series(1,room_count) n;
 return property;
end $$;
create function public.create_invoice(org uuid, target_room uuid, invoice_period date, deadline date, e_old integer, e_new integer, w_old integer, w_new integer) returns uuid language plpgsql security definer set search_path='' as $$
declare rates public.service_rates%rowtype; room public.rooms%rowtype; previous public.invoices%rowtype; result uuid; begin
 if not public.has_role(org,array['admin','manager']) then raise exception 'Bạn không có quyền lập hóa đơn'; end if;
 select * into room from public.rooms where id=target_room and organization_id=org for update;
 if not found then raise exception 'Không tìm thấy phòng'; end if;
 if invoice_period>date_trunc('month',timezone('Asia/Ho_Chi_Minh',now()))::date then raise exception 'Không thể lập hóa đơn cho tháng tương lai'; end if;
 if deadline<invoice_period then raise exception 'Hạn thanh toán không được trước kỳ hóa đơn'; end if;
 if exists(select 1 from public.invoices where room_id=target_room and period>=invoice_period) then raise exception 'Kỳ hóa đơn đã tồn tại hoặc trước kỳ đã lập'; end if;
 select * into previous from public.invoices where room_id=target_room order by period desc limit 1;
 if found and (e_old<>previous.electricity_new or w_old<>previous.water_new) then raise exception 'Chỉ số cũ phải khớp kỳ hóa đơn trước'; end if;
 select * into rates from public.service_rates where organization_id=org;
 if not found then raise exception 'Chưa thiết lập đơn giá'; end if;
 insert into public.invoices(organization_id,room_id,period,due_date,electricity_old,electricity_new,water_old,water_new,electricity_rate,water_rate,trash_fee,wifi_fee,laundry_fee,room_rent,created_by)
 values(org,target_room,invoice_period,deadline,e_old,e_new,w_old,w_new,rates.electricity,rates.water,rates.trash,rates.wifi,rates.laundry,room.monthly_rent,auth.uid()) returning id into result;
 return result;
end $$;
create function public.record_payment(org uuid, target_invoice uuid, payment_amount bigint) returns uuid language plpgsql security definer set search_path='' as $$
declare bill public.invoices%rowtype; collected bigint; result uuid; begin
 if not public.has_role(org,array['admin','manager']) then raise exception 'Bạn không có quyền thu tiền'; end if;
 select * into bill from public.invoices where id=target_invoice and organization_id=org for update;
 if not found then raise exception 'Không tìm thấy hóa đơn'; end if;
 select coalesce(sum(amount),0) into collected from public.payments where invoice_id=target_invoice;
 if payment_amount is null or payment_amount<=0 or payment_amount>bill.total-collected then raise exception 'Số tiền vượt công nợ hoặc không hợp lệ'; end if;
 insert into public.payments(organization_id,invoice_id,amount,recorded_by) values(org,target_invoice,payment_amount,auth.uid()) returning id into result;
 return result;
end $$;
-- Functions are callable by authenticated users only, and enforce roles internally.
revoke all on function public.create_workspace(text,text),public.accept_invitations(text),public.set_member_role(uuid,uuid,text),public.create_property(uuid,text,text,bigint,integer),public.create_invoice(uuid,uuid,date,date,integer,integer,integer,integer),public.record_payment(uuid,uuid,bigint) from public;
grant execute on function public.create_workspace(text,text),public.accept_invitations(text),public.set_member_role(uuid,uuid,text),public.create_property(uuid,text,text,bigint,integer),public.create_invoice(uuid,uuid,date,date,integer,integer,integer,integer),public.record_payment(uuid,uuid,bigint) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('contracts','contracts',false,10485760,array['application/pdf','image/jpeg','image/png'])
 on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create function public.can_access_contract(path text, allowed text[]) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.rooms r where r.organization_id::text=split_part(path,'/',1) and r.id::text=split_part(path,'/',2) and public.has_role(r.organization_id,allowed));
$$;
revoke all on function public.can_access_contract(text,text[]) from public;
grant execute on function public.can_access_contract(text,text[]) to authenticated;
create policy contract_file_read on storage.objects for select to authenticated using(bucket_id='contracts' and public.can_access_contract(name,array['admin','manager','viewer']));
create policy contract_file_upload on storage.objects for insert to authenticated with check(bucket_id='contracts' and public.can_access_contract(name,array['admin','manager']));
create policy contract_file_delete on storage.objects for delete to authenticated using(bucket_id='contracts' and public.can_access_contract(name,array['admin','manager']));
