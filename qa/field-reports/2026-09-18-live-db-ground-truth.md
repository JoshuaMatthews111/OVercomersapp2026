# Live database ground truth — read before fixing anything

Queried directly against Supabase project OGNAPP2026 (ljmzujrzdhwmvvapajlr)
on 2026-09-18, AFTER the owner's device run. These facts OVERRIDE any
contrary claim in the audit findings.

## app_stories

Columns: id, title(NOT NULL), category, body, region, image_url, action_url,
visibility_role(default 'member'), status(default 'published'), sort_order,
created_by, published_at(default now()), created_at(default now()),
updated_at(default now()), expires_at(DEFAULT now() + interval '24 hours').

- `expires_at` EXISTS and HAS a 24-hour default. A story inserted without it
  is NOT hidden. Any finding that says a NULL expires_at hides stories is WRONG.
- The owner's story posted 2026-09-18 10:31:55 UTC, id d4d68888-9f57-4c08-9efa-42fb25f494d4,
  title "Test", status published, expires 2026-09-19, has an image_url.
  IT PUBLISHED CORRECTLY AND IS STILL LIVE.
  => S1/S11 are NOT a write failure. Home simply never refetches. Fix the client.
- That same row still exists, so the owner's DELETE genuinely did not happen.
  => S12 is a real failure in the delete path or its RLS. Find it.
- `title` is NOT NULL in the database. S9 (optional title) therefore needs a
  MIGRATION (drop the NOT NULL, or default it to ''), not only a client change.

RLS on app_stories: "public reads published stories by role" (SELECT),
"leaders manage stories" (ALL), "content publishers manage app stories" (ALL).

## media_items

- The owner's embed posted 2026-09-18 10:36:01 UTC, id 3740936d-e31a-45a5-b6f4-d2dd29a7e4a2,
  title "Gospel of Salvation", media_type sermon, status published,
  external_url https://youtu.be/G5h7XID3Re8?is=4DKloCQczdogCpo7
  IT SAVED CORRECTLY. thumbnail_url IS NULL.
  => V3 is purely a client refresh bug. V4 (no cover) is real: nothing derives
     a YouTube thumbnail.
- A `thumbnail_url` column already exists on media_items. Use it.
- Left-over QA row: "App Review PDF Smoke Test" (article, 2026-06-20).

RLS on media_items: "public reads published media by role" (SELECT),
"media managers manage media items" (ALL), "media publishers manage media items" (ALL).

## chat_channels

RLS already allows member-created chats:
- "authenticated create private chat channels" (INSERT)
- "members read joined private channels" (SELECT)
- "auth read public channels" (SELECT)
- "moderators manage channels" (ALL)
=> C2 needs CLIENT work only. The backend is ready. Do not write a migration for it.

## Storage buckets — real limits

| bucket             | public | size limit | mime allow-list |
|--------------------|--------|-----------|-----------------|
| app-assets         | yes    | 1 GB      | any |
| story-media        | yes    | 1 GB      | ANY (no allow-list) |
| sermon-media       | yes    | 500 MB    | audio/mpeg, audio/mp4, video/mp4, application/pdf, image/png, image/jpeg, image/webp |
| chat-attachments   | no     | **50 MB** | includes video/quicktime, video/mp4, video/webm, video/x-m4v, image/heic, image/heif |
| ogn-public         | yes    | 10 MB     | image/png, image/jpeg, image/webp, image/gif, video/mp4 |
| profile-avatars    | yes    | 5 MB      | image/png, image/jpeg, image/webp |
| outreach-private   | no     | 20 MB     | image + pdf |
| prayer-attachments | no     | 20 MB     | image + pdf |

- story-media has NO mime allow-list. Any claim that it rejects video/quicktime
  is WRONG. Stories can already take an iPhone .mov.
- chat-attachments IS the 50 MB wall for C5, and it DOES permit video/quicktime.
  Raising the client cap alone changes nothing; the bucket limit must be raised too.
- sermon-media does NOT allow video/quicktime. An iPhone .mov sermon upload fails
  there today.

## Packages available for the speed work (verified installed)

- expo-file-system 57.0.7 — has UploadTask with an onProgress callback, and it
  streams from disk. This is how to kill the base64/JS-heap upload path AND get
  a real progress bar. OTA-safe.
- expo-image-manipulator 57.0.19 — INSTALLED 2026-09-18 for downscaling photos
  before upload. This is a native module, so it needs a new EAS build.
- expo-image 57.0.5, expo-video 57.0.4, expo-audio 57.0.5, expo-image-picker 57.0.19.
- There is NO video compression package installed and none is being added.
  Handle big video by streaming the upload and raising the bucket limit, not by
  transcoding on the phone.

## S12 delete — evidence gathered 2026-09-18 (read this before "fixing" it)

The row d4d68888 ("Test") is STILL in app_stories. Confirmed twice by direct query.

Ruled OUT: RLS. The story's created_by is 37b40a89-06c4-4a3d-a850-b5a3c880047f
(appreview@overcomersglobalnetwork.com), who holds super_admin, admin, leader,
staff and outreach. `is_staff_or_above()` returns true for that user, and the
"leaders manage stories" policy is FOR ALL USING is_staff_or_above(). The delete
was permitted. It simply did not take effect.

What the code does today, and why the user saw nothing:
- lib/adminManagementService.ts:122 `deleteStory` runs
  `supabase.from('app_stories').delete().eq('id', id)` with NO `.select()`.
  PostgREST then returns 204 with no body. A delete that matches ZERO rows is
  indistinguishable from one that matched. The function cannot tell success from
  a silent no-op, so it never throws.
- app/admin.tsx:145 and :525 call `run('', () => deleteStory(s.id))`. The first
  argument is the success message and it is the EMPTY STRING, so app/admin.tsx:85
  `if (done) Alert.alert(done)` never fires. The user gets no confirmation at all.
- run() then awaits refresh(), which reloads the ENTIRE admin workbench
  (messages, stories, media, prayers) before the busy flag clears. That is the
  "super long time ... nothing's happening".
- Home would not have updated in any case, because Home never refetches (S1).

Required fix (P3 owns the service, P6 owns the screen):
1. `.delete().eq('id', id).select('id')` and throw a plain-language error when
   the returned array is empty ("That story could not be removed. You may not
   have permission, or it was already gone.").
2. Give run() a real success message for every destructive action.
3. Remove the row from local state immediately, then refresh in the background.
   Never make the user wait on a full workbench reload to see their own action.

NOT YET EXPLAINED: why a permitted delete matched zero rows on the device. The
most likely remaining cause is that the request never reached the server. Once
fix 1 is in, the next device run will say so out loud instead of failing silently.
Do not claim this is solved until a device run shows the new error path or a
successful delete.
