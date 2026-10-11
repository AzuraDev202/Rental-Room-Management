-- Apply after 014. Every member has full management access within their own workspace.
begin;
update public.memberships set role='admin' where role<>'admin';
alter table public.invitations drop constraint invitations_role_check;
update public.invitations set role='admin';
alter table public.invitations add constraint invitations_role_check check(role='admin');
alter table public.invitations alter column role set default 'admin';
create function public.force_manager_access() returns trigger language plpgsql set search_path='' as $$
begin new.role:='admin';return new;end $$;
revoke all on function public.force_manager_access() from public;
create trigger force_manager_access before insert or update on public.memberships for each row execute function public.force_manager_access();
create trigger force_manager_access before insert or update on public.invitations for each row execute function public.force_manager_access();
revoke execute on function public.set_member_role(uuid,uuid,text) from authenticated;
notify pgrst,'reload schema';
commit;
