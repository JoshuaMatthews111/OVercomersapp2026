# Going live: Sunday Service and Bible Study in the app

Written 2026-09-22 for Pastor Joshua and the media team.

## The short version

1. Stream from OBS to **YouTube Live**. It is free, it has no time limit, and
   it plays inside the app.
2. Make the stream **Public** and leave **Allow embedding** on.
3. Within a minute or two of YouTube going live, a red **LIVE** card appears at
   the top of Home for everyone, with a **Watch now** button. Nobody has to
   press anything in the app.
4. Want Facebook at the same time? Add the free **Multiple RTMP outputs**
   plugin to OBS (steps below). Facebook opens in the Facebook app; it cannot
   play inside ours.

## One-time setup: YouTube

1. On a computer, open **YouTube Studio** (studio.youtube.com) signed in as
   the Overcomers Global Network channel.
2. Click **Create** (top right), then **Go live**.
   - The very first time, YouTube may ask to verify the channel with a phone
     number and can take up to 24 hours to switch live streaming on. Do this
     well before a Sunday.
3. Choose the **Stream** tab (not Webcam).
4. Under **Stream settings**, find **Stream key**. Choose **Default stream key
   (RTMP, variable)** and click **Copy**.
   - Treat the stream key like a password. Anyone who has it can broadcast on
     the church channel. Never paste it in chat, in an email, or into the app.

## One-time setup: OBS

1. Open OBS. Go to **Settings**, then **Stream**.
2. **Service:** YouTube - RTMPS.
3. **Server:** Primary YouTube ingest server.
4. **Stream Key:** paste the key you copied. (Newer OBS versions also offer
   **Connect Account**, which signs in to YouTube instead of using a key.
   Either works.)
5. Click **OK**.

Good starting settings (Settings, then **Output** and **Video**):

| Your upload speed | Resolution | Video bitrate |
| --- | --- | --- |
| 10 Mbps or more, YouTube only | 1080p, 30 fps | 4,500 to 6,000 Kbps |
| 5 Mbps, or streaming to YouTube and Facebook together | 720p, 30 fps | 2,500 to 3,000 Kbps each |

Test the church's upload speed before a service. Sending to YouTube and
Facebook together uses twice the upload.

## Every service

1. In YouTube Studio, open **Go live**, give the stream its title (for
   example "Sunday Service, 27 September"), and check:
   - **Visibility: Public.** An Unlisted or Private stream does not show up on
     the channel's live page, so the app will not notice it on its own. (You
     can still put it in the app by hand; see "Going live by hand" below.)
   - **Allow embedding: on.** It is in the stream's settings (click **Edit**
     on the stream, then look under Customization or More options). If it is
     off, the app can only offer "Open in YouTube".
2. In OBS, click **Start Streaming**.
3. Within a minute or two the LIVE card appears on Home in the app, and the
   Live page shows the stream.
4. When the service ends, click **Stop Streaming** in OBS. The LIVE card goes
   away by itself within a minute or two.

About long services: YouTube keeps a live stream running as long as you need.
It saves streams of up to 12 hours as a video on the channel afterwards.
Facebook stops a live video after 8 hours.

### A stream that is already waiting on the channel

On 2026-09-22 the channel had an old scheduled stream called "Prayer &
Prophecy" (scheduled for July 2025, never started) waiting on its live page.
The app correctly treats that as **not live**, and the leaders' box on the
Live page says an old scheduled stream is still waiting and should be deleted. But if OBS starts sending on
the key that stream uses, YouTube may go live under that old title. To keep
titles right, open **YouTube Studio, Content, Live**, and delete any old
upcoming streams you do not plan to use.

## Streaming to Facebook at the same time (free)

OBS sends to one place on its own. The free plugin **Multiple RTMP outputs**
(its project name is obs-multi-rtmp) adds more places.

1. Close OBS. Download the plugin installer for your computer from the
   plugin's official page on the OBS forums or on GitHub (search for
   "obs-multi-rtmp"). Install it and open OBS again.
2. A panel called **Multiple output** appears (if not: **Docks** menu, then
   **Multiple output**).
3. Click **Add new target**. Name it "Facebook".
4. Get the Facebook details: go to **facebook.com/live/producer** as the
   church page, choose **Streaming software**, and turn on **Use a persistent
   stream key** so the same key works every week. Copy the **Server URL** and
   the **Stream key**.
5. Paste them into the new target and save.
6. Each service: click **Start Streaming** for YouTube as usual, then click
   **Start** next to Facebook in the Multiple output panel.

The app notices YouTube by itself. For Facebook, a leader puts it in the app
by hand (next section).

## Going live by hand in the app

Leaders and the media team (leader, staff, admin, super admin, media admin)
see two extra things:

- On **Home**, when nothing is live, a slim row: **Not live right now, Go
  live**.
- On the **Live** page, a box called **For leaders: going live**. It says
  what the app last saw on YouTube and how long ago it checked.

Use **Go live** when:

- you are live on **Facebook** only,
- you want to show a **different YouTube link** (for example an Unlisted
  stream), or
- YouTube is live but the app has not noticed yet.

Tapping the "We're live" notification opens the app; on a phone where the
app was closed that is Home, with the LIVE card on top. (If the app was
already open on another screen, it stays there for now.)

Steps: paste the share link from YouTube or Facebook, add a title if you like,
and tick **Notify everyone** if you want every phone to get a notification
that says "We're live". Members who turned off Announcements in their
notification settings are not sent it.

A hand-started live switches itself off after 8 hours, so a forgotten one does
not say LIVE all week. **End live** takes the card down for everyone (it asks
you to confirm first). If YouTube is still showing that stream, End live hides
that one stream in the app for up to 12 hours; the next stream still shows up
by itself.

## What members see

- **When live:** the red LIVE card at the top of Home: title, how long ago it
  started (only when YouTube says so; the app never guesses), **Watch now** (YouTube plays inside the app) or **Watch on
  Facebook**, and **Live page**.
- **When not live:** nothing extra on Home. The Live page shows the coming
  Sunday Service and Bible Study times from the events the ministry has
  published, and a button to open the YouTube channel.

## Listening with the phone locked

A YouTube live stream plays inside the app while the app is open, including
while the person moves around the app with the small player bar. It stops if
the phone is locked or the person switches to another app. YouTube's rules do
not allow an app to keep playing YouTube in the background, and this app does
not try to get around that. The Live page says so plainly: "Keep the app open
to keep watching."

Sermon audio and video files in Media do keep playing with the phone locked,
because the app plays those files itself.

Lock-screen listening for live services needs a decision from you, because
every way of doing it moves the live sound somewhere other than YouTube. That
choice has been put to you separately.

## How it works (for whoever looks after the app)

- The edge function `live-status` reads the channel's public live page
  (youtube.com/channel/UCkhxsNcdEF0lXMIEqJooiNg/live). No YouTube API key and
  no bill.
- It saves what it found in the one-row table `public.live_status`, so no
  matter how many phones ask, YouTube is checked at most about once a minute.
- A leader's Go live / End live is saved in `live_status.manual_override`.
  Only leaders and the media team can write it; the database checks the link
  and sets when it switches itself off.
- The SQL is in `supabase/2026-09-22-live-status.sql`; the rules and their
  tests are in `supabase/functions/live-status/logic.ts` and
  `qa/live-status.test.mjs`.
