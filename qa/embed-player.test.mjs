import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// lib/embed.ts imports ./requestTimeout; compile both and point the import at
// the compiled copy so this suite runs on plain Node with no bundler.
function compile(path) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  return ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
}
const timeoutUrl = `data:text/javascript;base64,${Buffer.from(compile('../lib/requestTimeout.ts')).toString('base64')}`;
const embedJs = compile('../lib/embed.ts').replace(/from ['"]\.\/requestTimeout['"]/, `from '${timeoutUrl}'`);
const embed = await import(`data:text/javascript;base64,${Buffer.from(embedJs).toString('base64')}`);

const ID = 'G5h7XID3Re8';

test('every YouTube link shape still gives the same id (build 34 behaviour)', () => {
  for (const link of [
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?is=4DKloCQczdogCpo7`,
    `https://www.youtube.com/watch?v=${ID}&t=90s`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
  ]) assert.equal(embed.youtubeVideoId(link), ID, link);
  assert.equal(embed.youtubeVideoId(`https://youtu.be/${ID}https://youtu.be/${ID}`), null);
  assert.equal(embed.youtubeVideoId('not a link'), null);
});

test('embedUrl and playbackKind are unchanged for admin and chat', () => {
  assert.equal(embed.embedUrl(`https://youtu.be/${ID}`), `https://www.youtube.com/embed/${ID}?playsinline=1&autoplay=1&rel=0`);
  assert.equal(embed.embedUrl('https://vimeo.com/76979871'), 'https://player.vimeo.com/video/76979871?autoplay=1');
  assert.match(embed.embedUrl('https://www.facebook.com/watch/?v=1'), /^https:\/\/www\.facebook\.com\/plugins\/video\.php\?href=/);
  assert.equal(embed.playbackKind(`https://youtu.be/${ID}`, 'video'), 'embed');
  assert.equal(embed.playbackKind('https://cdn.example.org/a.mp3', 'video'), 'audio');
  assert.equal(embed.playbackKind('https://cdn.example.org/a.mp4?x=1', 'audio'), 'video');
});

test('YouTube loads as a page that lives at the ministry address (fixes Error 153)', () => {
  const source = embed.embedSource(`https://youtu.be/${ID}?is=abc`, { background: '#0B1D4D' });
  assert.equal(source.kind, 'youtube');
  assert.equal(source.baseUrl, 'https://overcomersglobalnetwork.com');
  assert.equal(source.watchUrl, `https://www.youtube.com/watch?v=${ID}`);
  const html = source.html;
  assert.match(html, /<meta name="referrer" content="strict-origin-when-cross-origin">/);
  assert.match(html, /referrerpolicy="strict-origin-when-cross-origin"/);
  assert.ok(html.includes(`https://www.youtube.com/embed/${ID}?playsinline=1&autoplay=1&rel=0&enablejsapi=1&origin=https%3A%2F%2Fovercomersglobalnetwork.com&widget_referrer=https%3A%2F%2Fovercomersglobalnetwork.com`));
  assert.match(html, /https:\/\/www\.youtube\.com\/iframe_api/);
  assert.match(html, /onError/);
  assert.match(html, /background: #0B1D4D/);
});

test('a strange background never reaches the CSS, and a bad id is refused', () => {
  assert.match(embed.youtubePlayerHtml(ID, { background: 'red;}</style><script>' }), /background: black/);
  assert.throws(() => embed.youtubePlayerHtml('"><script>'));
});

test('Vimeo and Facebook still load as a plain address', () => {
  assert.deepEqual(embed.embedSource('https://vimeo.com/76979871'), { kind: 'page', uri: 'https://player.vimeo.com/video/76979871?autoplay=1' });
  assert.equal(embed.embedSource('https://www.facebook.com/watch/?v=1').kind, 'page');
  assert.equal(embed.embedSource('https://example.org/page'), null);
});

test('every YouTube error code the task names lands on a kind message', () => {
  assert.equal(embed.playerProblemFor(2), 'broken-link');
  assert.equal(embed.playerProblemFor(5), 'no-start');
  assert.equal(embed.playerProblemFor(100), 'gone');
  for (const code of [101, 150, 152, 153, 999]) assert.equal(embed.playerProblemFor(code), 'youtube-only');
  assert.equal(embed.playerProblemCopy('youtube-only').title, 'This video can only be watched on YouTube');
  for (const p of ['youtube-only', 'gone', 'broken-link', 'no-start']) {
    const copy = embed.playerProblemCopy(p);
    assert.ok(copy.title.length > 0 && copy.body.length > 0);
    assert.doesNotMatch(copy.title + copy.body, /error|153|configuration/i);
  }
});

test('player messages are read strictly', () => {
  assert.deepEqual(embed.parsePlayerMessage('{"source":"ogn-player","type":"error","code":153}'), { type: 'error', code: 153 });
  assert.deepEqual(embed.parsePlayerMessage('{"source":"ogn-player","type":"state","playing":true}'), { type: 'state', playing: true });
  assert.deepEqual(embed.parsePlayerMessage('{"source":"ogn-player","type":"ready"}'), { type: 'ready' });
  assert.equal(embed.parsePlayerMessage('{"type":"error","code":153}'), null);
  assert.equal(embed.parsePlayerMessage('{"source":"ogn-player","type":"state","playing":"yes"}'), null);
  assert.equal(embed.parsePlayerMessage('not json'), null);
});

test('"Watch on YouTube" cannot take over the player; the player page and frame can load', () => {
  assert.equal(embed.playerMayNavigate('https://overcomersglobalnetwork.com/', true), true);
  assert.equal(embed.playerMayNavigate('about:blank', true), true);
  assert.equal(embed.playerMayNavigate(`https://www.youtube.com/embed/${ID}?x=1`, undefined), true);
  assert.equal(embed.playerMayNavigate('https://www.youtube.com/anything', false), true);
  assert.equal(embed.playerMayNavigate(`https://www.youtube.com/watch?v=${ID}`, true), false);
  assert.equal(embed.playerMayNavigate(`https://www.youtube.com/watch?v=${ID}`, undefined), false);
  assert.equal(embed.playerMayNavigate('https://accounts.google.com/signin', true), false);
});

test('the player never traps the screen: no Modal, and the minimised layer ignores touches', () => {
  const source = readFileSync(new URL('../lib/nowPlaying.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /<Modal\b/, 'the full player must not be a React Native Modal');
  assert.match(source, /pointerEvents=\{expanded \? 'auto' : 'none'\}/);
  assert.match(source, /accessibilityLabel="Minimize the player"/);
  assert.match(source, /accessibilityLabel="Close the player and stop"/);
  assert.match(source, /export function useMiniPlayerInset/);
  assert.match(source, /\{ html: source\.html, baseUrl: source\.baseUrl \}/);
});

test('Vimeo and Facebook "watch on the site" links cannot take over the player either', () => {
  const vimeo = 'https://player.vimeo.com/video/76979871?autoplay=1';
  assert.equal(embed.embedPageMayNavigate(vimeo, vimeo, true), true);
  assert.equal(embed.embedPageMayNavigate(vimeo, 'https://player.vimeo.com/video/76979871?autoplay=1#t=5', true), true);
  assert.equal(embed.embedPageMayNavigate(vimeo, 'https://vimeo.com/76979871', true), false);
  assert.equal(embed.embedPageMayNavigate(vimeo, 'https://vimeo.com/76979871', false), true, 'inner frames are left alone');
  const fb = embed.embedUrl('https://www.facebook.com/watch/?v=1');
  assert.equal(embed.embedPageMayNavigate(fb, fb, true), true);
  assert.equal(embed.embedPageMayNavigate(fb, 'https://www.facebook.com/watch/?v=1', true), false);
  assert.equal(embed.embedPageMayNavigate(fb, 'about:blank', true), true);
  assert.equal(embed.embedPageMayNavigate(fb, 'not a link', true), false);
});

test('the "only on YouTube" message does not blame the channel for a player refusal', () => {
  const copy = embed.playerProblemCopy('youtube-only');
  assert.doesNotMatch(copy.body, /channel/i);
  assert.match(copy.body, /YouTube/);
});

test('off the tab screens the bar gets its own strip instead of covering the chat box', () => {
  const source = readFileSync(new URL('../lib/nowPlaying.tsx', import.meta.url), 'utf8');
  assert.match(source, /paddingBottom: reservedOffTabs/);
  assert.match(source, /<ReservedStrip height=\{reservedOffTabs\}/);
  assert.match(source, /function ReservedStrip[\s\S]*?pointerEvents="none"/);
  assert.match(source, /const barVisible = Boolean\(item\) && !expanded && !keyboardUp;/);
  assert.match(source, /<ScrollView[\s\S]*?style=\{styles\.body\}/, 'the sheet body scrolls on small phones');
});
