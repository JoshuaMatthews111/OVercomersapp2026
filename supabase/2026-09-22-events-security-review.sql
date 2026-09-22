-- 2026-09-22 — Events security review.
--
-- Applied to project ljmzujrzdhwmvvapajlr as migration
-- `events_security_review`. This file is the identical SQL.
--
-- public.events still carried Supabase's default table grants for signed-in
-- people: TRUNCATE, REFERENCES and TRIGGER on top of what the app uses.
-- TRUNCATE is not checked by row-level security, so any path that ever runs
-- SQL as `authenticated` could have emptied every event. event_reports was
-- already trimmed to exactly what the app needs; events now matches it.
-- Row-level security (members read published events, only
-- is_staff_or_above() writes) is unchanged.

revoke all on public.events from anon;
revoke all on public.events from authenticated;
grant select, insert, update, delete on public.events to authenticated;
