-- =====================================================================
-- OGN — the content filter learns how people actually type on a phone
-- 2026-09-21. Applied as migration chat_filter_normaliser_2026_09_21.
--
-- SUPERSEDED IN PART the same day by 2026-09-21-chat-filter-hardening.sql
-- (content_normalize and content_needs_review were replaced there after a
-- review found an apology, a sports score and Rev 2:23 being held, and
-- several threats passing). content_needs_care below is still the live one.
--
-- WHY. On 2026-09-21 at 03:55 UTC the owner typed two threats into chat
-- from his iPhone:
--     "I’m going to kill u"
--     "I’m gin kill your"
-- Both PASSED content_needs_review AND content_needs_care, so nothing was
-- held and he saw no warning. Three causes, all confirmed against the live
-- function before this change:
--   1. iOS "smart punctuation" types U+2019 (’), not ('). The old pattern
--      spelled "i'm" with a plain apostrophe, so "I’m going to" never matched.
--   2. Texting shorthand: "u", "ur", "ya", "yall" were not read as "you".
--   3. Typos and slang for "going to": "gin", "gon", "finna", "bout to".
--
-- WHAT CHANGES.
--   public.content_normalize(text)  NEW. Rewrites text into one plain form
--     before either question is asked: lower-case; curly and modifier
--     apostrophes (U+2019 U+2018 U+02BC ` ´ ′) become ', curly double quotes
--     become "; zero-width characters are removed; digits used as letters
--     inside a word (k1ll, sh1t) become letters; a letter repeated three or
--     more times is cut to two (kiiiill -> kiill, which the verb pattern
--     below still reads as kill); shorthand for "you" / "your" / "you all"
--     and for "going to" / "want to" is spelled out.
--   public.content_needs_review(text) -> HOLD. Same list as 2026-09-19,
--     now asked of the normalised text. The threat clause is rewritten so it
--     needs a first-person speaker, an intent word, a violent verb AND a
--     person as the target. That is what lets these HOLD
--         "I’m going to kill u", "ima kill u", "I'm finna kill yall",
--         "i will k1ll you", "I will kill my wife tonight"
--     while these keep PASSING
--         "I beat my addiction by God's grace"      (no person target)
--         "I will shoot you a text after service"  (a text, not a gun)
--         "We are going to kill it at the concert" (it is not a person)
--         "kill them with kindness"
--   public.content_needs_care(text) -> PUBLISH + tell a leader. Same list,
--     asked of the normalised text, plus "kms" and "unalive myself".
--
-- The two triggers (chat_message_auto_review, app_story_auto_review) and the
-- two BEFORE UPDATE guards are NOT touched: they call these functions by
-- name and pick the new behaviour up automatically. DO-NOT-BREAK #18 holds:
-- the filter stays in the database.
--
-- KNOWN AND ACCEPTED LIMIT (unchanged from 2026-09-19): a first-person
-- threat quoted from scripture - 1 Samuel 17:46, "I will smite thee" style
-- lines that use "kill you" - is held for a human to approve.
--
-- MEASURED AFTER APPLYING: see the matrix at the bottom of this file.
-- =====================================================================

create or replace function public.content_normalize(input text)
returns text
language plpgsql
immutable
parallel safe
set search_path = ''
as $fn$
declare
  s text;
begin
  if input is null then
    return null;
  end if;

  s := lower(input);

  -- iPhone smart punctuation and its cousins -> plain ' and "
  s := translate(s, E'\u2019\u2018\u02BC`\u00B4\u2032', '''''''''''''');
  s := translate(s, E'\u201C\u201D\u201E\u2033', '""""');

  -- invisible characters that split a word without showing
  s := regexp_replace(s, E'[\u200B\u200C\u200D\u2060\uFEFF\u00AD]', '', 'g');

  -- digits standing in for letters, only INSIDE a word (k1ll, sh1t, h0e).
  -- "Mark 9:31", "100 fold" and "5th" are left alone.
  s := regexp_replace(s, '([a-z])1(?=[a-z])', '\1i', 'g');
  s := regexp_replace(s, '([a-z])3(?=[a-z])', '\1e', 'g');
  s := regexp_replace(s, '([a-z])0(?=[a-z])', '\1o', 'g');
  s := regexp_replace(s, '([a-z])4(?=[a-z])', '\1a', 'g');

  -- a letter held down: kiiiiill -> kiill, yooouuu -> yoouu
  s := regexp_replace(s, '([a-z])\1{2,}', '\1\1', 'g');

  s := regexp_replace(s, '\s+', ' ', 'g');

  -- "you all" first, so "ya'll" is not read as "ya" + "'ll"
  s := regexp_replace(s, '\m(y''all|ya''ll|yall|yal|y''al|yawl)\M', 'you all', 'g');

  -- "imma" / "ima" / "i'ma" = "i'm going to"
  s := regexp_replace(s, '\m(i''mma|i''ma|imma|ima|ahma|ima)\M', 'i''m going to', 'g');
  -- "im" = "i'm"
  s := regexp_replace(s, '\mim\M', 'i''m', 'g');
  -- "ill kill" = "i'll kill" (only in front of a violent verb, so "ill" the
  -- adjective is left alone)
  s := regexp_replace(s, '\mill (?=(k+i+l|sh+o+|st+a+b|murder|strangle|choke|beat|hurt|punch|smack|slap|stomp|rape|bomb|burn|end\M))', 'i will ', 'g');
  s := regexp_replace(s, '\m(i|we)''ll\M', '\1 will', 'g');

  -- every way of typing "going to" we have seen
  s := regexp_replace(s, '\m(gonna|gunna|gona|gnna|gon|gne|gin|finna|fena|fixing to|fixin to|fitna|boutta|bouta|bout to|bout ta|about to|abt to|going ta|goin to|goin ta|goina|goinna|goin)\M', 'going to', 'g');
  s := regexp_replace(s, '\mgoing to to\M', 'going to', 'g');
  s := regexp_replace(s, '\mwanna\M', 'want to', 'g');
  s := regexp_replace(s, '\mgotta\M', 'got to', 'g');
  s := regexp_replace(s, '\mhafta\M', 'have to', 'g');

  -- "u", "yu", "ya", "yoouu" = "you";  "ur", "yur" = "your"
  s := regexp_replace(s, '\m(y*o*u+|yu+|ya|chu)\M', 'you', 'g');
  s := regexp_replace(s, '\m(ur|yur|yor)\M', 'your', 'g');

  return trim(s);
end;
$fn$;

comment on function public.content_normalize(text) is
  'OGN 2026-09-21: one plain spelling for the content filter (smart quotes, zero-width, k1ll, kiiill, u/ur/yall, gonna/finna/gin). Used by content_needs_review and content_needs_care.';

-- ---------------------------------------------------------------------
-- HOLD
-- ---------------------------------------------------------------------
create or replace function public.content_needs_review(input text)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select input is not null and (
    -- (1) a first-person threat against a PERSON
    t ~ $re$\m(i|we)('m|'re|'d)?(\s+(am|are|will|would|shall|really|actually|literally|seriously|just|still|going\s+to|want\s+to|got\s+to|have\s+to|need\s+to|ready\s+to|could|can|might|should|must|swear|promise|definitely|totally|go|so|to))*\s+(k+i+l+|murk|merk|st+a+b+|murder|strangle|choke|slit|behead|rape|blow\s+up|bomb|burn\s+down|stomp|smack|punch|slap|beat(\s+up)?|hurt|end|sh+o+o*t+(\s+up)?)\s+(you(\s+all)?|all\s+of\s+you|him|her|them|everyone|everybody|somebody|someone|anyone|anybody|your\s+ass|your(?=\s*($|[.!?,]))|(my|your|his|her|their|the|that|this|our)\s+([a-z]+\s+)?(pastor|preacher|bishop|elder|deacon|man|woman|lady|guy|girl|boy|kids?|child|children|baby|wife|husband|boss|teacher|neighbou?r|family|mom|mother|dad|father|brother|sister|son|daughter|people|leaders?|cops?|officer|dude|bro|ex|friend|members|congregation|church|coworker|roommate|girlfriend|boyfriend|bitch|hoe|ho|whore|nigg[a-z]*))\M(?!')(?!\s+(with\s+(kindness|love|grace|joy|prayer)|a|an|over|some)\M)$re$
    -- (2) wishing or telling someone to die / kill themselves
    or t ~ $re$\mkill\s*your\s*self\M|\mkys\M|\mhope\s+(you(\s+all)?|he|she|they)\s+(die|dies|burn\s+in\s+hell|gets?\s+killed|rots?)\M|\mgo\s+die\M(?!\s+(to|for|daily|on|in)\M)$re$
    -- (3) "I'm going to make sure he dies / suffers / pays"
    or t ~ $re$\mi('m|\s+am|\s+will)?\s*(going\s+to\s+)?make\s+sure\s+(he|she|they|you)\s+(dies?|suffers?|pays)\M$re$
    -- (4) slurs
    or t ~ $re$\m(nigg[a-z]+|fag|fags|faggot[a-z]*|cunt[a-z]*|retard[a-z]*|tranny)\M$re$
    -- (5) sexual-image solicitation and CSAM
    or t ~ $re$\m(send|post|want|show\s+me|drop)\s+(me\s+)?(a\s+|some\s+|your\s+)?(nudes?|naked\s+(pic|photo|vid)[a-z]*|nude\s+(pic|photo|vid)[a-z]*)\M|\mchild\s*porn[a-z]*\M$re$
    -- (6) money scams
    or t ~ $re$\m(venmo|cash\s*app|cashapp|zelle|paypal|chime|apple\s*pay)\s+me\M|\mdm\s+me\s+for\s+(money|prophecy|blessing|breakthrough)\M$re$
    -- (7) obfuscated profanity
    or t ~ $re$\m(f+[u\*@#!x]+c*k+[a-z]*|sh[i1!\*]+t+[a-z]*|b[i1!\*]tch[a-z]*|a[s\$]{2}hole[a-z]*)\M$re$
    -- (8) link shorteners and invite links
    or t ~ $re$https?://\S*(bit\.ly|tinyurl|t\.me/|wa\.me/)$re$
  )
  from (select public.content_normalize(input) as t) n;
$fn$;

-- ---------------------------------------------------------------------
-- CARE  (publish, and a leader is told)
-- ---------------------------------------------------------------------
create or replace function public.content_needs_care(input text)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select input is not null and t ~ $re$\m((i|we)('m)?\s+(want|going)\s+to\s+(kill\s+my\s*self|die|end\s+(it|my\s+life))|i\s+(don'?t|do\s+not)\s+want\s+to\s+(live|be\s+here)|kill\s+my\s*self|kms|unalive\s+my\s*self|end\s+my\s+life|end\s+it\s+all|take\s+my\s+(own\s+)?life|cut(ting)?\s+my\s*self|hurt(ing)?\s+my\s*self|(am|feel)\s+suicidal|thinking\s+about\s+suicide|no\s+reason\s+to\s+live|better\s+off\s+(dead|without\s+me)|(he|she|they|my\s+[a-z]+)\s+(hits?|beats?|hurts?)\s+me|scared\s+to\s+go\s+home|being\s+abused)\M$re$
  from (select public.content_normalize(input) as t) n;
$fn$;

grant execute on function public.content_needs_review(text) to authenticated, service_role;
grant execute on function public.content_needs_care(text) to authenticated, service_role;

-- =====================================================================
-- MEASURED 2026-09-21 against the live database, straight after applying:
--   select x, content_needs_review(x), content_needs_care(x) from unnest(...)
--
--   HARMFUL  30 of 30 held      BENIGN  0 of 30 held
--
-- HARMFUL (review = true, every one):
--   I’m going to kill u | I’m gin kill your | im gonna shoot you | ima kill u
--   I'm finna kill yall | i will k1ll you
--   I will kill my wife tonight and nobody can stop me.
--   I am going to kill you when I see you at church. | imma shoot you
--   Ill kill you | I'll stab you after service | we gonna beat you up
--   i’m bout to shoot up this church | I’ll murder your whole family
--   I'm gonna kiiiiill you | i'm going to ki<U+200B>ll you
--   I‘m gonna strangle her | we're gonna hurt y'all | i hope u die
--   go kill yourself | kys | Send me nudes | send me ur nudes
--   Venmo me $50 and God will bless you a hundredfold.
--   Zelle me $500 for your breakthrough anointing.
--   cash app me $20 for the anointing | dm me for prophecy
--   F*ck this church and everyone in it | you are a f@#king liar
--   check this https://bit.ly/abc123
--
-- BENIGN (review = false, every one; care = true only where marked):
--   Mark 9:31 "...and they shall kill him; and after that he is killed..."
--   Mark 12:7 "come, let us kill him"
--   I was molested as a child and God has healed me.
--   Before Christ I was a whore. He called me daughter.
--   Genesis 2:25 "And they were both naked, the man and his wife, and were
--     not ashamed" (the owner's shorthand: naked and not ashamed)
--   Rev 17:1 "...the great whore that sitteth upon many waters"
--   After twelve years I was finally set free from pornography.
--   I used to sell drugs on the corner of 5th and Main. Now I preach ...
--   Sowing a Seed of 100 Fold Return
--   Pray for our mission team, we need to send money to Kenya before Friday.
--   I’ll shoot you a text after service
--   I'm going to beat this addiction in Jesus name
--   We are going to kill it at the youth concert tonight!
--   I beat my addiction by God's grace | Kill them with kindness, church
--   Thou shalt not kill. (Exodus 20:13) | John 10:10 | Ecclesiastes 3:3
--   I'm gonna pray for u tonight | Yall come to Bible study Wednesday
--   I’m finna go to church | I hurt my knee at the retreat
--   We will shoot the choir video Saturday
--   Die to self daily. Go die to your pride.
--   I was going to kill myself but God saved me        (care = true)
--   I want to end my life                               (care = true)
--   Col 3:5 "Mortify therefore your members..."
--   I'm gonna shoot the pastor's sermon on camera
--   Eph 6:11 | We are going to kill the giant in your life like David did
--
-- CARE spot-checks (review false, care true): I don’t want to live anymore
--   (smart apostrophe) | my husband hits me | im gonna kms | i wanna die |
--   I feel suicidal tonight | I'm scared to go home.
-- =====================================================================
