-- Live: can this stream play inside the app at all? (2026-09-23)
-- Migration name: live_status_embeddable_2026_09_23
--
-- The owner, on TestFlight 36: "will the live appear really in the app once
-- streaming?" One way it would NOT is a stream whose channel has embedding
-- turned off: YouTube then refuses to play it in any other app, and the
-- in-app player can only show YouTube's own error screen.
--
-- The live-status edge function already asks YouTube's open oEmbed endpoint
-- about the live video. A 401/403 there means "embedding is off". This column
-- keeps that answer with the rest of the detection, so every phone knows to
-- offer "Watch on YouTube" instead of opening a player that cannot work.
--
--   null  = we did not ask, or could not tell. The app tries its own player,
--           exactly as it did before this column existed.
--   true  = YouTube allowed the embed when we asked.
--   false = YouTube refused it. The app sends the person to YouTube.
--
-- Written ONLY by the live-status function (service role), like the rest of
-- the detection columns. Members keep SELECT on the whole row and UPDATE on
-- manual_override alone, so nothing about the grants changes.

alter table public.live_status
  add column if not exists embeddable boolean;

comment on column public.live_status.embeddable is
  'Did YouTube allow this live stream to be embedded when the live-status function last asked? null = unknown, false = the app must send people to YouTube.';
