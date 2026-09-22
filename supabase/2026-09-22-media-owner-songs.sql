-- 2026-09-22 — The owner's two missing songs, in the Music tab.
--
-- The owner: "YHWH power chant by joshua matthews, and resilience by Jc Jacobs
-- missing them". Both files and their covers were put in the PUBLIC
-- sermon-media bucket under music/ on 2026-09-22 (one-off importer, since
-- retired to 410 Gone). This adds the two published media_items rows that
-- point at them.
--
-- Conventions followed (checked against the live table first):
--   media_type 'music' (enum media_kind), status 'published' (message_status),
--   visibility_role left at its default 'member' so every signed-in person
--   can read them, is_downloadable true because they are uploaded files
--   (app/admin.tsx sets isDownloadable = Boolean(fileUrl)), is_featured false
--   so neither song takes over the Media hero or Home's "Latest message".
--   speaker = the artist. created_by is left empty (posted by migration).
--
-- Safe to run twice: keyed on slug (media_items_slug_key is UNIQUE).
--
-- NOTE: "Resilience" is 2:19 (139 s). The only copy found on the owner's Macs
-- was "Resilience by Overcomers Global Network.mp3" in iCloud Drive. If a
-- longer master exists, upload it over music/resilience-jc-jacobs.mp3 (or post
-- a new one from Admin > Library) and update duration_seconds.

insert into public.media_items
  (media_type, title, slug, description, speaker, thumbnail_url, file_url,
   duration_seconds, is_downloadable, is_featured, status, published_at, metadata)
values
  ('music',
   'The YHWH Power Chant',
   'the-yhwh-power-chant',
   'A worship chant on the power of the Name, by Prophet Joshua Matthews.',
   'Prophet Joshua Matthews',
   'https://ljmzujrzdhwmvvapajlr.supabase.co/storage/v1/object/public/sermon-media/music/the-yhwh-power-chant-cover.jpg',
   'https://ljmzujrzdhwmvvapajlr.supabase.co/storage/v1/object/public/sermon-media/music/the-yhwh-power-chant.m4a',
   270, true, false, 'published', now(),
   jsonb_build_object('source', 'owner-import-2026-09-22', 'format', 'AAC 128 kbps stereo, from the full-song lyric video')),
  ('music',
   'Resilience',
   'resilience-jc-jacobs',
   'A worship song by JC Jacobs, from Overcomers Global Network.',
   'JC Jacobs',
   'https://ljmzujrzdhwmvvapajlr.supabase.co/storage/v1/object/public/sermon-media/music/resilience-jc-jacobs-cover.jpg',
   'https://ljmzujrzdhwmvvapajlr.supabase.co/storage/v1/object/public/sermon-media/music/resilience-jc-jacobs.mp3',
   139, true, false, 'published', now(),
   jsonb_build_object('source', 'owner-import-2026-09-22', 'format', 'MP3 192 kbps, the original file unchanged'))
on conflict (slug) do update set
  media_type = excluded.media_type,
  title = excluded.title,
  description = excluded.description,
  speaker = excluded.speaker,
  thumbnail_url = excluded.thumbnail_url,
  file_url = excluded.file_url,
  duration_seconds = excluded.duration_seconds,
  is_downloadable = excluded.is_downloadable,
  status = excluded.status,
  metadata = excluded.metadata,
  updated_at = now();
