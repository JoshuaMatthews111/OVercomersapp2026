-- Overcomers Global Network MVP Schema
-- Run in Supabase SQL Editor or via migrations.

create extension if not exists "uuid-ossp";
create extension if not exists postgis;

create type app_role as enum ('visitor','member','outreach','staff','leader','admin');
create type message_status as enum ('draft','published','archived');
create type prayer_status as enum ('new','praying','follow_up','answered','closed');
create type territory_level as enum ('global','country','region','city','neighborhood','street');
create type territory_status as enum ('untapped','in_progress','covered','follow_up_due','new_believer','discipled');
create type outreach_contact_status as enum ('contact_made','prayed','gospel_shared','invited','bible_study','saved','discipled','not_interested');

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  phone text,
  avatar_url text,
  country text,
  region text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table user_roles (
  user_id uuid references auth.users(id) on delete cascade,
  role app_role not null default 'member',
  primary key (user_id, role)
);

create table sermon_series (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  slug text unique not null,
  description text,
  cover_image_url text,
  speaker text,
  status message_status default 'published',
  sort_order int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table sermons (
  id uuid primary key default uuid_generate_v4(),
  series_id uuid references sermon_series(id) on delete set null,
  title text not null,
  slug text unique not null,
  speaker text,
  scripture_reference text,
  description text,
  video_url text,
  audio_url text,
  thumbnail_url text,
  notes_url text,
  duration_seconds int,
  status message_status default 'published',
  is_featured boolean default false,
  published_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table chat_channels (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  description text,
  channel_type text not null default 'general',
  region text,
  is_mandatory boolean default false,
  is_public boolean default true,
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

create table chat_members (
  channel_id uuid references chat_channels(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role app_role default 'member',
  joined_at timestamptz default now(),
  muted_until timestamptz,
  primary key(channel_id, user_id)
);

create table chat_messages (
  id uuid primary key default uuid_generate_v4(),
  channel_id uuid references chat_channels(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  body text not null check (char_length(body) <= 2000),
  parent_message_id uuid references chat_messages(id),
  is_flagged boolean default false,
  deleted_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table prayer_requests (
  id uuid primary key default uuid_generate_v4(),
  created_by uuid references auth.users(id),
  name text,
  email text,
  phone text,
  country text,
  region text,
  category text,
  request text not null,
  is_private boolean default true,
  consent_received boolean default false,
  status prayer_status default 'new',
  assigned_to uuid references auth.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table territories (
  id uuid primary key default uuid_generate_v4(),
  parent_id uuid references territories(id) on delete cascade,
  name text not null,
  level territory_level not null,
  country_code text,
  status territory_status default 'untapped',
  center geography(Point, 4326),
  boundary geography(Polygon, 4326),
  reached_count int default 0,
  follow_up_count int default 0,
  souls_saved_count int default 0,
  prayer_request_count int default 0,
  bible_studies_active int default 0,
  discipleship_progress int default 0,
  covered_streets_count int default 0,
  in_progress_streets_count int default 0,
  active_workers_count int default 0,
  streets_untapped_count int default 0,
  street_names text[] default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index territories_center_idx on territories using gist(center);
create index territories_boundary_idx on territories using gist(boundary);
create index territories_parent_idx on territories(parent_id);

create table outreach_contacts (
  id uuid primary key default uuid_generate_v4(),
  territory_id uuid references territories(id) on delete set null,
  created_by uuid references auth.users(id),
  assigned_to uuid references auth.users(id),
  full_name text,
  phone text,
  whatsapp text,
  email text,
  address text,
  location geography(Point, 4326),
  prayer_request text,
  notes text,
  gospel_shared boolean default false,
  invited_to_church boolean default false,
  bible_study_started boolean default false,
  saved_accepted_christ boolean default false,
  follow_up_needed boolean default false,
  assigned_leader_name text,
  status outreach_contact_status default 'contact_made',
  status_history jsonb default '[]'::jsonb,
  consent_received boolean default false,
  next_follow_up_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index outreach_contacts_location_idx on outreach_contacts using gist(location);
create index outreach_contacts_territory_idx on outreach_contacts(territory_id);
create index outreach_contacts_assigned_idx on outreach_contacts(assigned_to);

create table follow_up_tasks (
  id uuid primary key default uuid_generate_v4(),
  contact_id uuid references outreach_contacts(id) on delete cascade,
  assigned_to uuid references auth.users(id),
  task_type text not null default 'call',
  due_at timestamptz not null,
  status text not null default 'open',
  notes text,
  completed_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

create table events (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  description text,
  location text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  image_url text,
  registration_url text,
  created_at timestamptz default now()
);

create table giving_links (
  id uuid primary key default uuid_generate_v4(),
  label text not null,
  url text,
  instructions text,
  sort_order int default 0,
  is_active boolean default true
);

create table push_tokens (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade,
  token text unique not null,
  platform text,
  created_at timestamptz default now()
);

create table audit_logs (
  id uuid primary key default uuid_generate_v4(),
  actor_id uuid references auth.users(id),
  action text not null,
  table_name text,
  record_id uuid,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
