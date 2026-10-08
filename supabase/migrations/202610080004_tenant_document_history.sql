-- Keep original contracts, files, invoices and payments; snapshot their tenant participants.
begin;
alter table public.tenants add constraint tenants_id_org_unique unique(id,organization_id);
alter table public.contracts add constraint contracts_id_org_unique unique(id,organization_id);
create table public.invoice_tenants (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,
 invoice_id uuid not null, tenant_id uuid not null,
 foreign key(invoice_id,organization_id) references public.invoices(id,organization_id),
 foreign key(tenant_id,organization_id) references public.tenants(id,organization_id), unique(invoice_id,tenant_id)
);
create table public.contract_tenants (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,
 contract_id uuid not null, tenant_id uuid not null,
 foreign key(contract_id,organization_id) references public.contracts(id,organization_id),
 foreign key(tenant_id,organization_id) references public.tenants(id,organization_id), unique(contract_id,tenant_id)
);
create index invoice_tenants_tenant on public.invoice_tenants(tenant_id);
create index contract_tenants_tenant on public.contract_tenants(tenant_id);
alter table public.invoice_tenants enable row level security;
alter table public.contract_tenants enable row level security;
revoke all on public.invoice_tenants,public.contract_tenants from public,anon,authenticated;
grant select on public.invoice_tenants,public.contract_tenants to authenticated;
create policy invoice_tenants_read on public.invoice_tenants for select to authenticated using(public.has_role(organization_id,array['admin','manager','viewer']));
create policy contract_tenants_read on public.contract_tenants for select to authenticated using(public.has_role(organization_id,array['admin','manager','viewer']));
-- Associate existing documents with stays overlapping their billing/effective period.
insert into public.invoice_tenants(organization_id,invoice_id,tenant_id)
 select i.organization_id,i.id,t.id from public.invoices i join public.tenants t on t.room_id=i.room_id and t.organization_id=i.organization_id
 where t.move_in < (i.period+interval '1 month')::date and t.move_in<=timezone('Asia/Ho_Chi_Minh',i.created_at)::date and (t.move_out is null or t.move_out>i.period);
insert into public.contract_tenants(organization_id,contract_id,tenant_id)
 select c.organization_id,c.id,t.id from public.contracts c join public.tenants t on t.room_id=c.room_id and t.organization_id=c.organization_id
 where t.move_in<=c.ends_on and t.move_in<=timezone('Asia/Ho_Chi_Minh',c.created_at)::date and (t.move_out is null or t.move_out>c.starts_on);
create function public.snapshot_document_tenants() returns trigger language plpgsql security definer set search_path='' as $$
begin
 -- Lock participants against concurrent move-out/profile edits.
 if tg_table_name='invoices' then
  perform 1 from public.tenants t where t.room_id=new.room_id and t.organization_id=new.organization_id and t.move_in<(new.period+interval '1 month')::date and t.move_in<=timezone('Asia/Ho_Chi_Minh',new.created_at)::date and (t.move_out is null or t.move_out>new.period) order by t.id for share;
  insert into public.invoice_tenants(organization_id,invoice_id,tenant_id)
   select new.organization_id,new.id,t.id from public.tenants t where t.room_id=new.room_id and t.organization_id=new.organization_id and t.move_in<(new.period+interval '1 month')::date and t.move_in<=timezone('Asia/Ho_Chi_Minh',new.created_at)::date and (t.move_out is null or t.move_out>new.period);
 else
  perform 1 from public.tenants t where t.room_id=new.room_id and t.organization_id=new.organization_id and t.move_in<=new.ends_on and t.move_in<=timezone('Asia/Ho_Chi_Minh',new.created_at)::date and (t.move_out is null or t.move_out>new.starts_on) order by t.id for share;
  insert into public.contract_tenants(organization_id,contract_id,tenant_id)
   select new.organization_id,new.id,t.id from public.tenants t where t.room_id=new.room_id and t.organization_id=new.organization_id and t.move_in<=new.ends_on and t.move_in<=timezone('Asia/Ho_Chi_Minh',new.created_at)::date and (t.move_out is null or t.move_out>new.starts_on);
 end if;
 return new;
end $$;
revoke all on function public.snapshot_document_tenants() from public;
create trigger snapshot_invoice_tenants after insert on public.invoices for each row execute function public.snapshot_document_tenants();
create trigger snapshot_contract_tenants after insert on public.contracts for each row execute function public.snapshot_document_tenants();
create function public.link_tenant_document(org uuid, document_kind text, target_document uuid, tenant_ids uuid[]) returns void language plpgsql security definer set search_path='' as $$
declare room uuid; begin
 if not public.has_role(org,array['admin','manager']) then raise exception 'Bạn không có quyền gán hồ sơ'; end if;
 if document_kind='invoice' then select room_id into room from public.invoices where id=target_document and organization_id=org for update;
 elsif document_kind='contract' then select room_id into room from public.contracts where id=target_document and organization_id=org for update;
 else raise exception 'Loại tài liệu không hợp lệ'; end if;
 if room is null then raise exception 'Không tìm thấy tài liệu'; end if;
 if tenant_ids is null or cardinality(tenant_ids)=0 or array_position(tenant_ids,null) is not null then raise exception 'Chọn ít nhất một người thuê'; end if;
 perform 1 from public.tenants where id=any(tenant_ids) order by id for share;
 if exists(select 1 from unnest(tenant_ids) t(id) where not exists(select 1 from public.tenants x where x.id=t.id and x.organization_id=org and x.room_id=room)) then raise exception 'Người thuê phải thuộc đúng phòng và không gian'; end if;
 if document_kind='invoice' then insert into public.invoice_tenants(organization_id,invoice_id,tenant_id) select org,target_document,id from (select distinct unnest(tenant_ids) as id) t on conflict(invoice_id,tenant_id) do nothing;
 else insert into public.contract_tenants(organization_id,contract_id,tenant_id) select org,target_document,id from (select distinct unnest(tenant_ids) as id) t on conflict(contract_id,tenant_id) do nothing; end if;
end $$;
revoke all on function public.link_tenant_document(uuid,text,uuid,uuid[]) from public;
grant execute on function public.link_tenant_document(uuid,text,uuid,uuid[]) to authenticated;
-- Stay identity is immutable once financial/legal documents refer to it.
create function public.guard_tenant_stay() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (new.room_id is distinct from old.room_id or new.organization_id is distinct from old.organization_id or new.move_in is distinct from old.move_in)
 and (exists(select 1 from public.invoice_tenants where tenant_id=old.id) or exists(select 1 from public.contract_tenants where tenant_id=old.id)) then raise exception 'Không thể đổi phòng hoặc ngày vào ở của hồ sơ đã có hợp đồng/hóa đơn'; end if;
 if old.move_out is not null and old.move_out<=timezone('Asia/Ho_Chi_Minh',now())::date and new.move_out is distinct from old.move_out then raise exception 'Không thể mở lại đợt ở đã kết thúc'; end if;
 return new;
end $$;
revoke all on function public.guard_tenant_stay() from public;
create trigger guard_tenant_stay before update on public.tenants for each row execute function public.guard_tenant_stay();
notify pgrst, 'reload schema';
commit;
