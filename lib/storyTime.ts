// One place that knows how long a story lives. The row from Supabase carries
// expires_at; older rows and mock stories fall back to 24 hours after publish.
export const STORY_LIFETIME_MS = 24 * 60 * 60 * 1000;

export type StoryClock = { publishedAt?: string; expiresAt?: string };

function parse(value?: string) {
  if (!value) return NaN;
  return new Date(value).getTime();
}

export function storyExpiry(story: StoryClock) {
  const explicit = parse(story.expiresAt);
  if (!Number.isNaN(explicit)) return explicit;
  const published = parse(story.publishedAt);
  if (!Number.isNaN(published)) return published + STORY_LIFETIME_MS;
  return NaN;
}

export function isStoryLive(story: StoryClock, now = Date.now()) {
  const expiry = storyExpiry(story);
  if (Number.isNaN(expiry)) return true;
  return expiry > now;
}

export function storyRemainingMs(story: StoryClock, now = Date.now()) {
  const expiry = storyExpiry(story);
  if (Number.isNaN(expiry)) return STORY_LIFETIME_MS;
  return Math.max(0, expiry - now);
}

// "23h left", "45m left", "expiring"
export function storyRemainingLabel(story: StoryClock, now = Date.now()) {
  const ms = storyRemainingMs(story, now);
  if (ms <= 0) return 'expiring';
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours >= 1) return `${hours}h left`;
  const minutes = Math.max(1, Math.ceil(ms / (60 * 1000)));
  return `${minutes}m left`;
}

// 0 when just published, 1 when about to expire.
export function storyAgeProgress(story: StoryClock, now = Date.now()) {
  const expiry = storyExpiry(story);
  const published = parse(story.publishedAt);
  if (Number.isNaN(expiry) || Number.isNaN(published) || expiry <= published) return 0.12;
  return Math.min(1, Math.max(0.04, (now - published) / (expiry - published)));
}
