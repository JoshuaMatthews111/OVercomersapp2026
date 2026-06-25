-- OGN MVP Row Level Security
alter type app_role add value if not exists 'super_admin';
alter type app_role add value if not exists 'prayer_team';
alter type app_role add value if not exists 'media_admin';
alter type app_role add value if not exists 'moderator';

alter table profiles enable row level security;
alter table user_roles enable row level security;
alter table sermon_series enable row level security;
alter table sermons enable row level security;
alter table chat_channels enable row level security;
alter table chat_members enable row level security;
alter table chat_messages enable row level security;
alter table prayer_requests enable row level security;
alter table territories enable row level security;
alter table outreach_contacts enable row level security;
alter table follow_up_tasks enable row level security;
alter table events enable row level security;
alter table giving_links enable row level security;
alter table push_tokens enable row level security;
alter table audit_logs enable row level security;

create or replace function public.has_role(required_role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from user_roles where user_id = auth.uid() and role = required_role);
$$;

create or replace function public.is_staff_or_above()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from user_roles where user_id = auth.uid() and role::text in ('staff','leader','admin','super_admin'));
$$;

create or replace function public.is_outreach_or_above()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from user_roles where user_id = auth.uid() and role::text in ('outreach','staff','leader','admin','super_admin'));
$$;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from user_roles where user_id = auth.uid() and role::text in ('admin','super_admin'));
$$;

create or replace function public.is_chat_moderator()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.user_roles where user_id = auth.uid() and role::text in ('moderator','staff','leader','admin','super_admin'));
$$;

create or replace function public.is_media_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.user_roles where user_id = auth.uid() and role::text in ('media_admin','staff','admin','super_admin'));
$$;

create or replace function public.is_prayer_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.user_roles where user_id = auth.uid() and role::text in ('prayer_team','staff','leader','admin','super_admin'));
$$;

grant execute on function public.has_role(public.app_role) to authenticated;
grant execute on function public.is_staff_or_above() to authenticated;
grant execute on function public.is_outreach_or_above() to authenticated;
grant execute on function public.is_super_admin() to authenticated;
grant execute on function public.is_chat_moderator() to authenticated;
grant execute on function public.is_media_manager() to authenticated;
grant execute on function public.is_prayer_manager() to authenticated;

-- Public read content
create policy "public can read published series" on sermon_series for select using (status = 'published');
create policy "public can read published sermons" on sermons for select using (status = 'published');
create policy "public can read events" on events for select using (true);
create policy "public can read active giving links" on giving_links for select using (is_active = true);

-- Role visibility
create policy "users read own roles" on user_roles for select using (user_id = auth.uid() or is_staff_or_above());
create policy "super admins manage roles" on user_roles for all using (is_super_admin()) with check (is_super_admin());

-- Admin content writes
create policy "admins manage series" on sermon_series for all using (is_super_admin()) with check (is_super_admin());
create policy "admins manage sermons" on sermons for all using (is_super_admin()) with check (is_super_admin());
create policy "staff manage events" on events for all using (is_staff_or_above()) with check (is_staff_or_above());
create policy "admins manage giving" on giving_links for all using (is_super_admin()) with check (is_super_admin());

-- Profiles
create policy "users read own profile" on profiles for select using (id = auth.uid() or is_staff_or_above());
create policy "users update own profile" on profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy "users insert own profile" on profiles for insert with check (id = auth.uid());

-- Chat
create policy "auth read public channels" on chat_channels for select using (auth.role() = 'authenticated' and is_public = true);
create policy "staff manage channels" on chat_channels for all using (is_staff_or_above()) with check (is_staff_or_above());
create policy "members see their memberships" on chat_members for select using (user_id = auth.uid() or is_staff_or_above());
create policy "authenticated join public chat" on chat_members for insert with check (
  user_id = auth.uid()
  and role = 'member'
  and exists(select 1 from chat_channels cc where cc.id = chat_members.channel_id and cc.is_public = true)
);
create policy "leaders add chat members" on chat_members for insert with check (is_staff_or_above());
create policy "leaders remove chat members" on chat_members for delete using (is_staff_or_above());
create policy "members read messages" on chat_messages for select using (
  is_chat_moderator()
  or (
    deleted_at is null
    and exists(select 1 from chat_members cm where cm.channel_id = chat_messages.channel_id and cm.user_id = auth.uid())
  )
);
create policy "members write messages" on chat_messages for insert with check (
  user_id = auth.uid()
  and (
    is_chat_moderator()
    or exists(select 1 from chat_members cm where cm.channel_id = chat_messages.channel_id and cm.user_id = auth.uid())
  )
);
create policy "staff moderate messages" on chat_messages for update using (is_staff_or_above()) with check (is_staff_or_above());

-- Prayer
create policy "anyone can submit prayer with consent" on prayer_requests for insert with check (consent_received = true);
create policy "creator or staff can read prayer" on prayer_requests for select using (created_by = auth.uid() or is_staff_or_above() or is_private = false);
create policy "staff can manage prayer" on prayer_requests for update using (is_staff_or_above()) with check (is_staff_or_above());

-- Evangelism maps / outreach
create policy "outreach team reads territories" on territories for select using (is_outreach_or_above());
create policy "leaders manage territories" on territories for all using (is_staff_or_above()) with check (is_staff_or_above());
create policy "outreach team reads contacts" on outreach_contacts for select using (is_outreach_or_above());
create policy "outreach team creates contacts" on outreach_contacts for insert with check (is_outreach_or_above() and created_by = auth.uid());
create policy "assigned or leaders update contacts" on outreach_contacts for update using (assigned_to = auth.uid() or created_by = auth.uid() or is_staff_or_above()) with check (is_outreach_or_above());
create policy "outreach team reads followups" on follow_up_tasks for select using (assigned_to = auth.uid() or is_staff_or_above());
create policy "outreach team creates followups" on follow_up_tasks for insert with check (is_outreach_or_above());
create policy "assigned can complete followups" on follow_up_tasks for update using (assigned_to = auth.uid() or is_staff_or_above()) with check (assigned_to = auth.uid() or is_staff_or_above());

-- Push tokens
create policy "users manage own push token" on push_tokens for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Audit logs admin only
create policy "admins read audit logs" on audit_logs for select using (is_super_admin());

revoke execute on function public.has_role(public.app_role) from anon, public;
revoke execute on function public.is_staff_or_above() from anon, public;
revoke execute on function public.is_outreach_or_above() from anon, public;
revoke execute on function public.is_super_admin() from anon, public;
