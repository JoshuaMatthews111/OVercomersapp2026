-- OGN MVP seed data. Run after schema.sql and rls_policies.sql.

insert into sermon_series (title, slug, description, speaker, sort_order)
values
  ('Kingdom Authority', 'kingdom-authority', 'Living under the authority of Christ', 'Overcomers Global Network', 1),
  ('The Power of Prayer', 'power-of-prayer', 'Building a life of intercession', 'OGN Prayer Team', 2)
on conflict (slug) do nothing;

insert into sermons (series_id, title, slug, speaker, scripture_reference, description, video_url, audio_url, duration_seconds, is_featured)
select id, 'Authority Under Assignment', 'authority-under-assignment', 'Overcomers Global Network', 'Luke 10:19',
  'A teaching on walking in Christ-given authority with humility and obedience.', 'https://example.com/live', 'https://example.com/audio/authority-1.mp3', 2720, true
from sermon_series where slug = 'kingdom-authority'
on conflict (slug) do nothing;

insert into chat_channels (name, description, channel_type, region, is_mandatory, is_public)
values
  ('Global Prayer Room', 'Worldwide prayer and encouragement.', 'prayer', 'Worldwide', true, true),
  ('Announcements', 'Official OGN updates.', 'announcement', 'Worldwide', true, true),
  ('North America Prayer Room', 'Regional prayer room.', 'regional', 'North America', false, true)
on conflict do nothing;

insert into giving_links (label, instructions, url, sort_order)
values
  ('Cash App', '$OvercomersGN', null, 1),
  ('Zelle', 'support@overcomersglobalnetwork.com', null, 2),
  ('Online Giving', 'Secure giving page placeholder', 'https://overcomersglobalnetwork.com/give', 3)
on conflict do nothing;

insert into events (title, description, location, starts_at, registration_url)
values
  ('Global Broadcast Night', 'Live teaching, prayer, and ministry updates.', 'Online', now() + interval '1 day', 'https://overcomersglobalnetwork.com'),
  ('Street Outreach Training', 'Leader prep for territory teams and follow-up workers.', 'Hybrid', now() + interval '2 days', null)
on conflict do nothing;

with global_field as (
  insert into territories (name, level, status, center, reached_count, follow_up_count, souls_saved_count, prayer_request_count, bible_studies_active, discipleship_progress, covered_streets_count, in_progress_streets_count, streets_untapped_count)
  values ('Global Field', 'global', 'in_progress', st_geogfromtext('POINT(0 20)'), 1260000, 239110, 412987, 88200, 70240, 61, 34180, 12940, 66530)
  returning id
), usa as (
  insert into territories (parent_id, name, level, country_code, status, center, reached_count, follow_up_count, souls_saved_count, prayer_request_count, bible_studies_active, discipleship_progress, covered_streets_count, in_progress_streets_count, streets_untapped_count)
  select id, 'United States', 'country', 'US', 'in_progress', st_geogfromtext('POINT(-98.5795 39.8283)'), 96320, 18493, 28771, 7320, 3300, 54, 4120, 1850, 9300
  from global_field returning id
), ohio as (
  insert into territories (parent_id, name, level, country_code, status, center, reached_count, follow_up_count, souls_saved_count, prayer_request_count, bible_studies_active, discipleship_progress, covered_streets_count, in_progress_streets_count, streets_untapped_count)
  select id, 'Ohio', 'region', 'US', 'in_progress', st_geogfromtext('POINT(-82.9071 40.4173)'), 8420, 1370, 2180, 912, 245, 49, 308, 166, 721
  from usa returning id
), cleveland as (
  insert into territories (parent_id, name, level, country_code, status, center, reached_count, follow_up_count, souls_saved_count, prayer_request_count, bible_studies_active, discipleship_progress, covered_streets_count, in_progress_streets_count, streets_untapped_count)
  select id, 'Cleveland', 'city', 'US', 'in_progress', st_geogfromtext('POINT(-81.6944 41.4993)'), 3284, 417, 902, 341, 82, 52, 92, 41, 188
  from ohio returning id
), neighborhood as (
  insert into territories (parent_id, name, level, country_code, status, center, reached_count, follow_up_count, souls_saved_count, prayer_request_count, bible_studies_active, discipleship_progress, covered_streets_count, in_progress_streets_count, streets_untapped_count, street_names)
  select id, 'University Circle', 'neighborhood', 'US', 'in_progress', st_geogfromtext('POINT(-81.6084 41.5084)'), 944, 108, 226, 118, 28, 57, 12, 7, 18,
    array['Euclid Avenue', 'E 105th Street', 'Martin Luther King Jr Drive', 'Chester Avenue']
  from cleveland returning id
)
insert into territories (parent_id, name, level, country_code, status, center, reached_count, follow_up_count, souls_saved_count, prayer_request_count, bible_studies_active, discipleship_progress, covered_streets_count, in_progress_streets_count, streets_untapped_count, street_names)
select id, 'Euclid Avenue', 'street', 'US', 'covered', st_geogfromtext('POINT(-81.6112 41.5089)'), 224, 26, 58, 21, 8, 72, 1, 0, 0, array['Euclid Avenue']
from neighborhood
union all
select id, 'E 105th Street', 'street', 'US', 'follow_up_due', st_geogfromtext('POINT(-81.6142 41.5078)'), 96, 18, 21, 14, 4, 46, 0, 1, 0, array['E 105th Street']
from neighborhood
union all
select id, 'Chester Avenue', 'street', 'US', 'untapped', st_geogfromtext('POINT(-81.6062 41.5071)'), 0, 0, 0, 0, 0, 0, 0, 0, 1, array['Chester Avenue']
from neighborhood;
