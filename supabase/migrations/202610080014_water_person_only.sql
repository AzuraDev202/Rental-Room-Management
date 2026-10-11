-- Apply after 013. Historical invoice snapshots and money are unchanged.
begin;
-- Archive guards are disabled only under the transaction's table lock for this migration.
alter table public.property_service_rates disable trigger guard_archived_property_write;
update public.property_service_rates set water_mode='person' where water_mode<>'person';
alter table public.property_service_rates enable trigger guard_archived_property_write;
alter table public.property_service_rates alter column water_mode set default 'person';
alter table public.property_service_rates add constraint water_person_only check(water_mode='person');
create function public.create_person_water_invoice(org uuid,target_room uuid,target_cycle uuid,invoice_period date,deadline date,e_old integer,e_new integer,w_old integer,w_new integer) returns uuid language sql security invoker set search_path='' as $$
 select public.create_cycle_invoice(org,target_room,target_cycle,invoice_period,deadline,e_old,e_new,w_old,w_new);
$$;
revoke all on function public.create_person_water_invoice(uuid,uuid,uuid,date,date,integer,integer,integer,integer) from public;
grant execute on function public.create_person_water_invoice(uuid,uuid,uuid,date,date,integer,integer,integer,integer) to authenticated;
notify pgrst,'reload schema';
commit;
