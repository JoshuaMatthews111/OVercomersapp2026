-- OGN MVP Row Level Security

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
  select exists(select 1 from user_roles where user_id = auth.uid() and role in ('staff','leader','admin'));
$$;

create or replace function public.is_outreach_or_above()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from user_roles where user_id = auth.uid() and role in ('outreach','staff','leader','admin'));
$$;

-- Public read content
create policy "public can read published series" on sermon_series for select using (status = 'published');
create policy "public can read published sermons" on sermons for select using (status = 'published');
create policy "public can read events" on events for select using (true);
create policy "public can read active giving links" on giving_links for select using (is_active = true);

-- Admin content writes
create policy "admins manage series" on sermon_series for all using (has_role('admin')) with check (has_role('admin'));
create policy "admins manage sermons" on sermons for all using (has_role('admin')) with check (has_role('admin'));
create policy "staff manage events" on events for all using (is_staff_or_above()) with check (is_staff_or_above());
create policy "admins manage giving" on giving_links for all using (has_role('admin')) with check (has_role('admin'));

-- Profiles
create policy "users read own profile" on profiles for select using (id = auth.uid() or is_staff_or_above());
create policy "users update own profile" on profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy "users insert own profile" on profiles for insert with check (id = auth.uid());

-- Chat
create policy "auth read public channels" on chat_channels for select using (auth.role() = 'authenticated' and is_public = true);
create policy "staff manage channels" on chat_channels for all using (is_staff_or_above()) with check (is_staff_or_above());
create policy "members see their memberships" on chat_members for select using (user_id = auth.uid() or is_staff_or_above());
create policy "authenticated join public chat" on chat_members for insert with check (user_id = auth.uid());
create policy "members read messages" on chat_messages for select using (
  deleted_at is null and exists(select 1 from chat_members cm where cm.channel_id = chat_messages.channel_id and cm.user_id = auth.uid())
);
create policy "members write messages" on chat_messages for insert with check (
  user_id = auth.uid() and exists(select 1 from chat_members cm where cm.channel_id = chat_messages.channel_id and cm.user_id = auth.uid())
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
create policy "admins read audit logs" on audit_logs for select using (has_role('admin'));
