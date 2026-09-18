-- Read-only roster. Do not widen chat_members RLS (channels depend on it).
create or replace function public.get_chat_member_roster(p_channel_id uuid)
returns table(user_id uuid, display_name text, avatar_url text, role text, joined_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select cm.user_id, coalesce(cp.display_name, 'OGN Member'), cp.avatar_url,
         cm.role::text, cm.joined_at
  from public.chat_members cm
  left join public.chat_profiles cp on cp.id = cm.user_id
  where cm.channel_id = p_channel_id
    and auth.uid() is not null
    and (public.is_chat_moderator() or exists (
      select 1 from public.chat_members own
      where own.channel_id = p_channel_id and own.user_id = auth.uid()
    ))
  order by cm.joined_at, cm.user_id;
$$;
revoke all on function public.get_chat_member_roster(uuid) from public, anon;
grant execute on function public.get_chat_member_roster(uuid) to authenticated;
