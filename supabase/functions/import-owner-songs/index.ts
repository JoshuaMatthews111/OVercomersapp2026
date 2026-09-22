// import-owner-songs — RETIRED. Always answers 410 Gone.
//
// On 2026-09-22 this function was deployed once, for a few minutes, to put the
// owner's two songs into the PUBLIC sermon-media bucket (there is no service
// role key on the developer's Mac). That version accepted
// POST { token, path, contentType, base64 }, checked a one-time random token
// (generated at run time, never committed) in constant time, accepted only
// these four exact paths, and uploaded with the service role:
//   music/the-yhwh-power-chant.m4a          (audio/mp4)
//   music/the-yhwh-power-chant-cover.jpg    (image/jpeg)
//   music/resilience-jc-jacobs.mp3          (audio/mpeg)
//   music/resilience-jc-jacobs-cover.jpg    (image/jpeg)
// Straight after the four uploads it was redeployed as this stub. The Supabase
// MCP cannot delete a function; delete it from the dashboard
// (Edge Functions > import-owner-songs > Delete) whenever convenient.
// Songs posted from now on go through Admin > Library like any other media.
//
// Review, later on 2026-09-22: deployed once more for about a minute, with a
// new one-time token and ONE allowed path (music/the-yhwh-power-chant-cover.jpg),
// to replace that cover with a copy whose faint leftover lyric line was
// smoothed out. Retired again straight after; the token is deleted.

Deno.serve(() =>
  new Response(JSON.stringify({ error: 'Gone. This one-off importer has been retired.' }), {
    status: 410,
    headers: { 'Content-Type': 'application/json' },
  }),
);
