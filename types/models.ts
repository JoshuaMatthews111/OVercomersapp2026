export type BibleVersion = 'KJV' | 'ERV' | 'NIV' | 'AMP';

export type Series = {
  id: string;
  title: string;
  subtitle: string;
  messageCount: number;
  coverUrl?: string;
  progress?: number;
};

export type Sermon = {
  id: string;
  seriesId: string;
  title: string;
  speaker: string;
  scriptureReference: string;
  description: string;
  videoUrl?: string;
  audioUrl?: string;
  durationSeconds?: number;
  publishedAt: string;
  isFeatured?: boolean;
};

export type ChatRoom = {
  id: string;
  name: string;
  region?: string;
  members: number;
  unread: number;
  type: 'global' | 'regional' | 'leader' | 'prayer' | 'announcement';
};

export type OutreachStatus = 'untapped' | 'in_progress' | 'covered' | 'follow_up_due' | 'new_believer' | 'discipled';

export type TerritoryLevel = 'global' | 'country' | 'region' | 'city' | 'neighborhood' | 'street';

export type TerritoryMetrics = {
  peopleReached: number;
  soulsSaved: number;
  prayerRequests: number;
  followUpsDue: number;
  bibleStudiesActive: number;
  discipleshipProgress: number;
  coveredStreets: number;
  inProgressStreets: number;
  untappedTerritory: number;
};

export type Territory = {
  id: string;
  parentId?: string;
  name: string;
  level: TerritoryLevel;
  status: OutreachStatus;
  center: { latitude: number; longitude: number };
  reached: number;
  followUps: number;
  soulsSaved: number;
  activeWorkers: number;
  streetsUntapped?: number;
  metrics: TerritoryMetrics;
  streetNames?: string[];
};

export type OutreachContact = {
  id: string;
  territoryId: string;
  name: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  address?: string;
  location?: { latitude: number; longitude: number };
  prayerRequest?: string;
  gospelShared?: boolean;
  invitedToChurch?: boolean;
  bibleStudyStarted?: boolean;
  savedAcceptedChrist?: boolean;
  followUpNeeded?: boolean;
  status: 'contact_made' | 'prayed' | 'gospel_shared' | 'invited' | 'bible_study' | 'saved' | 'discipled' | 'not_interested';
  assignedTo?: string;
  nextFollowUpAt?: string;
  notes?: string;
  createdBy?: string;
  statusHistory?: { status: OutreachContact['status']; at: string; by?: string }[];
};

export type PrayerRequest = {
  id: string;
  name: string;
  category: string;
  request: string;
  isPrivate: boolean;
  consentReceived: boolean;
  status: 'new' | 'praying' | 'follow_up' | 'answered' | 'closed';
  createdAt: string;
};

export type Event = {
  id: string;
  title: string;
  description: string;
  location: string;
  startsAt: string;
  registrationUrl?: string;
};

export type GivingLink = {
  id: string;
  label: string;
  url?: string;
  instructions: string;
};
