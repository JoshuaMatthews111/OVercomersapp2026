-- 2026-09-21: the owner approved switching "Allow embedding" on (and "Not made
-- for kids") for four old streams that 2026-09-21-real-teachings.sql had to
-- leave out. Done in YouTube Studio and verified: oEmbed now answers 200 for
-- all four. Same shape and upsert as the main teachings migration.
insert into public.sermons (series_id, title, slug, speaker, scripture_reference, video_url, thumbnail_url, duration_seconds, status, is_featured, published_at)
select s.id, v.title, v.slug, v.speaker, v.scripture, v.video_url, v.thumbnail_url, v.duration_seconds::int, 'published'::public.message_status, false, v.published_at::timestamptz
from (values
  ('prophetic-prayer', 'Prayer Time with the Holy Spirit', 'yt-prayer-time-with-the-holy-spirit-vwfdpm', 'Overcomers Global Network', null, 'https://www.youtube.com/watch?v=vwfdpm4l5sY', 'https://i.ytimg.com/vi/vwfdpm4l5sY/hqdefault.jpg', 969, '2024-07-19 12:00:00+00'),
  ('sunday-restoration-service', 'Overcomers Online Sunday Service — June 30, 2024', 'yt-overcomers-online-sunday-service-june-30-2024-jp4tb1', 'Overcomers Global Network', null, 'https://www.youtube.com/watch?v=jP4TB1P5uCg', 'https://i.ytimg.com/vi/jP4TB1P5uCg/hqdefault.jpg', 4316, '2024-06-30 12:00:00+00'),
  ('sunday-restoration-service', 'Overcomers Online Sunday Service — June 30, 2024 (Short)', 'yt-overcomers-online-sunday-service-june-30-2024-short-dp6v6o', 'Overcomers Global Network', null, 'https://www.youtube.com/watch?v=DP6v6odSsmI', 'https://i.ytimg.com/vi/DP6v6odSsmI/hqdefault.jpg', 1187, '2024-06-30 11:00:00+00'),
  ('the-kingdom-of-god', 'Overcomers Online Sunday Service: Kingdom of God Series', 'yt-overcomers-online-sunday-service-kingdom-of-god-series-w7ugwo', 'Overcomers Global Network', null, 'https://www.youtube.com/watch?v=w7ugWoomS0c', 'https://i.ytimg.com/vi/w7ugWoomS0c/hqdefault.jpg', 3032, '2024-06-30 10:00:00+00')
) as v(series_slug, title, slug, speaker, scripture, video_url, thumbnail_url, duration_seconds, published_at)
join public.sermon_series s on s.slug = v.series_slug
on conflict (slug) do update set
  series_id = excluded.series_id,
  title = excluded.title,
  speaker = excluded.speaker,
  scripture_reference = excluded.scripture_reference,
  video_url = excluded.video_url,
  thumbnail_url = excluded.thumbnail_url,
  duration_seconds = excluded.duration_seconds,
  status = excluded.status,
  published_at = excluded.published_at,
  updated_at = now();
