# App Store / Play Store Reviewer Demo Account

Both Apple and Google require a working demo account so a reviewer can sign in and see features behind auth (Community Chat, Prayer Requests, Evangelism Map).

## Live reviewer accounts

- **Reviewer email:** `appreview@overcomersglobalnetwork.com`
- **Reviewer roles:** member, leader, staff, admin, super_admin
- **Password:** keep in App Store Connect / Play Console review notes only. Do not commit the password to this repo.

Use this reviewer account when Apple or Google needs to verify signed-in member features plus role-gated admin, leader, evangelism, prayer-management, media-management, and notification-management flows.

## How to create it (one-time, in Supabase)

You have two equally good options.

### Option A — Supabase Studio (no code)
1. Open https://supabase.com/dashboard → your project → **Authentication → Users**.
2. Click **Add user → Create new user**.
3. Email: `appreview@overcomersglobalnetwork.com`. Password: paste your generated strong password. **Auto Confirm User: ON**.
4. Click **Create user**.
5. If you have a `profiles` table that needs a row per auth user (most Supabase apps do):
   - Open the **Table Editor → profiles** and insert a row using the new user's UUID with display name `App Review`.
   - Or, if you have a trigger that creates a profile on signup, confirm a row exists; insert it manually if not.

### Option B — SQL (in the Supabase SQL Editor)
Use this if you want it scripted. **Run from the SQL Editor — not from the app.**

```sql
-- Run in Supabase SQL Editor (uses service-role context)
-- Replace REPLACE_ME with the strong password you generated.

select auth.admin_create_user(jsonb_build_object(
  'email', 'appreview@overcomersglobalnetwork.com',
  'password', 'REPLACE_ME',
  'email_confirm', true,
  'user_metadata', jsonb_build_object('display_name', 'App Review')
));

-- If you have a profiles table, also insert a profile row (adjust column names):
-- insert into public.profiles (id, display_name)
-- select id, 'App Review'
-- from auth.users
-- where email = 'appreview@overcomersglobalnetwork.com'
-- on conflict (id) do nothing;
```

## What the reviewer will see

After signing in with the reviewer credentials, the reviewer should be able to:
- Browse the **Home** feed and tap into a recorded message.
- Open **Bible**, read full chapters, and switch KJV / NLT / AMP.
- Post a prayer request and see the **Prayer** feed.
- Send a message in **Community** chat.
- Tap **Give**, which opens our giving page in an external browser.
- View the role-gated **Evangelism** screen.
- Open the admin dashboard.
- See protected moderation, prayer workflow, media manager, approval queue, and notification tools.

## Where to paste these credentials

- **App Store Connect:** App version → **App Review Information → Sign-In Required (ON) → User name / Password**.
- **Google Play Console:** App content → **App access → All or some functionality is restricted → Add new instructions**.

In both, include this note for the reviewer (also in STORE_LISTING.md):

> Sign in with the demo account to access Community Chat, Prayer Requests, Bible, Media, Give, role-gated Evangelism, and Admin tools. The Give tab opens our secure web giving page in an external browser; no in-app purchases are used. Live streams may be offline outside Sunday service hours — use the Media tab to browse recorded services.

## Rotation

Rotate the password every 6 months or after any major release that changes the auth flow. Update App Store Connect and Play Console at the same time.
