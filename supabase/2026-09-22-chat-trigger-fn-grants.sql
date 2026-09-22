-- 2026-09-22 — Chat security review, part 2.
-- The security advisor flags two chat TRIGGER functions as callable over
-- /rest/v1/rpc by anon and signed-in users. Postgres refuses to run a trigger
-- function outside a trigger, so nothing was exploitable, but nobody needs to
-- call them. Trigger functions are not privilege-checked when they fire, so the
-- triggers keep working (same as tg_chat_reply_same_room, revoked the same way
-- in 2026-09-22-chat-receipts-replies-voice.sql and proven by the self-test).
revoke all on function public.chat_message_auto_review() from public, anon, authenticated;
revoke all on function public.tg_chat_message_review_on_update() from public, anon, authenticated;
