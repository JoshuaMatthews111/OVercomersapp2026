-- OGN release hardening: notifications, UGC safety, and upload support.
-- Apply in Supabase SQL Editor before using production push/moderation features.

alter table public.push_tokens
  add column if not exists updated_at timestamptz default now();

create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  announcements boolean not null default true,
  sermons boolean not null default true,
  articles boolean not null default true,
  chat boolean not null default true,
  prayer boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.content_reports (
  id uuid primary key default uuid_generate_v4(),
  reporter_id uuid references auth.users(id) on delete set null,
  target_type text not null,
  target_id uuid not null,
  reason text,
  status text not null default 'new',
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists content_reports_status_idx on public.content_reports(status, created_at desc);

create table if not exists public.user_blocks (
  blocker_id uuid references auth.users(id) on delete cascade,
  blocked_user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (blocker_id, blocked_user_id),
  check (blocker_id <> blocked_user_id)
);

alter table public.notification_preferences enable row level security;
alter table public.content_reports enable row level security;
alter table public.user_blocks enable row level security;

drop policy if exists "users manage own notification preferences" on public.notification_preferences;
create policy "users manage own notification preferences" on public.notification_preferences
for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "users create content reports" on public.content_reports;
create policy "users create content reports" on public.content_reports
for insert with check (reporter_id = auth.uid());

drop policy if exists "staff read and manage content reports" on public.content_reports;
create policy "staff read and manage content reports" on public.content_reports
for all using (public.is_staff_or_above()) with check (public.is_staff_or_above());

drop policy if exists "users manage own blocks" on public.user_blocks;
create policy "users manage own blocks" on public.user_blocks
for all using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());

update storage.buckets
set
  file_size_limit = 104857600,
  allowed_mime_types = array[
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'application/pdf',
    'audio/mpeg',
    'audio/mp4',
    'audio/aac',
    'video/mp4',
    'video/quicktime'
  ]::text[]
where id = 'app-assets';

drop policy if exists "media managers upload app assets" on storage.objects;
create policy "media managers upload app assets" on storage.objects
for insert with check (bucket_id = 'app-assets' and public.is_media_manager());

drop policy if exists "media managers update app assets" on storage.objects;
create policy "media managers update app assets" on storage.objects
for update using (bucket_id = 'app-assets' and public.is_media_manager())
with check (bucket_id = 'app-assets' and public.is_media_manager());
