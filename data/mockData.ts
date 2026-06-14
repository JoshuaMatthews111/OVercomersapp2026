import { ChatRoom, Event, GivingLink, OutreachContact, PrayerRequest, Series, Sermon, Territory } from '../types/models';

const metrics = (
  peopleReached: number,
  soulsSaved: number,
  prayerRequests: number,
  followUpsDue: number,
  bibleStudiesActive: number,
  discipleshipProgress: number,
  coveredStreets: number,
  inProgressStreets: number,
  untappedTerritory: number
) => ({
  peopleReached,
  soulsSaved,
  prayerRequests,
  followUpsDue,
  bibleStudiesActive,
  discipleshipProgress,
  coveredStreets,
  inProgressStreets,
  untappedTerritory
});

export const series: Series[] = [
  { id: 'kingdom-authority', title: 'Kingdom Authority', subtitle: 'Living under the authority of Christ', messageCount: 3, progress: 0.2 },
  { id: 'faith-that-moves', title: 'Faith That Moves Mountains', subtitle: 'Walking in power and obedience', messageCount: 2, progress: 0.45 },
  { id: 'power-of-prayer', title: 'The Power of Prayer', subtitle: 'Building a life of intercession', messageCount: 3, progress: 0.1 },
  { id: 'walking-purpose', title: 'Walking in Purpose', subtitle: 'Identity, assignment, and growth', messageCount: 2, progress: 0.0 }
];

export const sermons: Sermon[] = [
  {
    id: 'authority-1',
    seriesId: 'kingdom-authority',
    title: 'Authority Under Assignment',
    speaker: 'Overcomers Global Network',
    scriptureReference: 'Luke 10:19',
    description: 'A teaching on walking in Christ-given authority with humility and obedience.',
    videoUrl: 'https://example.com/live',
    audioUrl: 'https://example.com/audio/authority-1.mp3',
    durationSeconds: 2720,
    publishedAt: '2026-06-12T18:00:00Z',
    isFeatured: true
  },
  {
    id: 'authority-2',
    seriesId: 'kingdom-authority',
    title: 'Servants Who Carry Power',
    speaker: 'OGN Teaching Team',
    scriptureReference: 'Matthew 28:18-20',
    description: 'How the Great Commission shapes leadership, discipleship, and outreach.',
    durationSeconds: 3180,
    publishedAt: '2026-06-10T18:00:00Z'
  },
  {
    id: 'prayer-1',
    seriesId: 'power-of-prayer',
    title: 'The Prayer That Opens Cities',
    speaker: 'OGN Prayer Team',
    scriptureReference: 'Acts 16:25-34',
    description: 'Intercession, open doors, and evangelism momentum.',
    durationSeconds: 2515,
    publishedAt: '2026-06-09T18:00:00Z'
  }
];

export const chatRooms: ChatRoom[] = [
  { id: 'global-prayer', name: 'Global Prayer Room', region: 'Worldwide', members: 1245, unread: 12, type: 'prayer' },
  { id: 'announcements', name: 'Announcements', region: 'Worldwide', members: 2144, unread: 3, type: 'announcement' },
  { id: 'leaders', name: 'Kingdom Leaders', region: 'Global', members: 456, unread: 5, type: 'leader' },
  { id: 'new-believers', name: 'New Believers', region: 'Global', members: 654, unread: 3, type: 'global' },
  { id: 'africa', name: 'Africa Prayer Room', region: 'Africa', members: 1102, unread: 9, type: 'regional' },
  { id: 'north-america', name: 'North America Prayer Room', region: 'North America', members: 1356, unread: 2, type: 'regional' }
];

export const territories: Territory[] = [
  {
    id: 'world',
    name: 'Global Field',
    level: 'global',
    status: 'in_progress',
    center: { latitude: 20, longitude: 0 },
    reached: 1260000,
    followUps: 239110,
    soulsSaved: 412987,
    activeWorkers: 48765,
    metrics: metrics(1260000, 412987, 88200, 239110, 70240, 61, 34180, 12940, 66530)
  },
  {
    id: 'usa',
    parentId: 'world',
    name: 'United States',
    level: 'country',
    status: 'in_progress',
    center: { latitude: 39.8283, longitude: -98.5795 },
    reached: 96320,
    followUps: 18493,
    soulsSaved: 28771,
    activeWorkers: 2340,
    metrics: metrics(96320, 28771, 7320, 18493, 3300, 54, 4120, 1850, 9300)
  },
  {
    id: 'ohio',
    parentId: 'usa',
    name: 'Ohio',
    level: 'region',
    status: 'in_progress',
    center: { latitude: 40.4173, longitude: -82.9071 },
    reached: 8420,
    followUps: 1370,
    soulsSaved: 2180,
    activeWorkers: 196,
    metrics: metrics(8420, 2180, 912, 328, 245, 49, 308, 166, 721)
  },
  {
    id: 'cleveland',
    parentId: 'ohio',
    name: 'Cleveland',
    level: 'city',
    status: 'in_progress',
    center: { latitude: 41.4993, longitude: -81.6944 },
    reached: 3284,
    followUps: 417,
    soulsSaved: 902,
    activeWorkers: 78,
    metrics: metrics(3284, 902, 341, 111, 82, 52, 92, 41, 188)
  },
  {
    id: 'university-circle',
    parentId: 'cleveland',
    name: 'University Circle',
    level: 'neighborhood',
    status: 'in_progress',
    center: { latitude: 41.5084, longitude: -81.6084 },
    reached: 944,
    followUps: 108,
    soulsSaved: 226,
    activeWorkers: 24,
    streetsUntapped: 18,
    streetNames: ['Euclid Avenue', 'E 105th Street', 'Martin Luther King Jr Drive', 'Chester Avenue'],
    metrics: metrics(944, 226, 118, 31, 28, 57, 12, 7, 18)
  },
  {
    id: 'euclid-ave',
    parentId: 'university-circle',
    name: 'Euclid Avenue',
    level: 'street',
    status: 'covered',
    center: { latitude: 41.5089, longitude: -81.6112 },
    reached: 224,
    followUps: 26,
    soulsSaved: 58,
    activeWorkers: 8,
    streetNames: ['Euclid Avenue'],
    metrics: metrics(224, 58, 21, 7, 8, 72, 1, 0, 0)
  },
  {
    id: 'e-105',
    parentId: 'university-circle',
    name: 'E 105th Street',
    level: 'street',
    status: 'follow_up_due',
    center: { latitude: 41.5078, longitude: -81.6142 },
    reached: 96,
    followUps: 18,
    soulsSaved: 21,
    activeWorkers: 5,
    streetNames: ['E 105th Street'],
    metrics: metrics(96, 21, 14, 10, 4, 46, 0, 1, 0)
  },
  {
    id: 'chester-ave',
    parentId: 'university-circle',
    name: 'Chester Avenue',
    level: 'street',
    status: 'untapped',
    center: { latitude: 41.5071, longitude: -81.6062 },
    reached: 0,
    followUps: 0,
    soulsSaved: 0,
    activeWorkers: 0,
    streetNames: ['Chester Avenue'],
    metrics: metrics(0, 0, 0, 0, 0, 0, 0, 0, 1)
  },
  {
    id: 'kenya',
    parentId: 'world',
    name: 'Kenya',
    level: 'country',
    status: 'in_progress',
    center: { latitude: -0.0236, longitude: 37.9062 },
    reached: 45672,
    followUps: 5731,
    soulsSaved: 11890,
    activeWorkers: 1245,
    metrics: metrics(45672, 11890, 4508, 5731, 2022, 67, 2122, 734, 1800)
  },
  {
    id: 'nairobi',
    parentId: 'kenya',
    name: 'Nairobi',
    level: 'city',
    status: 'in_progress',
    center: { latitude: -1.286389, longitude: 36.817223 },
    reached: 12450,
    followUps: 1856,
    soulsSaved: 3564,
    activeWorkers: 318,
    metrics: metrics(12450, 3564, 1187, 382, 224, 64, 418, 132, 290)
  },
  {
    id: 'westlands',
    parentId: 'nairobi',
    name: 'Westlands',
    level: 'neighborhood',
    status: 'in_progress',
    center: { latitude: -1.2641, longitude: 36.8028 },
    reached: 2840,
    followUps: 247,
    soulsSaved: 812,
    activeWorkers: 62,
    streetsUntapped: 18,
    streetNames: ['Ring Road Westlands', 'Parklands Road', 'Waiyaki Way', 'School Lane'],
    metrics: metrics(2840, 812, 318, 68, 52, 62, 44, 21, 18)
  },
  {
    id: 'ring-road',
    parentId: 'westlands',
    name: 'Ring Road Westlands',
    level: 'street',
    status: 'in_progress',
    center: { latitude: -1.2632, longitude: 36.8076 },
    reached: 214,
    followUps: 18,
    soulsSaved: 54,
    activeWorkers: 9,
    streetNames: ['Ring Road Westlands'],
    metrics: metrics(214, 54, 28, 9, 7, 58, 0, 1, 0)
  }
];

export const contacts: OutreachContact[] = [
  {
    id: 'c1',
    territoryId: 'e-105',
    name: 'Taylor Household',
    phone: '+1 216 555 0144',
    whatsapp: '+1 216 555 0144',
    email: 'family@example.com',
    address: 'E 105th Street, Cleveland, OH',
    location: { latitude: 41.5078, longitude: -81.6142 },
    prayerRequest: 'Healing and a steady job',
    gospelShared: true,
    invitedToChurch: true,
    bibleStudyStarted: false,
    savedAcceptedChrist: true,
    followUpNeeded: true,
    status: 'saved',
    assignedTo: 'Leader Grace',
    nextFollowUpAt: '2026-06-14',
    notes: 'Wants Bible study this week.',
    createdBy: 'Outreach Team A',
    statusHistory: [{ status: 'contact_made', at: '2026-06-13T17:10:00Z', by: 'Outreach Team A' }, { status: 'saved', at: '2026-06-13T17:30:00Z', by: 'Leader Grace' }]
  },
  {
    id: 'c2',
    territoryId: 'euclid-ave',
    name: 'Marcus A.',
    phone: '+1 216 555 0188',
    address: 'Euclid Avenue, Cleveland, OH',
    location: { latitude: 41.5089, longitude: -81.6112 },
    prayerRequest: 'Family restoration',
    gospelShared: true,
    invitedToChurch: true,
    bibleStudyStarted: true,
    savedAcceptedChrist: false,
    followUpNeeded: true,
    status: 'bible_study',
    assignedTo: 'John M.',
    nextFollowUpAt: '2026-06-15',
    notes: 'Prefers WhatsApp after 6 PM.',
    createdBy: 'John M.',
    statusHistory: [{ status: 'gospel_shared', at: '2026-06-12T19:00:00Z', by: 'John M.' }]
  },
  {
    id: 'c3',
    territoryId: 'ring-road',
    name: 'Sarah Wanjiku',
    phone: '+254 700 000 000',
    address: 'Ring Road Westlands, Nairobi',
    location: { latitude: -1.2632, longitude: 36.8076 },
    prayerRequest: 'Healing for mother',
    gospelShared: true,
    invitedToChurch: true,
    bibleStudyStarted: false,
    savedAcceptedChrist: false,
    followUpNeeded: true,
    status: 'prayed',
    assignedTo: 'Leader Grace',
    nextFollowUpAt: '2026-06-18',
    notes: 'Requested prayer team support.',
    createdBy: 'Nairobi Team'
  }
];

export const prayerRequests: PrayerRequest[] = [
  { id: 'p1', name: 'Alicia', category: 'Healing', request: 'Please pray for recovery and peace in my family.', isPrivate: false, consentReceived: true, status: 'praying', createdAt: '2026-06-13T12:00:00Z' },
  { id: 'p2', name: 'Michael', category: 'Salvation', request: 'Pray for my brother to come back to Christ.', isPrivate: true, consentReceived: true, status: 'new', createdAt: '2026-06-14T08:00:00Z' }
];

export const events: Event[] = [
  { id: 'e1', title: 'Global Broadcast Night', description: 'Live teaching, prayer, and ministry updates.', location: 'Online', startsAt: '2026-06-14T19:00:00-04:00', registrationUrl: 'https://overcomersglobalnetwork.com' },
  { id: 'e2', title: 'Street Outreach Training', description: 'Leader prep for territory teams and follow-up workers.', location: 'Hybrid', startsAt: '2026-06-15T18:30:00-04:00' }
];

export const givingLinks: GivingLink[] = [
  { id: 'cashapp', label: 'Cash App', instructions: '$OvercomersGN' },
  { id: 'zelle', label: 'Zelle', instructions: 'support@overcomersglobalnetwork.com' },
  { id: 'online', label: 'Online Giving', url: 'https://overcomersglobalnetwork.com/give', instructions: 'Secure giving page placeholder' }
];

export const liveTimes = [
  { city: 'Los Angeles', time: '8:45 AM', zone: 'PDT' },
  { city: 'Cleveland', time: '11:45 AM', zone: 'EDT' },
  { city: 'London', time: '4:45 PM', zone: 'BST' },
  { city: 'Nairobi', time: '6:45 PM', zone: 'EAT' },
  { city: 'Manila', time: '11:45 PM', zone: 'PHT' }
];
