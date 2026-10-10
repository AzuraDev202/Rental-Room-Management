-- Laundry is priced per resident/month for new invoices. Old totals are unchanged.
begin;
alter table public.invoices add column laundry_rate bigint,add column laundry_count integer;
alter table public.invoices add constraint invoice_laundry_snapshot check (
 (laundry_rate is null and laundry_count is null) or
 (laundry_rate is not null and laundry_count is not null and laundry_rate>=0 and laundry_count>=0 and laundry_fee=laundry_rate*laundry_count)
);
create function public.snapshot_laundry_people() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.rooms where id=new.room_id and organization_id=new.organization_id for update;
 perform 1 from public.tenants t where t.room_id=new.room_id and t.organization_id=new.organization_id and t.billing_cycle_id is not distinct from new.billing_cycle_id and t.move_in<(new.period+interval '1 month')::date and t.move_in<=timezone('Asia/Ho_Chi_Minh',new.created_at)::date and (t.move_out is null or (t.move_out>new.period and t.move_out>t.move_in)) order by t.id for share;
 select count(*)::integer into new.laundry_count from public.tenants t where t.room_id=new.room_id and t.organization_id=new.organization_id and t.billing_cycle_id is not distinct from new.billing_cycle_id and t.move_in<(new.period+interval '1 month')::date and t.move_in<=timezone('Asia/Ho_Chi_Minh',new.created_at)::date and (t.move_out is null or (t.move_out>new.period and t.move_out>t.move_in));
 new.laundry_rate:=new.laundry_fee;
 new.laundry_fee:=new.laundry_rate*new.laundry_count;
 return new;
end $$;
revoke all on function public.snapshot_laundry_people() from public;
create trigger snapshot_laundry_people before insert on public.invoices for each row execute function public.snapshot_laundry_people();
notify pgrst,'reload schema';
commit;
