-- Storage, auth bootstrap, and realtime setup for the OGN MVP.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('ogn-public', 'ogn-public', true, 10485760, array['image/png','image/jpeg','image/webp','image/gif','video/mp4']::text[]),
  ('sermon-media', 'sermon-media', true, 524288000, array['audio/mpeg','audio/mp4','video/mp4','application/pdf','image/png','image/jpeg','image/webp']::text[]),
  ('profile-avatars', 'profile-avatars', true, 5242880, array['image/png','image/jpeg','image/webp']::text[]),
  ('outreach-private', 'outreach-private', false, 20971520, array['image/png','image/jpeg','image/webp','application/pdf']::text[])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "public reads public ogn assets" on storage.objects
for select using (bucket_id in ('ogn-public', 'sermon-media', 'profile-avatars'));

create policy "staff uploads public ogn assets" on storage.objects
for insert with check (bucket_id in ('ogn-public', 'sermon-media') and public.is_staff_or_above());

create policy "users upload own avatar" on storage.objects
for insert with check (bucket_id = 'profile-avatars' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "users update own avatar" on storage.objects
for update using (bucket_id = 'profile-avatars' and auth.uid()::text = (storage.foldername(name))[1])
with check (bucket_id = 'profile-avatars' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "outreach team reads private outreach files" on storage.objects
for select using (bucket_id = 'outreach-private' and public.is_outreach_or_above());

create policy "outreach team uploads private outreach files" on storage.objects
for insert with check (bucket_id = 'outreach-private' and public.is_outreach_or_above());

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, phone, avatar_url, country, region)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', new.email),
    new.raw_user_meta_data->>'phone',
    new.raw_user_meta_data->>'avatar_url',
    new.raw_user_meta_data->>'country',
    new.raw_user_meta_data->>'region'
  )
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'member')
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

do $$
begin
  alter publication supabase_realtime add table public.chat_messages;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.chat_channels;
exception when duplicate_object then null;
end $$;
