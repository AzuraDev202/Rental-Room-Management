-- Remove workspace access, preserving the login account and all business records.
begin;
create function public.remove_workspace_member(org uuid,target_user uuid,confirmation_email text) returns void
language plpgsql security definer set search_path='' as $$
declare member public.memberships%rowtype;
begin
 -- Use the same lock as role changes, so concurrent removals cannot lose all admins.
 perform 1 from public.organizations where id=org for update;
 if not public.has_role(org,array['admin']) then raise exception 'Bạn không có quyền quản trị'; end if;
 select * into member from public.memberships where organization_id=org and user_id=target_user for update;
 if not found then raise exception 'Không tìm thấy thành viên'; end if;
 if lower(trim(confirmation_email)) is distinct from lower(member.email) then raise exception 'Email xác nhận không khớp'; end if;
 if member.role='admin' and (select count(*) from public.memberships where organization_id=org and role='admin')<=1 then raise exception 'Cần giữ ít nhất một quản trị viên'; end if;
 if target_user=auth.uid() then raise exception 'Không thể tự xóa quyền của mình; hãy nhờ quản trị viên khác'; end if;
 -- Clear pending invitations too, preventing immediate re-entry through an old invite.
 delete from public.invitations where organization_id=org and lower(email)=lower(member.email);
 delete from public.memberships where organization_id=org and user_id=target_user;
end $$;
revoke all on function public.remove_workspace_member(uuid,uuid,text) from public;
grant execute on function public.remove_workspace_member(uuid,uuid,text) to authenticated;
notify pgrst, 'reload schema';
commit;
