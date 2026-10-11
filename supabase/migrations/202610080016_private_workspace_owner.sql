-- Apply after 015. One private owner per workspace; no invitations or sharing.
begin;
-- Do not arbitrarily choose an owner or take existing users' access away.
do $$
declare conflicts text;
begin
 select string_agg(o.name||' ['||o.id::text||']: '||m.emails,E'\n') into conflicts
 from public.organizations o join (select organization_id,string_agg(email,', ' order by email) as emails from public.memberships group by organization_id having count(*)>1) m on m.organization_id=o.id;
 if conflicts is not null then raise exception 'Không gian đang có nhiều người quản lý. Hãy chọn tài khoản chủ sở hữu và gỡ các thành viên khác trước khi chạy migration 016:%',E'\n'||conflicts; end if;
end $$;
alter table public.memberships add constraint one_owner_per_workspace unique(organization_id);
-- Pending invitations cannot grant access to a private owner's workspace.
delete from public.invitations;
revoke all on public.invitations from authenticated,anon;
revoke execute on function public.accept_invitations(text),public.remove_workspace_member(uuid,uuid,text),public.set_member_role(uuid,uuid,text) from authenticated;
notify pgrst,'reload schema';
commit;
