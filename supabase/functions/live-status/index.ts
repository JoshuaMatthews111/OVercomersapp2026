// live-status: is the ministry live on YouTube right now?
//
// Any signed-in phone may ask (verify_jwt is on, and signedInCaller() turns
// away the anon key, which verify_jwt alone lets through). The answer is cached in the
// one-row table public.live_status, so however many phones ask, YouTube is
// looked at no more than about once a minute. No YouTube API key: the check
// reads the channel's public /live page, and the title is confirmed through
// YouTube's open oEmbed endpoint. The rules live in ./logic.ts, which the app
// and the tests share.
//
// A leader's Go live / End live is NOT written here. That goes straight to
// live_status.manual_override from the app, guarded by row-level security and
// a trigger (supabase/2026-09-22-live-status.sql). This function only reads it.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.108.1';
import {
  LIVE_CACHE_MS,
  OGN_CHANNEL_ID,
  detectionColumns,
  parseYouTubeLivePage,
  resolveLiveState,
  rowNeedsRefresh,
  signedInCaller,
  type LiveRow,
  type YouTubeDetection,
} from './logic.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const COLUMNS = 'id,source,video_id,url,title,is_live,started_at,checked_at,confirmed_at,detail,embeddable,manual_override';

// A desktop browser asking in English. The consent cookies stop YouTube from
// answering a server in Europe with its cookie banner instead of the page.
const PAGE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  Accept: 'text/html,application/xhtml+xml',
  Cookie: 'CONSENT=YES+cb; SOCS=CAI',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'GET' && req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  // Signed-in members only. verify_jwt alone also admits the public anon key.
  if (!signedInCaller(req.headers.get('Authorization'))) return json({ error: 'Please sign in.' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server is not configured.' }, 500);
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const channelId = Deno.env.get('OGN_YOUTUBE_CHANNEL_ID') || OGN_CHANNEL_ID;

  const first = await db.from('live_status').select(COLUMNS).eq('id', 1).maybeSingle();
  if (first.error) return json({ error: 'Could not read the live status.' }, 500);
  let row = (first.data || null) as LiveRow | null;
  const startedAt = Date.now();

  if (rowNeedsRefresh(row, startedAt)) {
    // Claim the refresh. Only the request that moves checked_at forward goes to
    // YouTube; every other phone arriving in the same moment gets the cache.
    const nowIso = new Date(startedAt).toISOString();
    const staleBefore = new Date(startedAt - LIVE_CACHE_MS + 1).toISOString();
    let claimed = false;
    if (row) {
      const claim = await db
        .from('live_status')
        .update({ checked_at: nowIso })
        .eq('id', 1)
        .or(`checked_at.is.null,checked_at.lt."${staleBefore}"`)
        .select('id');
      claimed = !claim.error && Array.isArray(claim.data) && claim.data.length > 0;
    } else {
      const created = await db.from('live_status').insert({ id: 1, checked_at: nowIso }).select('id');
      claimed = !created.error;
    }

    if (claimed) {
      const { found, confirmedTitle } = await lookAtYouTube(channelId);
      const columns = detectionColumns(row, found, new Date().toISOString(), confirmedTitle);
      const saved = await db.from('live_status').update(columns).eq('id', 1).select(COLUMNS).maybeSingle();
      if (!saved.error && saved.data) row = saved.data as LiveRow;
      console.log(JSON.stringify({ event: 'live-status-check', state: found.state, reason: found.reason, videoId: found.videoId, embeddable: found.embeddable ?? null }));
    } else {
      const again = await db.from('live_status').select(COLUMNS).eq('id', 1).maybeSingle();
      if (!again.error && again.data) row = again.data as LiveRow;
    }
  }

  return json(resolveLiveState(row, Date.now()));
});

async function lookAtYouTube(channelId: string): Promise<{ found: YouTubeDetection; confirmedTitle: string | null }> {
  let page: { status: number; finalUrl: string; text: string };
  try {
    page = await fetchText(`https://www.youtube.com/channel/${channelId}/live?hl=en&gl=US`, PAGE_HEADERS, 9000);
  } catch {
    return { found: unsure('could not reach YouTube'), confirmedTitle: null };
  }
  if (page.status !== 200) return { found: unsure(`YouTube answered ${page.status}`), confirmedTitle: null };
  if (/consent\.youtube\.com/.test(page.finalUrl)) {
    return { found: unsure('YouTube showed a cookie-consent page instead of the channel'), confirmedTitle: null };
  }

  const found = parseYouTubeLivePage(page.text, channelId);
  if (found.state !== 'live' || !found.videoId) return { found, confirmedTitle: null };

  // Cross-check the live video through oEmbed: its real title, and whether it
  // may be played inside another app at all. YouTube answers 401 (sometimes
  // 403) for a video whose channel has turned embedding off — the app then
  // offers "Watch on YouTube" instead of a player that could only show
  // YouTube's own error screen.
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${found.videoId}`)}&format=json`;
    const reply = await fetchText(oembedUrl, { 'Accept-Language': 'en-US,en;q=0.9' }, 4000);
    if (reply.status === 200) {
      const parsed = JSON.parse(reply.text) as { title?: unknown };
      const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
      return { found: { ...found, embeddable: true }, confirmedTitle: title || null };
    }
    if (reply.status === 401 || reply.status === 403) {
      return {
        found: {
          ...found,
          embeddable: false,
          reason: `${found.reason}; embedding is turned off for this video, so it may only play in YouTube`,
        },
        confirmedTitle: null,
      };
    }
    // Any other answer (404, a timeout, YouTube having a bad minute) tells us
    // nothing about embedding, so we do not claim to know.
    return { found, confirmedTitle: null };
  } catch {
    return { found, confirmedTitle: null };
  }
}

function unsure(reason: string): YouTubeDetection {
  return { state: 'unsure', reason, videoId: null, title: null, channelId: null, startedAt: null, embeddable: null };
}

async function fetchText(url: string, headers: Record<string, string>, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers, redirect: 'follow', signal: controller.signal });
    const text = await response.text();
    return { status: response.status, finalUrl: response.url, text };
  } finally {
    clearTimeout(timer);
  }
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
