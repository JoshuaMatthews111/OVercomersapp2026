import { BibleVersion } from '../types/models';

const KJV_FALLBACK = [
  { verse: 16, text: 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.' },
  { verse: 17, text: 'For God sent not his Son into the world to condemn the world; but that the world through him might be saved.' }
];

const bibleIds: Record<BibleVersion, string | undefined> = {
  KJV: 'de4e12af7f28f599-02',
  ERV: undefined,
  NIV: undefined,
  AMP: undefined
};

export type BiblePassage = {
  reference: string;
  version: BibleVersion;
  copyright?: string;
  verses: { verse: number; text: string }[];
  setupMessage?: string;
};

export async function getBiblePassage(version: BibleVersion, passageId = 'JHN.3.16-JHN.3.17'): Promise<BiblePassage> {
  const apiKey = process.env.EXPO_PUBLIC_BIBLE_API_KEY;
  const bibleId = bibleIds[version];

  if (!apiKey || !bibleId) {
    return {
      reference: 'John 3:16-17',
      version,
      verses: version === 'KJV' ? KJV_FALLBACK : [],
      setupMessage:
        version === 'KJV'
          ? 'KJV fallback is loaded. Add a Bible API key for live provider text.'
          : `${version} requires a licensed provider configuration. Do not hardcode copyrighted Bible text.`
    };
  }

  try {
    const response = await fetch(`https://api.scripture.api.bible/v1/bibles/${bibleId}/passages/${passageId}?content-type=text&include-notes=false&include-titles=false`, {
      headers: { 'api-key': apiKey }
    });
    if (!response.ok) throw new Error(`Bible provider returned ${response.status}`);
    const payload = await response.json();
    const text = String(payload.data?.content || '').replace(/\s+/g, ' ').trim();
    return {
      reference: payload.data?.reference || 'John 3:16-17',
      version,
      copyright: payload.data?.copyright,
      verses: text ? [{ verse: 16, text }] : KJV_FALLBACK
    };
  } catch {
    return {
      reference: 'John 3:16-17',
      version,
      verses: version === 'KJV' ? KJV_FALLBACK : [],
      setupMessage: 'Bible provider is unavailable right now. KJV fallback remains available.'
    };
  }
}
