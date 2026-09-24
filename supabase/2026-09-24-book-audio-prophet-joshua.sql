insert into public.book_audio (book_slug, chapter_id, voice_id, url, duration_seconds)
values
  ('gospel-of-salvation', 'chapter-1', 'prophet-joshua', 'https://ljmzujrzdhwmvvapajlr.supabase.co/storage/v1/object/public/sermon-media/book/gospel-of-salvation/prophet-joshua__chapter-1.m4a', 242),
  ('gospel-of-salvation', 'chapter-10', 'prophet-joshua', 'https://ljmzujrzdhwmvvapajlr.supabase.co/storage/v1/object/public/sermon-media/book/gospel-of-salvation/prophet-joshua__chapter-10.m4a', 182),
  ('gospel-of-salvation', 'chapter-11', 'prophet-joshua', 'https://ljmzujrzdhwmvvapajlr.supabase.co/storage/v1/object/public/sermon-media/book/gospel-of-salvation/prophet-joshua__chapter-11.m4a', 202),
  ('gospel-of-salvation', 'chapter-12', 'prophet-joshua', 'https://ljmzujrzdhwmvvapajlr.supabase.co/storage/v1/object/public/sermon-media/book/gospel-of-salvation/prophet-joshua__chapter-12.m4a', 557),
  ('gospel-of-salvation', 'chapter-2', 'prophet-joshua', 'https://ljmzujrzdhwmvvapajlr.supabase.co/storage/v1/object/public/sermon-media/book/gospel-of-salvation/prophet-joshua__chapter-2.m4a', 245),
  ('gospel-of-salvation', 'chapter-3', 'prophet-joshua', 'https://ljmzujrzdhwmvvapajlr.supabase.co/storage/v1/object/public/sermon-media/book/gospel-of-salvation/prophet-joshua__chapter-3.m4a', 232),
  ('gospel-of-salvation', 'chapter-4', 'prophet-joshua', 'https://ljmzujrzdhwmvvapajlr.supabase.co/storage/v1/object/public/sermon-media/book/gospel-of-salvation/prophet-joshua__chapter-4.m4a', 234),
  ('gospel-of-salvation', 'chapter-5', 'prophet-joshua', 'https://ljmzujrzdhwmvvapajlr.supabase.co/storage/v1/object/public/sermon-media/book/gospel-of-salvation/prophet-joshua__chapter-5.m4a', 206),
  ('gospel-of-salvation', 'chapter-6', 'prophet-joshua', 'https://ljmzujrzdhwmvvapajlr.supabase.co/storage/v1/object/public/sermon-media/book/gospel-of-salvation/prophet-joshua__chapter-6.m4a', 200),
  ('gospel-of-salvation', 'chapter-7', 'prophet-joshua', 'https://ljmzujrzdhwmvvapajlr.supabase.co/storage/v1/object/public/sermon-media/book/gospel-of-salvation/prophet-joshua__chapter-7.m4a', 226),
  ('gospel-of-salvation', 'chapter-8', 'prophet-joshua', 'https://ljmzujrzdhwmvvapajlr.supabase.co/storage/v1/object/public/sermon-media/book/gospel-of-salvation/prophet-joshua__chapter-8.m4a', 212),
  ('gospel-of-salvation', 'chapter-9', 'prophet-joshua', 'https://ljmzujrzdhwmvvapajlr.supabase.co/storage/v1/object/public/sermon-media/book/gospel-of-salvation/prophet-joshua__chapter-9.m4a', 198),
  ('gospel-of-salvation', 'conclusion', 'prophet-joshua', 'https://ljmzujrzdhwmvvapajlr.supabase.co/storage/v1/object/public/sermon-media/book/gospel-of-salvation/prophet-joshua__conclusion.m4a', 149),
  ('gospel-of-salvation', 'introduction', 'prophet-joshua', 'https://ljmzujrzdhwmvvapajlr.supabase.co/storage/v1/object/public/sermon-media/book/gospel-of-salvation/prophet-joshua__introduction.m4a', 198),
  ('gospel-of-salvation', 'sharing-guide', 'prophet-joshua', 'https://ljmzujrzdhwmvvapajlr.supabase.co/storage/v1/object/public/sermon-media/book/gospel-of-salvation/prophet-joshua__sharing-guide.m4a', 172)
on conflict (book_slug, chapter_id, voice_id) do update set url = excluded.url, duration_seconds = excluded.duration_seconds;