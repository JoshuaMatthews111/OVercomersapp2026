-- Chat tables: take away the privileges that skip row security.
--
-- Found on 2026-09-23 while adding the group post limits. `anon` and
-- `authenticated` held TRUNCATE, TRIGGER, REFERENCES and MAINTAIN on
-- chat_channels, chat_members and chat_messages — left over from an early
-- `grant all`. TRUNCATE is the dangerous one: it does not consult row-level
-- security at all, so any signed-in phone could have emptied every chat in the
-- ministry with one statement, and a signed-out one could too.
--
-- This is the same tightening the events and outreach lanes already did
-- (DO-NOT-BREAK, "Security review, same day": signed-in people hold exactly
-- SELECT/INSERT/UPDATE/DELETE, and anon holds nothing it does not need).
-- Nothing the app does uses any of these four: reading, sending, editing and
-- deleting messages are SELECT/INSERT/UPDATE/DELETE and are untouched.

begin;

revoke truncate, trigger, references, maintain
  on public.chat_channels, public.chat_members, public.chat_messages
  from anon, authenticated;

commit;

-- Check afterwards — this should return no rows:
--
--   select c.relname, r.rolname, a.privilege_type
--     from pg_class c
--     cross join lateral aclexplode(c.relacl) a
--     join pg_roles r on r.oid = a.grantee
--    where c.relname in ('chat_channels','chat_members','chat_messages')
--      and r.rolname in ('anon','authenticated')
--      and a.privilege_type in ('TRUNCATE','TRIGGER','REFERENCES','MAINTAIN');
