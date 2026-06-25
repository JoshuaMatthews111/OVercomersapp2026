-- OGN app feature expansion: media, stories, uploads, favorites, downloads, giving records,
-- and private chat/prayer attachment support.

do $$
begin
  create type public.media_kind as enum ('sermon','article','video','music','live','devotional');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.upload_purpose as enum ('profile_avatar','story','media_thumbnail','media_file','chat_attachment','prayer_attachment','app_asset','outreach_file');
exception when duplicate_object then null;
end $$;

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  public_read boolean not null default false,
  updated_by uuid references auth.users(id),
  updated_at timestamptz default now()
);

create table if not exists public.media_items (
  id uuid primary key default uuid_generate_v4(),
  media_type public.media_kind not null,
  title text not null,
  slug text unique,
  description text,
  speaker text,
  scripture_reference text,
  thumbnail_url text,
  file_url text,
  external_url text,
  duration_seconds int,
  is_downloadable boolean default false,
  is_featured boolean default false,
  visibility_role public.app_role default 'member',
  status public.message_status default 'published',
  metadata jsonb default '{}'::jsonb,
  created_by uuid references auth.users(id),
  published_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists media_items_type_status_idx on public.media_items(media_type, status);
create index if not exists media_items_featured_idx on public.media_items(is_featured) where is_featured = true;

create table if not exists public.app_stories (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  category text,
  body text,
  region text,
  image_url text,
  action_url text,
  visibility_role public.app_role default 'member',
  status public.message_status default 'published',
  sort_order int default 0,
  created_by uuid references auth.users(id),
  published_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists app_stories_status_sort_idx on public.app_stories(status, sort_order, published_at desc);

create table if not exists public.uploaded_files (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid references auth.users(id) on delete set null,
  bucket_id text not null,
  object_path text not null,
  file_name text,
  mime_type text,
  size_bytes bigint,
  purpose public.upload_purpose not null,
  related_table text,
  related_id uuid,
  analysis jsonb default '{}'::jsonb,
  status text default 'ready',
  created_at timestamptz default now(),
  unique(bucket_id, object_path)
);
create index if not exists uploaded_files_owner_idx on public.uploaded_files(owner_id);
create index if not exists uploaded_files_related_idx on public.uploaded_files(related_table, related_id);

create table if not exists public.user_favorites (
  user_id uuid references auth.users(id) on delete cascade,
  target_type text not null,
  target_id uuid not null,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  primary key(user_id, target_type, target_id)
);

create table if not exists public.user_downloads (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade,
  media_item_id uuid references public.media_items(id) on delete cascade,
  file_url text,
  status text default 'queued',
  downloaded_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists user_downloads_user_idx on public.user_downloads(user_id);

create table if not exists public.chat_attachments (
  id uuid primary key default uuid_generate_v4(),
  message_id uuid references public.chat_messages(id) on delete cascade,
  channel_id uuid references public.chat_channels(id) on delete cascade,
  uploaded_by uuid references auth.users(id) on delete set null,
  bucket_id text not null,
  object_path text not null,
  file_name text,
  mime_type text,
  size_bytes bigint,
  analysis jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
create index if not exists chat_attachments_message_idx on public.chat_attachments(message_id);
create index if not exists chat_attachments_channel_idx on public.chat_attachments(channel_id);

create table if not exists public.prayer_request_attachments (
  id uuid primary key default uuid_generate_v4(),
  prayer_request_id uuid references public.prayer_requests(id) on delete cascade,
  uploaded_by uuid references auth.users(id) on delete set null,
  bucket_id text not null,
  object_path text not null,
  file_name text,
  mime_type text,
  size_bytes bigint,
  analysis jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
create index if not exists prayer_attachments_request_idx on public.prayer_request_attachments(prayer_request_id);

create table if not exists public.giving_selections (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete set null,
  amount_cents int,
  currency text default 'usd',
  stripe_checkout_url text,
  status text default 'started',
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
create index if not exists giving_selections_user_idx on public.giving_selections(user_id);

alter table public.app_settings enable row level security;
alter table public.media_items enable row level security;
alter table public.app_stories enable row level security;
alter table public.uploaded_files enable row level security;
alter table public.user_favorites enable row level security;
alter table public.user_downloads enable row level security;
alter table public.chat_attachments enable row level security;
alter table public.prayer_request_attachments enable row level security;
alter table public.giving_selections enable row level security;

drop policy if exists "public reads public app settings" on public.app_settings;
create policy "public reads public app settings" on public.app_settings
for select using (public_read = true);

drop policy if exists "admins manage app settings" on public.app_settings;
create policy "admins manage app settings" on public.app_settings
for all using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists "public reads published media by role" on public.media_items;
create policy "public reads published media by role" on public.media_items
for select using (
  status = 'published'
  and (
    visibility_role::text in ('visitor','member')
    or (visibility_role::text in ('outreach','staff','leader') and public.is_outreach_or_above())
    or (visibility_role::text in ('admin','super_admin') and public.is_super_admin())
  )
);

drop policy if exists "admins manage media items" on public.media_items;
create policy "admins manage media items" on public.media_items
for all using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists "public reads published stories by role" on public.app_stories;
create policy "public reads published stories by role" on public.app_stories
for select using (
  status = 'published'
  and (
    visibility_role::text in ('visitor','member')
    or (visibility_role::text in ('outreach','staff','leader') and public.is_outreach_or_above())
    or (visibility_role::text in ('admin','super_admin') and public.is_super_admin())
  )
);

drop policy if exists "leaders manage stories" on public.app_stories;
create policy "leaders manage stories" on public.app_stories
for all using (public.is_staff_or_above()) with check (public.is_staff_or_above());

drop policy if exists "users manage own favorites" on public.user_favorites;
create policy "users manage own favorites" on public.user_favorites
for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "users manage own downloads" on public.user_downloads;
create policy "users manage own downloads" on public.user_downloads
for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "owners and staff read uploaded files" on public.uploaded_files;
create policy "owners and staff read uploaded files" on public.uploaded_files
for select using (owner_id = auth.uid() or public.is_staff_or_above());

drop policy if exists "owners insert uploaded files" on public.uploaded_files;
create policy "owners insert uploaded files" on public.uploaded_files
for insert with check (owner_id = auth.uid() or public.is_staff_or_above());

drop policy if exists "owners update uploaded files" on public.uploaded_files;
create policy "owners update uploaded files" on public.uploaded_files
for update using (owner_id = auth.uid() or public.is_staff_or_above())
with check (owner_id = auth.uid() or public.is_staff_or_above());

drop policy if exists "members read chat attachments" on public.chat_attachments;
create policy "members read chat attachments" on public.chat_attachments
for select using (
  public.is_staff_or_above()
  or exists (
    select 1 from public.chat_members cm
    where cm.channel_id = chat_attachments.channel_id
      and cm.user_id = auth.uid()
  )
);

drop policy if exists "members create chat attachments" on public.chat_attachments;
create policy "members create chat attachments" on public.chat_attachments
for insert with check (
  uploaded_by = auth.uid()
  and exists (
    select 1 from public.chat_members cm
    where cm.channel_id = chat_attachments.channel_id
      and cm.user_id = auth.uid()
  )
);

drop policy if exists "creator or staff read prayer attachments" on public.prayer_request_attachments;
create policy "creator or staff read prayer attachments" on public.prayer_request_attachments
for select using (
  public.is_staff_or_above()
  or uploaded_by = auth.uid()
  or exists (
    select 1 from public.prayer_requests pr
    where pr.id = prayer_request_attachments.prayer_request_id
      and pr.created_by = auth.uid()
  )
);

drop policy if exists "creator uploads prayer attachments" on public.prayer_request_attachments;
create policy "creator uploads prayer attachments" on public.prayer_request_attachments
for insert with check (
  uploaded_by = auth.uid()
  and exists (
    select 1 from public.prayer_requests pr
    where pr.id = prayer_request_attachments.prayer_request_id
      and pr.created_by = auth.uid()
  )
);

drop policy if exists "users create giving selections" on public.giving_selections;
create policy "users create giving selections" on public.giving_selections
for insert with check (user_id = auth.uid() or user_id is null);

drop policy if exists "users read own giving selections" on public.giving_selections;
create policy "users read own giving selections" on public.giving_selections
for select using (user_id = auth.uid() or public.is_staff_or_above());

drop policy if exists "members read joined private channels" on public.chat_channels;
create policy "members read joined private channels" on public.chat_channels
for select using (
  auth.role() = 'authenticated'
  and exists (
    select 1 from public.chat_members cm
    where cm.channel_id = chat_channels.id
      and cm.user_id = auth.uid()
  )
);

drop policy if exists "authenticated create private chat channels" on public.chat_channels;
create policy "authenticated create private chat channels" on public.chat_channels
for insert with check (
  auth.role() = 'authenticated'
  and created_by = auth.uid()
  and channel_type in ('direct','group')
  and is_mandatory = false
);

drop policy if exists "channel creators add chat members" on public.chat_members;
create policy "channel creators add chat members" on public.chat_members
for insert with check (
  exists (
    select 1 from public.chat_channels cc
    where cc.id = chat_members.channel_id
      and cc.created_by = auth.uid()
  )
);

drop policy if exists "channel creators remove chat members" on public.chat_members;
create policy "channel creators remove chat members" on public.chat_members
for delete using (
  exists (
    select 1 from public.chat_channels cc
    where cc.id = chat_members.channel_id
      and cc.created_by = auth.uid()
  )
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('app-assets', 'app-assets', true, 10485760, array['image/png','image/jpeg','image/webp','image/gif']::text[]),
  ('story-media', 'story-media', true, 52428800, array['image/png','image/jpeg','image/webp','video/mp4']::text[]),
  ('chat-attachments', 'chat-attachments', false, 52428800, array['image/png','image/jpeg','image/webp','application/pdf','audio/mpeg','audio/mp4','video/mp4']::text[]),
  ('prayer-attachments', 'prayer-attachments', false, 20971520, array['image/png','image/jpeg','image/webp','application/pdf']::text[])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public reads app and story assets" on storage.objects;
create policy "public reads app and story assets" on storage.objects
for select using (bucket_id in ('app-assets','story-media'));

drop policy if exists "staff uploads app and story assets" on storage.objects;
create policy "staff uploads app and story assets" on storage.objects
for insert with check (bucket_id in ('app-assets','story-media') and public.is_staff_or_above());

drop policy if exists "chat members read attachment files" on storage.objects;
create policy "chat members read attachment files" on storage.objects
for select using (
  bucket_id = 'chat-attachments'
  and (
    public.is_staff_or_above()
    or exists (
      select 1 from public.chat_members cm
      where cm.channel_id::text = (storage.foldername(name))[1]
        and cm.user_id = auth.uid()
    )
  )
);

drop policy if exists "chat members upload attachment files" on storage.objects;
create policy "chat members upload attachment files" on storage.objects
for insert with check (
  bucket_id = 'chat-attachments'
  and exists (
    select 1 from public.chat_members cm
    where cm.channel_id::text = (storage.foldername(name))[1]
      and cm.user_id = auth.uid()
  )
);

drop policy if exists "users read own prayer attachment files" on storage.objects;
create policy "users read own prayer attachment files" on storage.objects
for select using (
  bucket_id = 'prayer-attachments'
  and (auth.uid()::text = (storage.foldername(name))[1] or public.is_staff_or_above())
);

drop policy if exists "users upload own prayer attachment files" on storage.objects;
create policy "users upload own prayer attachment files" on storage.objects
for insert with check (
  bucket_id = 'prayer-attachments'
  and auth.uid()::text = (storage.foldername(name))[1]
);

do $$
begin
  alter publication supabase_realtime add table public.app_stories;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.media_items;
exception when duplicate_object then null;
end $$;
