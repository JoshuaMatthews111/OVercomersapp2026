-- 2026-09-22 — follow-up to 2026-09-22-chat-receipts-replies-voice.sql.
--
-- That file created chat_messages_parent_message_idx for reply lookups, but
-- the live project already had chat_messages_parent_message_id_idx on the same
-- column (the performance advisor showed both). One is enough: the older,
-- full index stays and the new partial one goes. Nothing reads it by name.
drop index if exists public.chat_messages_parent_message_idx;
