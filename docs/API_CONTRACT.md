# OGN API Contract

## Authentication
Use Supabase Auth. Roles are stored in `user_roles`.

## Core Tables
- `sermon_series` / `sermons`: public read, admin write.
- `chat_channels` / `chat_members` / `chat_messages`: authenticated chat with moderation.
- `prayer_requests`: public submit with consent, staff review.
- `territories`: map hierarchy from global to street level.
- `outreach_contacts`: people/households reached.
- `follow_up_tasks`: leader follow-up workflow.

## Map Drilldown Flow
1. Global overview shows countries/regions.
2. Tap country → show country regions/cities.
3. Tap city → show neighborhoods.
4. Tap neighborhood → show real street names, colored by status.
5. Tap street → show outreach history, contacts, follow-ups, and untapped sections.
6. Locate Me → request device location → animate map to exact location → show nearest territory and add outreach record.

## Territory Status Colors
- Untapped: red dashed outline
- In Progress: amber
- Covered: green
- Follow-Up Due: purple
- New Believer: blue
- Discipled: gold

## Follow-Up Workflow
Contact Made → Prayed → Gospel Shared → Invited → Bible Study → Saved → Discipled

Leader actions:
- assign worker
- schedule call
- schedule visit
- assign prayer team
- assign Bible study
- close follow-up
- mark discipled/connected
