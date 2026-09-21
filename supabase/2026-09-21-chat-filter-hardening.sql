-- =====================================================================
-- OGN — content filter, second pass (adversarial review, 2026-09-21)
-- Applied as migration chat_filter_hardening_2026_09_21, straight after
-- chat_filter_normaliser_2026_09_21.
--
-- WHAT THE REVIEW FOUND ON THE LIVE DATABASE (execute_sql, before this file):
--
--   Benign messages that were HELD (wrongly):
--     "I'm sorry I hurt you. Please forgive me."          <- an apology
--     "I know I hurt her feelings"
--     "We beat them 3-1 last night"
--     "We will beat the kids from First Baptist at softball"
--     "We will end the church service at noon"
--     Rev 2:23 KJV "And I will kill her children with death"  <- scripture
--   Cause: the threat clause allowed ZERO intent words, so any past-tense
--   "I hurt you" / "we beat them" read as a threat; "end" and "beat" took
--   "the church" / "the kids" as a victim.
--
--   Threats that PASSED (wrongly):
--     "I'm going to find you and kill you"   "im finna pull up and shoot"
--     "I am going to put a bullet in your head"   "I will hit you"
--     "ima pop you"   "I'm gonna smoke you"   "im gon whoop yo ass"
--     "we finna jump u"   "Imma k i l l you"   "k\u0131ll" (dotless i)
--     "kill \uFF59ou" (full-width)   "ur dead"   "you're dead meat"
--
-- WHAT CHANGES
--   content_normalize: + Unicode NFKC (full-width letters), + look-alike
--     letters (dotless i, Cyrillic \u0430 \u0435 \u043E \u0440 \u0441 \u0443 \u0445 \u0456 \u0458 \u0455), + spaced-out words
--     ("k i l l", "k.i.l.l"), + "yo ass/mama/head" -> "your ...",
--     + standalone "r" -> "are".
--   content_needs_review: the threat test now REQUIRES an intent word
--     (will / going to / want to / 'd / can / about to ...). Strong verbs
--     (kill, shoot, stab, murder, rape ...) keep the full list of victims;
--     weak verbs (hurt, beat, hit, punch, pop, smoke, jump, end ...) only
--     count against a person, never "the church" or "the kids", and not when
--     followed by "at / in / back / with" (games, "hit you back").
--     New clauses: "... and kill you", "pull up and shoot / pull up on you",
--     "a bullet in your head", "you're dead meat / ur dead".
--     "with death" and "with the sword" join "with kindness" as a
--     scripture-shaped ending that is never a threat (Rev 2:23, Ex 22:24).
--   content_needs_care: unchanged text, picks up the new normaliser.
--
-- The filter stays in the database (DO-NOT-BREAK #18). The triggers are
-- untouched; they call these functions by name.
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
  run text;
  guard int := 0;
begin
  if input is null then
    return null;
  end if;

  -- full-width and compatibility letters (\uFF59\uFF4F\uFF55 -> you) before anything else
  s := lower(normalize(input, NFKC));

  -- look-alike letters: dotless i, Cyrillic \u0430 \u0435 \u043E \u0440 \u0441 \u0443 \u0445 \u0456 \u0458 \u0455
  s := translate(s, E'\u0131\u0430\u0435\u043E\u0440\u0441\u0443\u0445\u0456\u0458\u0455', 'iaeopcyxijs');

  -- iPhone smart punctuation and its cousins -> plain ' and "
  s := translate(s, E'\u2019\u2018\u02BC`\u00B4\u2032', '''''''''''''');
  s := translate(s, E'\u201C\u201D\u201E\u2033', '""""');

  -- invisible characters that split a word without showing
  s := regexp_replace(s, E'[\u200B\u200C\u200D\u2060\uFEFF\u00AD]', '', 'g');

  -- digits standing in for letters, only INSIDE a word (k1ll, sh1t, h0e).
  s := regexp_replace(s, '([a-z])1(?=[a-z])', '\1i', 'g');
  s := regexp_replace(s, '([a-z])3(?=[a-z])', '\1e', 'g');
  s := regexp_replace(s, '([a-z])0(?=[a-z])', '\1o', 'g');
  s := regexp_replace(s, '([a-z])4(?=[a-z])', '\1a', 'g');

  s := regexp_replace(s, '\s+', ' ', 'g');

  -- a word spelled out one letter at a time: "k i l l", "k.i.l.l", "k-i-l-l".
  -- Only runs of THREE or more single letters, so "i a" and "u r" are left.
  loop
    run := substring(s from '\m[a-z](?:[ .*_-][a-z]){2,}\M');
    exit when run is null or guard > 20;
    s := replace(s, run, regexp_replace(run, '[ .*_-]', '', 'g'));
    guard := guard + 1;
  end loop;

  -- a letter held down: kiiiiill -> kiill
  s := regexp_replace(s, '([a-z])\1{2,}', '\1\1', 'g');

  -- "you all" first, so "ya'll" is not read as "ya" + "'ll"
  s := regexp_replace(s, '\m(y''all|ya''ll|yall|yal|y''al|yawl)\M', 'you all', 'g');

  s := regexp_replace(s, '\m(i''mma|i''ma|imma|ima|ahma)\M', 'i''m going to', 'g');
  s := regexp_replace(s, '\mim\M', 'i''m', 'g');
  s := regexp_replace(s, '\mill (?=(k+i+l|sh+o+|st+a+b|murder|strangle|choke|beat|hurt|punch|smack|slap|stomp|rape|bomb|burn|end\M))', 'i will ', 'g');
  s := regexp_replace(s, '\m(i|we)''ll\M', '\1 will', 'g');

  s := regexp_replace(s, '\m(gonna|gunna|gona|gnna|gon|gne|gin|finna|fena|fixing to|fixin to|fitna|boutta|bouta|bout to|bout ta|about to|abt to|going ta|goin to|goin ta|goina|goinna|goin)\M', 'going to', 'g');
  s := regexp_replace(s, '\mgoing to to\M', 'going to', 'g');
  s := regexp_replace(s, '\mwanna\M', 'want to', 'g');
  s := regexp_replace(s, '\mgotta\M', 'got to', 'g');
  s := regexp_replace(s, '\mhafta\M', 'have to', 'g');

  s := regexp_replace(s, '\m(y*o*u+|yu+|ya|chu)\M', 'you', 'g');
  s := regexp_replace(s, '\m(ur|yur|yor)\M', 'your', 'g');
  -- "yo" is a greeting on its own; only "yo ass / yo mama / yo head" is "your"
  s := regexp_replace(s, '\myo (?=(ass|butt|mama|momma|mom|head|face|family|kids|house|girl|man|wife|husband)\M)', 'your ', 'g');
  -- "u r" -> "you are"
  s := regexp_replace(s, '\m(you) r\M', '\1 are', 'g');

  return trim(s);
end;
$fn$;

comment on function public.content_normalize(text) is
  'OGN 2026-09-21 (v2): one plain spelling for the content filter — NFKC, look-alike letters, smart quotes, zero-width, k1ll, k i l l, kiiill, u/ur/yall/yo ass, gonna/finna/gin. Used by content_needs_review and content_needs_care.';

create or replace function public.content_needs_review(input text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  t text;
  -- "i", "we", "i'm", "we're", "i am", "we are"
  head constant text := '\m(i|we)(''m|''re|\s+am|\s+are)?';
  fill constant text := '(really|actually|literally|seriously|just|still|so|definitely|totally|swear|promise|finally|lowkey|deadass|fr|go|come|and|to)';
  intent constant text := '(will|would|shall|going\s+to|want\s+to|got\s+to|have\s+to|need\s+to|ready\s+to|about\s+to|trying\s+to|try\s+to|plan\s+to|could|can|might|should|must)';
  lead text;
  strong constant text := '(k+i+l+|murk|merk|st+a+b+|murder|strangle|slit|behead|rape|blow\s+up|bomb|burn\s+down|kidnap|torture|drown|lynch|sh+o+o*t+(\s+up)?)';
  weak constant text := '(hurt|beat(\s+up)?|punch|smack|slap|hit(?!(\s+[a-z'']+){1,2}\s+up\M)|whoop|jump|pop|smoke|end|stomp|choke|body)';
  nouns constant text := '(pastor|preacher|bishop|elder|deacon|man|woman|lady|guy|girl|boy|kids?|child|children|baby|wife|husband|boss|teacher|neighbou?r|family|mom|mother|dad|father|brother|sister|son|daughter|people|leaders?|cops?|officer|dude|bro|ex|friend|members|congregation|church|coworker|roommate|girlfriend|boyfriend|bitch|hoe|ho|whore|nigg[a-z]*)';
  close_nouns constant text := '(wife|husband|kids?|child|children|baby|mom|mother|dad|father|brother|sister|son|daughter|girlfriend|boyfriend|ex|family|boss|pastor|neighbou?r|roommate|coworker|friend)';
  pronoun constant text := '(you(\s+all)?|all\s+of\s+you|him|her|them|your\s+ass|your(?=\s*($|[.!?,])))';
  -- "kill them with kindness", Rev 2:23 "kill her children with death",
  -- Ex 22:24 "kill you with the sword", "shoot you a text", "shoot you guys the address"
  not_scripture constant text := '(?!(\s+[a-z]+)?\s+with\s+(kindness|love|grace|joy|prayer|death|the\s+sword|his\s+word)\M)(?!\s+(a|an|some|over|guys\s+(a|an|some|the|over|my|our|this|that))\M)';
begin
  if input is null then
    return false;
  end if;
  t := public.content_normalize(input);
  lead := head || '(''d|(\s+' || fill || ')*\s+' || intent || ')(\s+(' || fill || '|' || intent || '))*\s+';

  return
    -- (1a) first-person INTENT + strong verb + a person
    t ~ (lead || strong || '\s+(' || pronoun || '|everyone|everybody|somebody|someone|anyone|anybody|(my|your|his|her|their|the|that|this|our)\s+([a-z]+\s+)?' || nouns || ')\M(?!'')' || not_scripture)
    -- (1b) first-person INTENT + weak verb + a person (not a game, not "hit you back")
    or t ~ (lead || weak || '\s+(' || pronoun || '|(my|your|his|her|their)\s+([a-z]+\s+)?' || close_nouns || ')\M(?!'')(?!\s+(back|with|at|in|on|a|an|over|later|first|there)\M)')
    -- (1c) "I'm going to find you and kill you"
    or t ~ (lead || '[^.!?]{0,40}\m(and|then|n)\s+' || strong || '\s+(you(\s+all)?|him|her|them)\M' || not_scripture)
    -- (1d) "pull up and shoot" / "pull up on you"
    or t ~ (lead || 'pull\s+up(\s+on\s+(you|him|her|them)\M|\s+(and|n)\s+(shoot|spray|blast|kill|air))')
    -- (1e) a bullet in your head
    or t ~ '\m(bullet|cap|slug|round)s?\s+in\s+(you|your|his|her|their)\M'
    -- (1f) "you're dead meat", "ur dead"
    or t ~ '\myou(''re|\s+are)\s+(dead\s+meat|a\s+dead\s+(man|woman)|so\s+dead)\M|\m(you''re|you\s+are|your)\s+dead\s*($|[.!,])'
    -- (2) wishing or telling someone to die / kill themselves
    or t ~ '\mkill\s*your\s*self\M|\mkys\M|\mhope\s+(you(\s+all)?|he|she|they)\s+(die|dies|burn\s+in\s+hell|gets?\s+killed|rots?)\M|\mgo\s+die\M(?!\s+(to|for|daily|on|in)\M)'
    -- (3) "I'm going to make sure he dies / suffers / pays"
    or t ~ '\mi(''m|\s+am|\s+will)?\s*(going\s+to\s+)?make\s+sure\s+(he|she|they|you)\s+(dies?|suffers?|pays)\M'
    -- (4) slurs ("retard" but not "retardant")
    or t ~ '\m(nigg[a-z]+|fag|fags|faggot[a-z]*|cunt[a-z]*|retard(s|ed)?|tranny)\M'
    -- (5) sexual-image solicitation and CSAM
    or t ~ '\m(send|sned|post|want|show\s+me|drop)\s+(me\s+)?(a\s+|some\s+|your\s+)?(nudes?|naked\s+(pic|photo|vid)[a-z]*|nude\s+(pic|photo|vid)[a-z]*)\M|\mchild\s*porn[a-z]*\M'
    -- (6) money scams
    or t ~ '\m(venmo|cash\s*app|cashapp|zelle|paypal|chime|apple\s*pay)\s+me\M|\mdm\s+me\s+for\s+(money|prophecy|blessing|breakthrough)\M'
    -- (7) obfuscated profanity
    or t ~ '\m(f+[u\*@#!x]+c*k+[a-z]*|sh[i1!\*]+t+[a-z]*|b[i1!\*]tch[a-z]*|a[s\$]{2}hole[a-z]*)\M'
    -- (8) link shorteners and invite links
    or t ~ 'https?://\S*(bit\.ly|tinyurl|t\.me/|wa\.me/)';
end;
$fn$;

grant execute on function public.content_needs_review(text) to authenticated, service_role;

-- Scratch copies used to test this file before it went live.
drop function if exists public.zz_cr_test(text);
drop function if exists public.zz_cn_test(text);

-- =====================================================================
-- MEASURED 2026-09-21 against the live database, straight after applying:
--   select x, content_needs_review(x), content_needs_care(x) from unnest(...)
--
--   HARMFUL  55 of 55 held        BENIGN  0 of 56 held
--
-- HARMFUL (review = true, every one; care = false):
--   I’m going to kill u | I’m gin kill your | im gonna shoot you | ima kill u
--   I'm finna kill yall | i will k1ll you
--   I will kill my wife tonight and nobody can stop me.
--   I am going to kill you when I see you at church. | imma shoot you
--   Ill kill you | I'll stab you after service | we gonna beat you up
--   i’m bout to shoot up this church | I’ll murder your whole family
--   I'm gonna kiiiiill you | i'm going to ki<U+200B>ll you | I‘m gonna strangle her
--   we're gonna hurt y'all | i hope u die | go kill yourself | kys
--   Send me nudes | send me ur nudes | Venmo me $50 and God will bless you ...
--   Zelle me $500 for your breakthrough anointing. | cash app me $20 ...
--   dm me for prophecy | F*ck this church and everyone in it
--   you are a f@#king liar | check this https://bit.ly/abc123
--   NEW: I'm going to find you and kill you | im finna pull up and shoot
--   I am going to put a bullet in your head | I will hit you | ima pop you
--   I'm gonna smoke you | im gon whoop yo ass | we finna jump u
--   Imma k i l l you | I’m going to k<U+0131>ll you | I’m going to kill <U+FF59>ou
--   ur dead | you're dead meat | I'mma end you | I'll slap u | I wanna kill you
--   Ill kill ya | I'd kill you | I will hurt my wife | I swear I will beat my ex
--   i'm going to pull up on you | we will burn down the church | I will rape her
--   i will shoot the pastor | I’m gonna come over there and stab u
--
-- BENIGN (review = false, every one; care = true only where marked):
--   Mark 9:31 (full KJV verse) | Mark 12:7 "come, let us kill him"
--   I was molested as a child and God has healed me.
--   Before Christ I was a whore. He called me daughter.
--   Genesis 2:25 (full KJV verse) | naked and not ashamed | Rev 17:1
--   Rev 2:23 "And I will kill her children with death ..."   (was HELD before)
--   Exodus 22:24 "... I will kill you with the sword"
--   I'm sorry I hurt you. Please forgive me.                  (was HELD before)
--   I know I hurt her feelings                                (was HELD before)
--   We beat them 3-1 last night                               (was HELD before)
--   We will beat the kids from First Baptist at softball      (was HELD before)
--   We will end the church service at noon                    (was HELD before)
--   After twelve years I was finally set free from pornography.
--   I used to sell drugs on the corner of 5th and Main. Now I preach ...
--   Sowing a Seed of 100 Fold Return | Pray for our mission team, we need to
--   send money to Kenya before Friday. | I’ll shoot you a text after service
--   I'm going to beat this addiction in Jesus name
--   We are going to kill it at the youth concert tonight!
--   I beat my addiction by God's grace | Kill them with kindness, church
--   Thou shalt not kill. (Exodus 20:13) | John 10:10 | Ecclesiastes 3:3
--   I'm gonna pray for u tonight | Yall come to Bible study Wednesday
--   I’m finna go to church | I hurt my knee at the retreat
--   We will shoot the choir video Saturday | Die to self daily. Go die to your pride.
--   I was going to kill myself but God saved me                (care = true)
--   I want to end my life                                      (care = true)
--   I'm gonna shoot the pastor's sermon on camera
--   We are going to kill the giant in your life like David did
--   I'll hit you up later | I will hit you back after prayer
--   I'm going to beat my brother at chess | I would never hurt you
--   I don't want to hurt you | Yo what's up church | u r a blessing
--   I will shoot you guys the address | We can do all things through Christ
--   I will pop by your house | Ya know I love you | See u at church
--   the gin was cold | fire retardant blankets for the shelter
--   I will end the meeting with prayer
--   We're going to smoke some brisket for the picnic | I will jump in the pool
--   Col 3:3 For ye are dead ... | you are dead to sin and alive in Christ
--   I am so sorry I hurt you all
--
-- CARE spot-checks (review false, care true): I don’t want to live anymore
--   | my husband hits me | im gonna kms | i wanna die | I feel suicidal tonight
--   | I'm scared to go home.     Empty string and NULL: false / false.
--
-- KNOWN LIMITS (a person still reviews anything held, and Report still works):
--   "I know where you live", "watch your back", "u r gonna die" and
--   "sned me nudes" (typo) are NOT held — each has too many innocent uses or
--   is a misspelling we cannot enumerate. "We can beat them" (sport) IS held.
-- =====================================================================
