# Audit findings — stories

Read-only audit of 2026-09-18. Verify each cause yourself before acting.
Findings marked needs-device-check are NOT proven — treat as a hypothesis.

## S1 — Home loads stories once on mount and never again - no refetch, no focus listener, no realtime
**severity** blocker · **confidence** confirmed-in-code
**files** app/(tabs)/index.tsx:74, app/(tabs)/index.tsx:82, lib/contentService.ts:59, supabase/app_feature_expansion.sql:370, app/(tabs)/community.tsx:90
**root cause** app/(tabs)/index.tsx:74-77 is the only place stories are fetched:

  useEffect(() => {
    getEvents().then(setEvents);
    getAppStories().then(setRemoteStories);
  }, []);

The dependency array is empty. I grepped the whole of app/ and lib/ for useFocusEffect, RefreshControl, onRefresh and .channel( - Home appears in none of them. The outer ScrollView at index.tsx:116 has no refreshControl prop. app_stories IS already added to the supabase_realtime publication (supabase/app_feature_expansion.sql:370), so the backend is ready and the client simply never subscribes. Contrast app/(tabs)/community.tsx:90, which does wire a RefreshControl - the pattern exists in this codebase, it is just missing on Home.

Home is a tab screen under expo-router Tabs with no unmountOnBlur, so switching tabs does not remount it, and pushing /admin stacks on top of it rather than replacing it. Returning from Admin therefore re-renders Home with the same stale remoteStories array. Only a full app restart refetches.

The 60-second ticker at index.tsx:82-85 makes this worse by disguising it: it calls setNow every minute, which re-renders the ring and re-runs the isStoryLive filter at line 90, so the '23h left' labels keep counting down and the screen looks live while the underlying data has not been refetched since launch.
**fix plan** In app/(tabs)/index.tsx, extract the two loaders into a single loadHome() callback. Wrap it in useFocusEffect(useCallback(...)) from expo-router (already imported in app/index.tsx:4, so the dependency is present) so returning from /admin or re-entering the Home tab refetches. Add a RefreshControl to the outer ScrollView at index.tsx:116, copying the shape used at app/(tabs)/community.tsx:90 (tintColor colors.gold), with a refreshing state. Then add a realtime subscription in the same effect: supabase.channel('app-stories-home').on('postgres_changes', { event: '*', schema: 'public', table: 'app_stories' }, () => loadHome()).subscribe(), removed on cleanup - app_stories is already in the publication so no migration is needed. Keep the 60s ticker for the countdown labels; it is correct, it just must not be mistaken for a refetch.
**risk** DO-NOT-BREAK item 15 requires that Home never show demo stories when the backend is configured. The storiesEmpty branch at index.tsx:92 and 191 must keep working, so loadHome must not leave remoteStories in a half-set state during refresh (set it in one go, do not clear then fill, or the ring will flash the empty card). Item 8 (stories expire after 24h and open in story-viewer) and item 11 (approved visuals) are untouched by this change. A realtime subscription adds a websocket to Home; if it is not torn down on unmount it will leak, and DO-NOT-BREAK item 6's warning about chat embeds does not apply here but the same channel-cleanup discipline does.

## S11 — createAdminStory never writes expires_at, but getAppStories filters on it - a NULL there hides the story from Home forever
**severity** blocker · **confidence** likely
**files** lib/contentService.ts:303, lib/contentService.ts:65, supabase/app_feature_expansion.sql:49, lib/adminManagementService.ts:32
**root cause** lib/contentService.ts:303-315 inserts a story with exactly these columns: title, category, body, region, image_url, action_url, status, created_by, published_at. There is no expires_at.

But lib/contentService.ts:61-68 reads with:

  .select('id, title, category, body, region, image_url, action_url, published_at, expires_at, created_at')
  .eq('status', 'published')
  .gt('expires_at', new Date().toISOString())

In PostgREST a .gt() comparison against NULL is never true, so any row whose expires_at is NULL is silently excluded from Home.

The repo cannot tell me whether the live column has a default. grep for expires_at across supabase/ returns zero hits - the CREATE TABLE for app_stories at supabase/app_feature_expansion.sql:49-64 declares id, title, category, body, region, image_url, action_url, visibility_role, status, sort_order, created_by, published_at, created_at, updated_at and nothing else. The column was evidently added out of band. DO-NOT-BREAK.md item 15 asserts it defaults to publish + 24h, but that is a claim in a document, not a constraint in this repo.

What makes this the likely second cause of S1/S11 rather than speculation: the Admin Library list at lib/adminManagementService.ts:32 selects expires_at but does NOT filter on it, and app/admin.tsx:517 filters only on status === 'published'. So a story with a NULL expires_at is visible in Admin (where the owner found his test story and deleted it, per S12) and invisible on Home (S1, S11) at the same time. That is precisely the pair of symptoms reported.
**fix plan** Two edits, both needed. First, make the client authoritative: in lib/contentService.ts createAdminStory, add expires_at: new Date(Date.now() + STORY_LIFETIME_MS).toISOString(), importing STORY_LIFETIME_MS from lib/storyTime.ts (it is already exported at storyTime.ts:3) so the 24h constant lives in one place. Second, make the server safe for rows written by anything else: add a migration under supabase/migrations/ that does ALTER TABLE public.app_stories ADD COLUMN IF NOT EXISTS expires_at timestamptz, then ALTER COLUMN expires_at SET DEFAULT (now() + interval '24 hours'), and backfills existing NULLs to published_at + interval '24 hours'. The repo currently has no migration for this column at all, which is itself the bug behind the bug. Optionally relax the read filter to .or('expires_at.is.null,expires_at.gt.<now>') as a belt-and-braces measure, but the migration is the real fix.
**risk** DO-NOT-BREAK item 15 says stories are filtered on the server by expires_at and that Home shows the empty ring rather than demo stories - both must survive. Backfilling NULLs will make previously hidden test stories suddenly appear on Home for up to 24h; check what is currently in the table before running it, and consider setting archived status on old test rows instead. Item 8 (24h expiry) is the behaviour being restored, not changed. Before editing anything, settle this on the live project (ljmzujrzdhwmvvapajlr) with: select column_name, column_default, is_nullable from information_schema.columns where table_name='app_stories' and column_name='expires_at'; then select id, title, published_at, expires_at from app_stories order by created_at desc limit 5; If expires_at comes back NULL on the newest rows, this finding is confirmed.

## S3 — Story upload base64-encodes the whole file on the JS thread, unchunked, untimed and with no progress
**severity** blocker · **confidence** confirmed-in-code
**files** app/admin.tsx:202, lib/uploadService.ts:27, lib/uploadBody.ts:6, lib/supabase.ts:15, lib/uploadAnalysis.ts:51, lib/contentService.ts:301
**root cause** Every awaited step between picking media and the alert, in order.

In pickMedia (app/admin.tsx:202-215), which runs on tap of the dropzone, not on Post:
1. ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images','videos'], quality: 0.86 }) - admin.tsx:203. quality only compresses stills; videoQuality and videoMaxDuration are not set, so video is uploaded at full capture size.
2. uploadPickedAsset (lib/uploadService.ts:17):
   a. await supabase.auth.getUser() - uploadService.ts:27. Network round trip, 15s timeout.
   b. await readUploadBody(asset.uri) - uploadService.ts:34 into lib/uploadBody.ts:8-13: new File(uri), file.size, then await file.arrayBuffer(). This pulls the entire file into the JS heap. It is covered by no timeout at all, because fetchWithTimeout only wraps fetch.
   c. await supabase.storage.from(bucketId).upload(objectPath, upload.body, ...) - uploadService.ts:36-41. This is where the real cost is. lib/supabase.ts:15 gives storage POSTs a 120000 ms timeout, but before the request even leaves JS, React Native converts the ArrayBuffer body to base64 in JavaScript: node_modules/react-native/Libraries/Network/convertRequestBody.js:38-41 reads

     if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
       return {base64: binaryToBase64(body)};
     }

   So a 40 MB video becomes roughly a 53 MB base64 JS string, built synchronously on the JS thread, marshalled over the bridge, then decoded natively. supabase-js .upload() exposes no progress callback and does not chunk or use resumable/TUS.
   d. getReachableStorageUrl - uploadService.ts:44. story-media is in the publicBuckets set at uploadService.ts:108, so this is getPublicUrl, no network. Fine.
   e. await recordUploadedFile - uploadService.ts:46, which calls supabase.auth.getUser() AGAIN at lib/uploadAnalysis.ts:51 plus an insert into uploaded_files.

Then in post (app/admin.tsx:217-230), on tap of Post story:
3. createAdminStory - lib/contentService.ts:301 calls supabase.auth.getUser() a THIRD time, then inserts into app_stories.
4. Alert.alert('Story posted', ...) - admin.tsx:223.
5. await onDone() - fires AdminScreen.refresh(), which is getAdminWorkbench(): seven parallel Supabase queries (lib/adminManagementService.ts:24-34).

Where it stalls for minutes: step 2b and the base64 encode inside 2c, neither of which any timeout can see. Where feedback is missing: the only indicator is the bottom button label flipping to 'Working...' (admin.tsx:244). StoryForm's saving state is local and is never passed up to Shell, so the header ActivityIndicator at admin.tsx:557 stays hidden - Shell's busy prop is only fed by AdminScreen's own run() at admin.tsx:113.
**fix plan** Stop materialising the file in JS. In lib/uploadService.ts, replace the readUploadBody + .upload(arrayBuffer) pair with a FormData upload: build const form = new FormData(); form.append('file', { uri: asset.uri, name: fileName, type: mimeType } as any), and post it. React Native streams a {uri} FormData part natively (convertRequestBody.js:34-36 hands FormData straight to native as parts), so nothing is base64-encoded in JS. supabase-js .upload() accepts FormData; if the typing fights you, use supabase.storage.from(bucket).uploadToSignedUrl() or a direct fetch to the storage object endpoint with the session access token, keeping the same objectPath convention.
For progress, switch that one request to XMLHttpRequest and wire xhr.upload.onprogress to a new onProgress callback threaded through uploadPickedAsset into StoryForm, so the dropzone can show a percentage instead of 'Working...'.
Collapse the three auth round trips into one: call supabase.auth.getSession() once in StoryForm.post and pass the user id down to uploadPickedAsset, recordUploadedFile and createAdminStory as an argument.
Lift StoryForm's saving into AdminScreen (or pass a setBusy prop) so Shell's existing header ActivityIndicator at admin.tsx:557 actually spins during the upload.
Compress video before upload rather than raising limits blindly - see S6.
**risk** lib/uploadService.ts is shared by chat attachments, profile avatars, media thumbnails and media files, so a regression here hits DO-NOT-BREAK item 20 (chat attachments to the private chat-attachments bucket under <room>/<user>/, read through signed links) and item 9 (the profile-photo picker on signup and More/Profile). Do not change getReachableStorageUrl - the public/private bucket split at uploadService.ts:108 is what keeps chat-attachments private, and that bucket must never become public. Test a chat photo, a chat video, a profile avatar and a sermon file after any edit here, not just a story. The FormData change alters the exact bytes Supabase receives; verify contentType still lands correctly or thumbnails and in-app playback (item 7) will break.

## S6 — Story video upload is rejected for iPhone .mov files - the bucket allows only video/mp4 - and is capped at 50 MB on both client and server
**severity** high · **confidence** confirmed-in-code
**files** supabase/app_feature_expansion.sql:313, lib/uploadService.ts:126, lib/uploadBody.ts:9, app/admin.tsx:203, app/(tabs)/index.tsx:275
**root cause** Video IS requested by the picker - app/admin.tsx:203 passes mediaTypes: ['images','videos'] - and the viewer DOES render video (app/story-viewer.tsx:102-103 branches to StoryVideo, which uses expo-video's useVideoPlayer at story-viewer.tsx:143). So the UI is wired. The failure is in storage configuration.

supabase/app_feature_expansion.sql:313 declares the bucket:

  ('story-media', 'story-media', true, 52428800, array['image/png','image/jpeg','image/webp','video/mp4']::text[]),

allowed_mime_types contains video/mp4 and nothing else in the video family. Meanwhile lib/uploadService.ts:126-127 maps extensions to mime types:

  if (lower.endsWith('.mov')) return 'video/quicktime';

and uploadService.ts:31 prefers asset.mimeType, which for an iOS photo-library video is typically video/quicktime. An iPhone video is .mov/quicktime by default, so Supabase Storage rejects the upload outright and app/admin.tsx:211 shows 'Upload failed'. The owner would have no way to tell that the format, not the network, was the problem.

Two more caps compound it. file_size_limit on the same line is 52428800 = 50 MB, and lib/uploadBody.ts:6-12 independently enforces the same 50 MB with 'Choose a file smaller than 50 MB.' A one-minute 1080p iPhone clip is roughly 60-90 MB and a 4K clip far more, so even an .mp4 of normal length fails. Raising only the client constant will not help while the bucket limit stands - this is the same root as C5.

Separately, a story that IS a video renders no poster frame on Home: app/(tabs)/index.tsx:275-278 shows a flat royal-blue circle with a play-circle icon instead of a thumbnail, so video stories look broken in the ring even when they upload.
**fix plan** Three parts.
1. Widen the bucket in a new supabase/migrations/ file: update storage.buckets set allowed_mime_types = array['image/png','image/jpeg','image/webp','image/heic','image/heif','video/mp4','video/quicktime'] and raise file_size_limit for story-media to match whatever ceiling you settle on.
2. Transcode before upload rather than raising the ceiling indefinitely. In app/admin.tsx pickMedia, pass videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium and videoMaxDuration: 60 to launchImageLibraryAsync, which makes iOS hand back a compressed export instead of the original. Raise the lib/uploadBody.ts cap to match the new bucket limit and make the error message name the real limit.
3. Give video stories a poster. Capture a thumbnail at pick time (expo-video-thumbnails) and store it alongside the story, or reuse the first frame, then render it in place of the flat fallback at app/(tabs)/index.tsx:275-278.
**risk** DO-NOT-BREAK item 16 pins the story viewer's playback contract - 7s per picture, video to the end, hold to pause, the top bar as playback timer, hours left in the header. app/story-viewer.tsx:59-70 skips the image timer when isVideo, and isVideo is decided purely by file extension at story-viewer.tsx:165-168 and again at index.tsx:311-314. If you change the objectPath naming or strip extensions, both detectors silently fall back to the image path and a video will be closed after 7 seconds. Item 22 warns that expo-image and react-native-webview are native modules needing a new EAS build; adding expo-video-thumbnails is another native module and carries the same constraint - it cannot ship as an OTA update. Widening bucket mime types touches storage policy surface shared with app-assets (app_feature_expansion.sql:321-327); scope the update statement to story-media only.

## S10 — The story ring badge is clipped because expo-linear-gradient force-enables masksToBounds on its layer
**severity** high · **confidence** confirmed-in-code
**files** app/(tabs)/index.tsx:439, app/(tabs)/index.tsx:273, app/(tabs)/index.tsx:283, app/(tabs)/index.tsx:434, node_modules/expo-linear-gradient/ios/LinearGradientLayer.swift:20
**root cause** The badge is a child of the gradient ring and is deliberately placed outside it.

app/(tabs)/index.tsx:273 opens the ring as a LinearGradient with style storyRing, index.tsx:434:
  storyRing: { width: 86, height: 86, borderRadius: 43, alignItems: 'center', justifyContent: 'center' }

and the badge is a direct child at index.tsx:283 with style storyBadge, index.tsx:439:
  storyBadge: { position: 'absolute', left: -6, bottom: -3, width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: colors.white, ... }

left:-6 and bottom:-3 put 6 points of the badge to the left of the parent's bounds and 3 points below them. In plain React Native that would be fine, because overflow defaults to visible and RCTView only sets clipsToBounds when overflow is hidden. But this parent is not an RCTView. On iOS the component's backing layer is LinearGradientLayer, and node_modules/expo-linear-gradient/ios/LinearGradientLayer.swift sets masksToBounds = true in BOTH initialisers, lines 20 and 26:

  override init() {
    super.init()
    self.needsDisplayOnBoundsChange = true
    self.masksToBounds = true
  }

Setting masksToBounds on a UIView's own layer is equivalent to clipsToBounds = true and clips every sublayer, so all children of any expo LinearGradient are hard-clipped to its frame no matter what the style says. The badge loses its left 6pt and bottom 3pt. Nothing here is theme-dependent, which is exactly why the owner saw it in both themes.

There is a second, milder squeeze on the first card only: the horizontal ScrollView's contentContainerStyle storyScroll (index.tsx:432) has paddingRight: 12 but no paddingLeft, and storyCard is width 100 with the 86pt ring centred, so the first badge's left edge lands 1pt from the content origin. Even after the clip is fixed the leftmost badge will sit flush against the scroll edge.
**fix plan** Stop making the badge a child of the gradient. In app/(tabs)/index.tsx StoryCard, wrap the LinearGradient in a plain View sized to the ring plus the badge overhang - for example ringWrap: { width: 92, height: 89, alignItems: 'center', justifyContent: 'flex-start' } - move the LinearGradient inside it unchanged, and move the badge to be a sibling of the gradient inside that wrapper, keeping position absolute but offsetting from the wrapper instead (left: 0, bottom: 0). A plain RN View honours overflow: visible, so nothing clips. While there, add paddingLeft: 2 to storyScroll at index.tsx:432 so the first card's badge is not flush with the scroll edge. Apply the same wrapper treatment anywhere else a LinearGradient hosts an overflowing child.
**risk** DO-NOT-BREAK item 11 protects the approved visuals including the navy and gold treatment - the gold-to-accent gradient ring itself must look identical after the restructure, so keep the LinearGradient's colors, start and end props byte-identical and only change who its parent and siblings are. The StoriesEmpty component at index.tsx:299 reuses styles.storyRing with a width/height/borderRadius override on a plain View, not a LinearGradient; if you change the storyRing style object, re-check that empty-state card, which item 15 requires to keep showing when the backend has no live stories. Check both themes and at least one small phone after the change.

## S12 — Story delete gives no confirmation, is not optimistic, and can silently affect zero rows under RLS
**severity** high · **confidence** confirmed-in-code
**files** app/admin.tsx:525, app/admin.tsx:80, lib/adminManagementService.ts:122, supabase/app_feature_expansion.sql:192, app/(tabs)/index.tsx:74
**root cause** End to end, a story delete does this.

1. app/admin.tsx:525 (Library) or :145 (Review) calls confirmDelete(title, () => run('', () => deleteStory(s.id))). confirmDelete at admin.tsx:171-176 shows a Keep/Delete alert.
2. run() at admin.tsx:80-91 sets busy, awaits the action, awaits refresh(), and then:

     if (done) Alert.alert(done);

   done is the empty string passed at line 525, so no success alert ever fires. The user gets no acknowledgement at all.
3. deleteStory at lib/adminManagementService.ts:122-125 is a plain hard delete:

     const { error } = await supabase.from('app_stories').delete().eq('id', id);

   No optimistic state update anywhere. The card stays rendered until step 4 finishes.
4. refresh() re-runs getAdminWorkbench(), which is seven parallel Supabase queries (lib/adminManagementService.ts:24-34) covering user_roles, profiles, prayer_requests, chat_messages, chat_channels, app_stories and media_items. The deleted row disappears only when all seven resolve. That is the 'did nothing for a long time'.
5. Home is a separate, still-mounted screen whose only fetch is the mount-only useEffect at app/(tabs)/index.tsx:74-77 (see S1), so the deleted story remains in the ring until the app is fully restarted. That is 'the story stayed on Home after a refresh'.

There is also a silent-failure path. The governing policy is supabase/app_feature_expansion.sql:192-194:

  create policy "leaders manage stories" on public.app_stories
  for all using (public.is_staff_or_above()) with check (public.is_staff_or_above());

A DELETE that RLS filters down to zero rows returns success with no error, so deleteStory resolves cleanly and the story is still there. For a media_admin - who passes the client gate at lib/accessControl.ts:50 but fails is_staff_or_above (supabase/rls_policies.sql:28-31) - the Delete button appears to work and does nothing, forever.
**fix plan** In app/admin.tsx, make the Library and Review delete calls optimistic: hold the workbench in state (it already is, admin.tsx:68), drop the story from workbench.stories immediately on confirm, then run the network delete, and restore the row if it throws. Pass a real success string instead of '' at admin.tsx:525 and :145 so run()'s Alert at admin.tsx:85 fires - or better, replace the alert with an inline toast since the row is already gone.
Make deleteStory prove it did something: in lib/adminManagementService.ts:122, chain .select('id') onto the delete and throw a clear 'You do not have permission to delete this story' when the returned array is empty, so the RLS-filtered no-op stops looking like success.
Split refresh() so a delete refetches only the stories query rather than all seven in getAdminWorkbench.
The Home half is fixed by S1 - once Home has a focus listener and a realtime subscription on app_stories, a delete propagates without a restart.
**risk** DO-NOT-BREAK item 19 states that staff can delete stories and admins can approve held messages - the new permission error must not start refusing legitimate staff deletes, so test with a staff account as well as an admin one. Item 21 requires the Admin screen to stay five simple rows; add the toast inside the existing Shell rather than introducing new chrome. Note that lib/adminManagementService.ts:120-121 carries a comment claiming the database allows deletes for 'staff and for the person who created the story' - that is false (see NEW-2) and must not be used as the basis for the error message wording.

## S4 — Tap-to-advance and tap-back are absent, and the viewer is architecturally incapable of them - it receives one story, not a list
**severity** high · **confidence** confirmed-in-code
**files** app/story-viewer.tsx:101, app/story-viewer.tsx:68, app/(tabs)/index.tsx:257
**root cause** The only gesture handler on the media area is app/story-viewer.tsx:101:

  <Pressable style={styles.mediaFrame} onPressIn={() => setHeld(true)} onPressOut={() => setHeld(false)} accessibilityLabel="Story media, hold to pause">

There is no onPress, no left/right tap zones, no swipe handler and no next/previous function anywhere in the file. Hold-to-pause is the entire gesture vocabulary. When the 7-second image timer completes, app/story-viewer.tsx:68 calls close(), which pops the route:

  animation.start(({ finished }) => { if (finished) close(); });

so the viewer exits to Home after one story instead of advancing.

The deeper reason it cannot simply be patched with an onPress: the viewer has no story list to advance through. app/(tabs)/index.tsx:257-270 pushes one story's scalar fields as route params - id, title, category, body, imageUrl, actionUrl, accent, publishedAt, expiresAt - and app/story-viewer.tsx:19-28 reads exactly those. There is no array, no index, and no shared store. Nothing in the viewer knows another story exists.
**fix plan** Give the viewer a playlist. Simplest path that keeps expo-router params: in app/(tabs)/index.tsx StoryCard's router.push, additionally pass index (the story's position in displayStories) and stories (JSON.stringify of a trimmed array of id/title/category/body/imageUrl/actionUrl/accent/publishedAt/expiresAt). In app/story-viewer.tsx, parse that array once into state, hold a current index, and derive every existing field from stories[index] instead of from params directly. Then add next()/prev() that clamp at the ends - next() past the last story calls the existing close(). Replace the timer completion at story-viewer.tsx:68 with next() instead of close(). Wrap the media frame in two absolutely-positioned Pressables, left third and right two-thirds, each with the existing onPressIn/onPressOut hold-to-pause plus an onPress calling prev()/next(); reset the playback Animated.Value to 0 on each index change so the top bar restarts. If the params payload gets unwieldy, promote the story list to a small React context set by Home instead of serialising through the URL.
**risk** DO-NOT-BREAK item 16 is the exact contract at stake: 7s per picture, video to the end, hold to pause, the top bar as the playback timer, hours left in the header. The hold-to-pause handlers currently live on the same Pressable you are splitting - if onPressIn/onPressOut are not carried onto BOTH new tap zones, hold-to-pause dies. The playback Animated.Value at story-viewer.tsx:51 is a ref and must be reset (setValue(0)) on index change or the second story will show a full progress bar. The StoryVideo child at story-viewer.tsx:142 is keyed by nothing; it needs a key on the story id so expo-video tears down and rebuilds the player between stories, otherwise the previous video keeps playing. Item 8 (stories open in app/story-viewer.tsx) stays satisfied.

## S5 — The story photo picker cannot multi-select - allowsMultipleSelection is absent and only assets[0] is read
**severity** high · **confidence** confirmed-in-code
**files** app/admin.tsx:203, app/admin.tsx:199, lib/contentService.ts:303
**root cause** app/admin.tsx:203:

  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 0.86 });

allowsMultipleSelection is not passed, and expo-image-picker defaults it to false, so the OS sheet is single-select. Even if it were passed, line 204 discards everything past the first item:

  const asset = result.canceled ? null : result.assets[0];

The data model below it is single-valued the whole way down: StoryForm's state is const [media, setMedia] = useState<{ url: string; isVideo: boolean } | null>(null) at admin.tsx:199, createAdminStory takes a single imageUrl (lib/contentService.ts:292-299) and writes a single image_url column (contentService.ts:310), and the app_stories table at supabase/app_feature_expansion.sql:55 has one image_url text column. So this is not a missing flag - it is a one-photo-per-story schema.
**fix plan** Decide the shape first, because the schema has to move. Recommended: keep one row per story and add a media array. Migration: alter table public.app_stories add column if not exists media jsonb default '[]'::jsonb, and keep image_url populated with media[0] for backward compatibility with existing rows and with lib/adminManagementService.ts. Then in app/admin.tsx pickMedia, pass allowsMultipleSelection: true and selectionLimit (5 is a sane cap), loop result.assets through uploadPickedAsset, and hold an array in StoryForm state; render the picked items as a small horizontal strip in the dropzone with a remove control. In lib/contentService.ts createAdminStory, accept media: {url, isVideo}[] and write both media and image_url. In app/(tabs)/index.tsx, keep the ring showing media[0]. In app/story-viewer.tsx, treat a multi-media story as multiple segments - which is the same segment machinery S4 needs, so do S4 first and this becomes a small extension of it.
**risk** lib/contentService.ts getAppStories (:63) and lib/adminManagementService.ts getAdminWorkbench (:32) both select explicit column lists; adding a column is safe but forgetting to add media to the select at contentService.ts:63 will make the feature silently do nothing. DO-NOT-BREAK item 16's 7s-per-picture timing must now apply per segment, not per story, or a five-photo story will flash by. Item 8 (24h expiry) and item 15 (server-side expires_at filtering) are unaffected. Multi-select multiplies the S3 upload problem by the number of photos, so land S3's streaming upload before shipping this or a five-photo story will take five times the current wait.

## S7 — Members cannot post a story - blocked by the client role gate AND by two separate RLS policies
**severity** high · **confidence** confirmed-in-code
**files** lib/accessControl.ts:50, app/(tabs)/index.tsx:189, app/admin.tsx:102, supabase/app_feature_expansion.sql:192, supabase/app_feature_expansion.sql:327, supabase/rls_policies.sql:28
**root cause** Three gates, all of which say no to a member.

Client capability, lib/accessControl.ts:50:
  const canManageContent = isSuperAdmin || roles.includes('staff') || roles.includes('media_admin');
A member's roles array is ['member'] (accessControl.ts:34-43, :46), so canManageContent is false.

Entry point, app/(tabs)/index.tsx:189 - the only route to story creation from Home:
  {access.canManageContent ? <Pressable ... onPress={() => router.push('/admin')}><Text ...>Manage</Text></Pressable> : null}
A member sees no control at all. The Admin screen itself also refuses at app/admin.tsx:102-108 with 'Admins only'.

Server, supabase/app_feature_expansion.sql:192-194:
  create policy "leaders manage stories" on public.app_stories
  for all using (public.is_staff_or_above()) with check (public.is_staff_or_above());

and the storage side, supabase/app_feature_expansion.sql:325-327:
  create policy "staff uploads app and story assets" on storage.objects
  for insert with check (bucket_id in ('app-assets','story-media') and public.is_staff_or_above());

is_staff_or_above is defined at supabase/rls_policies.sql:28-31 as staff, leader, admin, super_admin. So even if the UI were opened up, a member could neither upload the photo nor insert the row.
**fix plan** This is a product change, not just a gate flip, and it needs S8 landed alongside it - once members can post, unmoderated content reaches everyone.
Database, in a new supabase/migrations/ file: add a members-insert policy on public.app_stories scoped to own rows, e.g. create policy "members post own stories" on public.app_stories for insert with check (auth.uid() = created_by and status = 'published' and visibility_role = 'member'), plus a matching delete/update policy on created_by = auth.uid() so an author can remove their own story. Add a parallel storage policy on storage.objects for insert with check (bucket_id = 'story-media' and auth.uid()::text = (storage.foldername(name))[1]) - note this requires changing the pathPrefix, see below.
Client: in lib/uploadService.ts the story upload currently uses pathPrefix: 'stories' (app/admin.tsx:208), which flattens every author into one folder and makes an owner-scoped storage policy impossible. Change it to the user id (uploadService.ts:33 already falls back to userId when pathPrefix is omitted) and keep story-media/<user>/<ts>-<name>.
Add a distinct member-facing composer rather than opening /admin - see H4.
**risk** DO-NOT-BREAK item 2 role-gates Evangelism and Admin to leader/staff/admin/outreach, and item 3 forbids unauthenticated access beyond onboarding/sign-in/create-account - neither may loosen. Do not widen is_staff_or_above itself; it guards evangelism, media and moderation surfaces far beyond stories. Item 21 requires Admin to stay five simple rows, so the member composer must not be bolted into app/admin.tsx. Item 14 forbids social-media-clone mechanics, so a member story composer must not acquire likes, follower counts or feeds. Changing pathPrefix changes objectPath for new uploads only; existing objects under stories/ stay reachable via the public read policy at app_feature_expansion.sql:321-323, so nothing breaks retroactively.

## H4 — Home has no plus button to post a story - the only entry point is an admin-only Manage link
**severity** high · **confidence** confirmed-in-code
**files** app/(tabs)/index.tsx:187, app/(tabs)/index.tsx:189, app/(tabs)/index.tsx:194
**root cause** The whole stories section of Home is app/(tabs)/index.tsx:187-197. The section header at :187-190 contains exactly two children: the title Text, and a single conditional Pressable at :189 reading 'Manage' that routes to /admin and is gated on access.canManageContent. The ring itself at :194-196 maps displayStories into StoryCard components, each of which only navigates to the viewer (index.tsx:257). There is no create affordance in the ring, no leading plus tile, and no floating action button anywhere on the screen. I grepped the file for add-circle and for router.push to any composer route - the only push targets on Home are /admin, /(tabs)/profile, /prayer, /story-viewer and /event-detail.
**fix plan** Add a leading 'Your story' tile as the first item of the horizontal ring in app/(tabs)/index.tsx:194-196, before the displayStories map - a StoryCard-shaped Pressable reusing styles.storyCard and styles.storyRing with an Ionicons add or add-circle glyph and the user's avatar behind it, matching the ring geometry so the row stays visually regular. Route it to a new app/post-story.tsx composer (not /admin, which DO-NOT-BREAK item 21 wants left alone), which is a trimmed version of StoryForm from app/admin.tsx:196-247: media picker, optional title, caption, post. Have it call a new createMemberStory in lib/contentService.ts that sets created_by, visibility_role 'member' and the expires_at from S11. Gate the tile on being signed in rather than on canManageContent. Land S7's policies first or the composer will fail at the database.
**risk** DO-NOT-BREAK item 11 protects the approved Home visuals - the new tile sits inside the gold/purple ring row, so it must adopt the same 86pt ring geometry and gold accent, and it must not disturb the storiesEmpty branch at index.tsx:191-193 that item 15 requires. Item 14 forbids social-media-clone mechanics; a plus button to post your own story is fine, but do not add view counts or reaction affordances alongside it. Item 1 fixes the six-tab order, so the composer must be a pushed route, not a new tab. Note the S10 clipping fix changes the ring's view hierarchy - do both in one pass so the new tile is built on the corrected structure.

## S8 — The sensitive-content filter DO-NOT-BREAK says lives in the database does not exist anywhere in this repo - stories publish straight to everyone
**severity** high · **confidence** likely
**files** supabase/app_feature_expansion.sql:49, lib/contentService.ts:312, app/admin.tsx:94, lib/uploadAnalysis.ts:43, DO-NOT-BREAK.md:63
**root cause** DO-NOT-BREAK.md item 18 states the filter lives in the database as content_needs_review with triggers on chat_messages and app_stories, and that it must never move to the client. I grepped all of supabase/ for content_needs_review and needs_review: zero hits. The only moderation column that exists is is_flagged boolean default false on chat_messages (supabase/schema.sql:94). The app_stories CREATE TABLE at supabase/app_feature_expansion.sql:49-64 has no flag, no review status and no trigger.

With no server filter, the publish path is unconditional. lib/contentService.ts:303-315 inserts status: 'published' hard-coded at line 312, and lib/contentService.ts:64 reads back everything with status published. So a story is visible to every user the moment the insert commits.

The review queue is therefore dead code: app/admin.tsx:94 computes

  const waitingStories = (workbench?.stories || []).filter((s) => s.status !== 'published');

and since createAdminStory can only ever write 'published', that filter can never match a story created by this app. The 'Stories waiting' section at admin.tsx:138-148 will never render.

There is a vestigial hint that this was intended: lib/uploadAnalysis.ts:43 computes needsModerationReview: input.purpose === 'chat_attachment' || input.purpose === 'story' || input.purpose === 'media_file' - but I grepped app/ and lib/ and that field is written into the uploaded_files.analysis JSON blob (uploadAnalysis.ts:64) and read by nothing.

I am marking this likely rather than confirmed because the trigger could have been applied to the live project by hand without being captured in supabase/ - which is exactly what appears to have happened with expires_at (see S11).
**fix plan** First settle whether the trigger exists on the live project (ljmzujrzdhwmvvapajlr): select tgname, tgrelid::regclass from pg_trigger where not tgisinternal and tgrelid::regclass::text in ('public.app_stories','public.chat_messages'); and select to_regprocedure('public.content_needs_review(text)');
If it is absent, add it in supabase/migrations/ so it stops being invisible: a content_needs_review(text) function, a needs_review boolean and review_reason text on app_stories, and a BEFORE INSERT trigger that sets status to 'draft' and needs_review to true when the title or body trips the filter. Then tighten the read policy at supabase/app_feature_expansion.sql:181-190 so held stories are visible only to their author and to moderators, mirroring the chat rule DO-NOT-BREAK item 18 describes. The Admin review queue at app/admin.tsx:138-148 and its Publish action (setStoryStatus, lib/adminManagementService.ts:112) already work and will light up on their own once rows can reach a non-published status.
Text-only filtering does not cover the actual risk here, which is imagery. Note plainly that a photo or video story is unscreened, and decide whether member stories (S7) ship before an image-moderation step exists.
If the trigger DOES exist on the live project, the defect is narrower: export it into supabase/migrations/ so the repo stops disagreeing with reality.
**risk** DO-NOT-BREAK item 18 forbids moving the filter to the client - keep every check in Postgres. Item 19 says members can delete their own chat message, staff can delete stories, and admin has Approve for held messages; do not disturb the chat side of the trigger while adding the story side. Changing the app_stories select policy is the risky part: if the held-story predicate is wrong, either every user sees drafts or nobody sees anything and Home goes permanently empty, which breaks item 15. Test the policy with a member account, a staff account and an admin account before shipping. This gates S7 - members must not be able to post until it lands.

## NEW-1 — media_admin and moderator pass the client permission gate and are refused by RLS - the Admin story form fails for them with a generic error
**severity** high · **confidence** confirmed-in-code
**files** lib/accessControl.ts:50, lib/accessControl.ts:49, app/admin.tsx:117, supabase/app_feature_expansion.sql:193, supabase/app_feature_expansion.sql:327, supabase/rls_policies.sql:28
**root cause** The client and the database use different role sets for the same action.

lib/accessControl.ts:49-50:
  const canModerateChat = isLeader || roles.includes('moderator');
  const canManageContent = isSuperAdmin || roles.includes('staff') || roles.includes('media_admin');

The database uses is_staff_or_above(), supabase/rls_policies.sql:28-31:
  select exists(select 1 from user_roles where user_id = auth.uid() and role::text in ('staff','leader','admin','super_admin'));

media_admin is in the client set and not in the server set. moderator is in neither content set, but app/admin.tsx:102 admits anyone with canManageContent OR canModerateChat, and once inside, the 'Post something' row at admin.tsx:117 is rendered unconditionally for every admitted user - there is no per-row capability check. So a media_admin or a moderator can open Admin, open 'Post something', choose Story, and fill in the form.

They are then refused twice. The storage insert policy at supabase/app_feature_expansion.sql:325-327 requires is_staff_or_above(), so the photo upload fails first at app/admin.tsx:208 and surfaces as 'Upload failed - Try another photo or video.' If they somehow got past that, the app_stories insert policy at :192-194 requires the same and fails as 'Not posted - Check your permissions and try again.' (admin.tsx:226). Neither message names the real cause.

The mismatch runs the other way too: a leader passes is_staff_or_above on the server but is NOT in canManageContent (leader is folded into isLeader at accessControl.ts:48, which canManageContent does not consult), so a leader is admitted to Admin via canModerateChat and sees the Manage link on Home hidden at app/(tabs)/index.tsx:189.
**fix plan** Pick one source of truth and make both ends match it. Recommended: treat is_staff_or_above as canonical since it guards evangelism and media too. In lib/accessControl.ts:50, change canManageContent to isSuperAdmin || roles.includes('staff') || roles.includes('leader'), and introduce a separate canManageMedia that includes media_admin for the media paths only (lib/rls_policies.sql:50 already defines is_media_manager() server-side including media_admin, so a media-specific policy already exists to align with). Then gate the Admin rows individually in app/admin.tsx:116-120 on the matching capability instead of rendering all five to anyone admitted, and gate PostPage's Story tile (admin.tsx:185) on canManageContent while leaving the Sermon/media tile on canManageMedia. Finally, make lib/errorMessages.ts friendlyError recognise PostgREST 42501 and Supabase storage 403 and return 'Your account does not have permission to post stories' so the failure names itself.
**risk** DO-NOT-BREAK item 2 requires Evangelism and Admin to stay role-gated to leader/staff/admin/outreach, and item 5 requires that leaders cannot remove admin or super_admin messages - changing accessControl.ts touches canUseEvangelism, canModerateChat, canManageChatMembers and canOverrideLeaderData, all derived in the same normalizeAccess function, so any edit there must be re-checked against the Evangelism tab and the chat moderation controls, not just Admin. Item 21 requires the Admin home to stay five rows; hiding rows per-role is fine, replacing them with a role picker is not. Verify with the QA member login (fableqa@overcomersglobalnetwork.com, per DO-NOT-BREAK line 13) that a plain member still sees nothing.

## NEW-3 — Onboarding: the crest is cropped by resizeMode cover on a square asset forced into a 224x124 box
**severity** high · **confidence** confirmed-in-code
**files** app/index.tsx:188, app/index.tsx:411, app/index.tsx:399, app/index.tsx:234
**root cause** This is the screen the owner described - the splash at app/index.tsx:181-223, the one carrying the Dark/Light picker (ThemeSelector, rendered compact at app/index.tsx:203).

app/index.tsx:187-189:
  <View style={styles.sealWrap}>
    <Image source={require('../assets/images/ogn-logo-transparent.png')} resizeMode="cover" style={styles.sealImage} />
  </View>

with app/index.tsx:411:
  sealImage: { width: 224, height: 124 },

I measured the asset: assets/images/ogn-logo-transparent.png is 614 x 614, perfectly square. resizeMode="cover" scales the shorter axis to fill, so 614 becomes 224 wide (scale 0.3648), giving a 224 x 224 rendering, which is then centre-cropped to 124 tall. In source pixels that keeps only y = 137 to 477 of 614 and discards everything from y = 477 down.

Looking at the artwork, the crest occupies roughly y = 210 to 520. The discarded band from 477 is the bottom of the seal ring, the base of the two eagles, the open book, and the 'EDUCATE. EQUIP. EVOLVE.' banner that runs across the bottom of the crest at about y = 490. That is the cut-off the owner is reporting: the ministry lettering on the lower banner and the base of the logo are sliced away.

The same asset is rendered correctly elsewhere in the same file - app/index.tsx:234 uses resizeMode="contain" for the auth header - which shows the intent and makes this a straightforward inconsistency. Note sealWrap (app/index.tsx:399-410) also carries overflow: 'hidden', so nothing can spill out and reveal the problem.
**fix plan** In app/index.tsx:188 change resizeMode="cover" to resizeMode="contain", matching line 234. Then fix the box so contain does not letterbox into a stripe: the asset is square, so make sealImage square too at app/index.tsx:411 - width: 124, height: 124 - and let sealWrap centre it, or widen sealWrap's aspect to suit. Because sealWrap is width 236 / height 150 with a visible rounded gold-bordered plate (app/index.tsx:399-410), a 124-square crest sits centred inside it cleanly; if the plate then looks too wide, reduce sealWrap to roughly 170 x 150. Check both themes, since the plate background is rgba(255,255,255,0.08) and reads differently on the light gradient at app/index.tsx:183.
**risk** DO-NOT-BREAK item 11 protects the crest/seal as an approved visual, so the goal is to show MORE of the official artwork, not to restyle it - do not swap the asset, recolour the plate, or crop deliberately. DO-NOT-BREAK's recorded baseline (line 10-11) says Expo web on port 8090 renders this exact onboarding screen with crest, 'Live Teaching. Global Impact.' and the Dark/Light picker; that is the screen to re-verify after the change. Item 10 requires both themes to work on every screen.

## S9 — Story title is mandatory - post() returns early on an empty title, and the column is NOT NULL
**severity** medium · **confidence** confirmed-in-code
**files** app/admin.tsx:219, app/admin.tsx:242, lib/contentService.ts:306, supabase/app_feature_expansion.sql:51
**root cause** Client validation, app/admin.tsx:217-219:

  async function post() {
    if (!media) return Alert.alert('Pick a photo or video first');
    if (!title.trim()) return Alert.alert('Give the story a short title');

The second guard aborts the post outright. The field is also labelled as required-by-omission at admin.tsx:242 - placeholder 'Title (short)' with no '(optional)' - while the very next field at :243 is explicitly 'Caption (optional)', so the contrast tells the user the title is compulsory.

The database agrees: supabase/app_feature_expansion.sql:51 declares

  title text not null,

so removing the client guard alone would turn a blank title into a 23502 not-null-violation surfaced as 'Not posted' via app/admin.tsx:226. Both layers have to change.
**fix plan** Database first, in a new supabase/migrations/ file: alter table public.app_stories alter column title drop not null. Then in app/admin.tsx delete the guard at :219 and relabel the field at :242 to 'Title (optional)'. In lib/contentService.ts createAdminStory, change the title parameter to optional and write input.title?.trim() || null. Then handle the empty case in every reader: app/(tabs)/index.tsx:98 maps story.title straight through and :287 renders it under the ring - fall back to the category, the region, or the author's display name rather than printing nothing; app/story-viewer.tsx:90 and :117 already have an 'OGN Story' fallback via params.title ||, which will now actually be exercised; lib/adminManagementService.ts:66 and app/admin.tsx:141/:523 render s.title in the Admin lists and need a placeholder so rows are not blank and untappable.
**risk** A blank title propagates into confirmDelete's alert text at app/admin.tsx:172 ('"" will be removed for everyone') and into the Admin Library rows at :523, so those need the fallback or the admin loses the ability to tell stories apart before deleting one - which directly feeds the S12 complaint. app/(tabs)/index.tsx:195 keys the ring by story.id, not title, so no key collisions. DO-NOT-BREAK item 8 and item 16 are unaffected. Dropping a NOT NULL is not reversible without first cleaning up nulls, so decide the placeholder policy before running the migration.

## S2 — Success feedback is a stock OS alert with copy that undersells it - no animation, no confirmation the story is live now
**severity** medium · **confidence** confirmed-in-code
**files** app/admin.tsx:223, app/admin.tsx:185, app/(tabs)/index.tsx:304, app/story-viewer.tsx:118
**root cause** The exact success copy is app/admin.tsx:223, inside StoryForm.post:

  Alert.alert('Story posted', 'It is live on Home for 24 hours.');

It is React Native's Alert - a native OS modal with a single OK button. There is no animation, no branding, no navigation to the posted story, and nothing premium about it; it is the same component used for every error in the file (admin.tsx:211, :218, :219, :226).

The owner recalled it as 'you should see your story in 24 hours' rather than 'live for 24 hours'. I grepped every 24-hour string in the app: app/admin.tsx:185 'Photo or video, gone in 24h', app/(tabs)/index.tsx:304 'Stories last 24 hours. Leaders post them from Admin, and new ones appear here.', app/story-viewer.tsx:118 'This story update is live for 24 hours.' and this alert. The alert at :223 is the only one that fires on a successful post, so that is the string he saw - the recollection is a paraphrase, not a different build. Either way it reads as a delay rather than a confirmation, which is compounded by S1 and S11: the story genuinely did not appear, so the copy and the behaviour reinforced each other.
**fix plan** Replace the Alert at app/admin.tsx:223 with an in-app success state. Build a small StorySuccess overlay component: the story's own thumbnail scaling up behind a gold check mark, animated with Animated.sequence over roughly 600ms using the same Animated/Easing imports already used in app/story-viewer.tsx:6 and :62-67, headline 'Your story is live', sub 'Everyone on Home can see it now. It disappears in 24 hours.', and a primary action 'View it' that routes to /story-viewer with the just-posted story plus a secondary 'Done'. Keep it purely JS-driven (useNativeDriver: true for opacity/transform) so no new native module is required. Fire it after createAdminStory resolves and before onDone(). This is only honest once S1 and S11 are fixed - do not ship 'live now' copy while Home still cannot show the story.
**risk** DO-NOT-BREAK item 11 governs the approved visual language (crest, navy and gold), so the celebration must use those tokens from lib/theme rather than inventing a palette. Item 22 warns that native modules force a new EAS build rather than an OTA update - reaching for lottie or a confetti library would trip that, whereas Animated is already in the bundle. Item 21 wants Admin kept simple; the overlay should present and dismiss within the existing Shell, not become a sixth row. Do not remove the error Alerts at admin.tsx:211 and :226 in the same pass - they are the only failure feedback the form has.

## NEW-4 — Onboarding splash has no ScrollView and is wrapped in a LinearGradient, so overflow is hard-clipped on short phones
**severity** medium · **confidence** needs-device-check
**files** app/index.tsx:183, app/index.tsx:185, app/index.tsx:398, app/index.tsx:206
**root cause** The splash is a fixed, non-scrolling column. app/index.tsx:183 wraps everything in a LinearGradient with style splashContainer (flex: 1, app/index.tsx:397), and app/index.tsx:185 puts the content in an Animated.View with splashInner (flex: 1, alignItems center, paddingHorizontal 32 - app/index.tsx:398) plus paddingTop: insets.top + 40 and paddingBottom: insets.bottom + 24. There is no ScrollView anywhere in the splash branch.

The column holds, in order: the 150pt seal plate, the two-line wordmark at fontSize 30 / lineHeight 34 plus a motto, a divider, two multi-line taglines, the compact ThemeSelector, a flex: 1 spacer at app/index.tsx:206, the dots row, and the Get Started button. React Native defaults flexShrink to 0, so when the fixed content exceeds the available height the spacer collapses to zero and the remaining children simply overflow the bottom of the container.

They are then clipped rather than merely hidden, and for the same reason as S10: the container is an expo LinearGradient, whose iOS backing layer sets masksToBounds = true unconditionally at node_modules/expo-linear-gradient/ios/LinearGradientLayer.swift:20 and :26. So on a short device the Get Started button is cut off at the screen edge with no way to scroll to it.

I am marking this needs-device-check because whether it actually overflows depends on the device height and the user's Dynamic Type setting, and I did not run the app. NEW-3 is the confirmed cause of the crest cropping; this is a second, independent hazard on the same screen that the owner's phrase 'nothing may be clipped on any phone size' asks us to close.
**fix plan** Make the splash scroll when it must. In app/index.tsx:185, replace the Animated.View with an Animated.ScrollView (or wrap the Animated.View in a ScrollView) using contentContainerStyle={[styles.splashInner, { flexGrow: 1, paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]} and showsVerticalScrollIndicator={false}. flexGrow: 1 keeps the flex: 1 spacer at app/index.tsx:206 working on tall phones so the layout is unchanged there, while allowing scroll on short ones. Give the two-line wordmark at app/index.tsx:192 adjustsFontSizeToFit with minimumFontScale={0.8} so 'GLOBAL NETWORK' at fontSize 30 cannot wrap to a third line on a 320pt-wide device.
To settle the device question: run the app on the smallest target (iPhone SE, 375x667, and ideally at the largest accessibility text size) and confirm the Get Started button at app/index.tsx:216 is fully visible and tappable; if it is reachable today, this is preventative rather than a live defect.
**risk** DO-NOT-BREAK's recorded baseline (line 10-11) is this exact screen rendering the crest, 'Live Teaching. Global Impact.' and the Dark/Light picker - it must look identical on a normal-height phone after the change, which is what flexGrow: 1 preserves. Item 10 requires both themes to work; the LinearGradient's two colour sets at app/index.tsx:183 must both still fill the full screen behind the scroll content, so keep the gradient as the outer container and put the ScrollView inside it. The fadeAnim opacity at app/index.tsx:185 must stay on the animated element, so if you nest, keep the Animated wrapper rather than dropping it.

## NEW-5 — Deleting a story leaves its photo or video permanently public in the story-media bucket
**severity** medium · **confidence** confirmed-in-code
**files** lib/adminManagementService.ts:122, supabase/app_feature_expansion.sql:313, supabase/app_feature_expansion.sql:321, lib/uploadService.ts:108, lib/uploadAnalysis.ts:49
**root cause** deleteStory at lib/adminManagementService.ts:122-125 removes only the app_stories row. Nothing removes the storage object, and nothing removes the uploaded_files bookkeeping row written by recordUploadedFile (lib/uploadAnalysis.ts:49-69).

The object stays world-readable. supabase/app_feature_expansion.sql:313 creates story-media with public = true, and the select policy at :321-323 is unconditional:

  create policy "public reads app and story assets" on storage.objects
  for select using (bucket_id in ('app-assets','story-media'));

no owner check, no expiry. lib/uploadService.ts:107-112 puts story-media in the publicBuckets set and hands back a getPublicUrl, so the URL is a permanent unsigned link.

The consequence is that the confirmation the admin is shown - 'will be removed for everyone' at app/admin.tsx:172 - is not true of the media. Anyone who saw the story, or who is handed the URL, keeps access forever. The same applies to the 24-hour expiry: DO-NOT-BREAK item 8 promises stories expire after 24 hours, but only the row is filtered (lib/contentService.ts:65) while the asset stays up indefinitely. Once members can post stories (S7) and while there is no content filter (S8), this is the path by which harmful material stays reachable after it has been taken down.
**fix plan** Make delete clean up its media. Extend lib/adminManagementService.ts deleteStory to read the row's image_url before deleting, derive the object path (it is the segment after /story-media/ in the public URL, matching the objectPath built at lib/uploadService.ts:33), then call supabase.storage.from('story-media').remove([objectPath]) and delete the matching uploaded_files row by bucket_id and object_path. Better still, store bucket_id and object_path on app_stories at insert time in lib/contentService.ts createAdminStory so no URL parsing is needed. For expiry, add a scheduled job (pg_cron or a Supabase Edge Function alongside the existing supabase/functions/send-push-notification) that purges storage objects for stories whose expires_at has passed. If you want takedowns to be immediate and total, reconsider whether story-media should be public at all - signed URLs would let revocation actually revoke, at the cost of adding a signing round trip to Home's ring render.
**risk** DO-NOT-BREAK item 20 forbids ever making the chat-attachments bucket public; this is the inverse question for story-media, and switching story-media to private would change lib/uploadService.ts:108 which is shared by app-assets and profile-avatars - do not flip those by accident. Item 11 pins approved visual assets that live in app-assets, so the purge job must be scoped to story-media only or it could delete crest and globe artwork. Deleting storage objects is irreversible: run the purge against a single test story first, and make the delete tolerant of a missing object so an already-cleaned story can still have its row removed.

## NEW-6 — A story whose image fails to load silently shows an unrelated stock Zambia photo under the real story's title
**severity** medium · **confidence** confirmed-in-code
**files** app/(tabs)/index.tsx:280, app/(tabs)/index.tsx:249, app/(tabs)/index.tsx:53
**root cause** app/(tabs)/index.tsx:280:

  <Image source={imageFailed ? fallbackStories[0].image : story.image} resizeMode="cover" style={styles.storyImage} onError={() => setImageFailed(true)} />

When a remote story's image 404s, times out, or is blocked, imageFailed flips (index.tsx:249) and the ring renders fallbackStories[0].image - which is a fixed demo asset, ref/story_zambia_clean.jpg (index.tsx:53). The surrounding text is untouched: index.tsx:287-289 still render the real story's title, category and countdown. So a story titled, say, 'OGN Ohio Outreach' appears in the ring illustrated with a stock photograph of Zambia, presented as if it were that story's own picture.

This is not hypothetical given the rest of this audit: if S11 is right and expires_at is null, or if an upload half-succeeded, or if the story-media object was purged, the URL breaks and this is what the user sees. It is also the sort of thing that reads as a content error rather than a technical one - a ministry attributing the wrong country's photograph to the wrong story.
**fix plan** In app/(tabs)/index.tsx StoryCard, replace the fallbackStories[0].image fallback at line 280 with a neutral placeholder that cannot be mistaken for content: reuse the pattern already present two lines above at index.tsx:275-278, a plain View with styles.storyImage plus a muted background and an Ionicons image-outline or planet-outline glyph in colors.gold. app/story-viewer.tsx:106-110 already does exactly this with its 'Story media unavailable' gradient, so the app has the right precedent - match it. Keep fallbackStories themselves for the no-backend demo path at index.tsx:110; only the per-image error fallback should change.
**risk** DO-NOT-BREAK item 15 requires that Home never show demo stories when the backend is configured and shows the empty ring instead - this change tightens that guarantee rather than loosening it, but do not touch the storiesEmpty logic at index.tsx:92 or the displayStories ternary at :93-110 while doing it, since those are the parts item 15 actually pins. Item 11 protects the approved visual language, so the placeholder should use colors.gold and the existing ring geometry. Note the S10 fix restructures this same component - do both together.

## NEW-2 — deleteStory carries a comment describing a permission rule the database does not implement
**severity** low · **confidence** confirmed-in-code
**files** lib/adminManagementService.ts:120, supabase/app_feature_expansion.sql:192
**root cause** lib/adminManagementService.ts:120-125:

  // Removes the story for good. The database only allows this for staff and
  // for the person who created the story.
  export async function deleteStory(id: string) {

The second clause is false. The only policy on app_stories is supabase/app_feature_expansion.sql:192-194, for all using (public.is_staff_or_above()) with check (public.is_staff_or_above()). There is no created_by = auth.uid() clause anywhere in the file. A non-staff author cannot delete their own story - the DELETE matches zero rows and returns success with no error.

This matters beyond tidiness: it is exactly the assumption S7's member-posting work would be built on. Anyone reading this comment would conclude authors can already clean up after themselves and skip writing the owner policy, leaving members able to post stories they can never remove.
**fix plan** Correct the comment in lib/adminManagementService.ts:120-121 to say the database allows this for staff and above only. If and when S7 lands and an author-delete policy is added to app_stories, update the comment in the same commit rather than ahead of it.
**risk** None to runtime behaviour - comment only. The risk is in leaving it: it will mislead the S7 and S12 work.
