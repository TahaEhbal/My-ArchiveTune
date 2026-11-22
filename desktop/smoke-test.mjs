// Run in CI: checks the YouTube Music calls the app depends on still work and parse into songs.
import { Innertube } from 'youtubei.js';
const yt = await Innertube.create({ retrieve_player: false });
const res = await yt.music.search('Billie Eilish Lovely', { type: 'song' });
const items = res.songs?.contents ?? [];
console.log('search results:', items.length);
if (!items.length) throw new Error('search returned no songs');
const first = items[0];
console.log('first:', first.id, first.title, (first.artists || []).map((a) => a.name).join(', '));
const up = await yt.music.getUpNext(first.id);
console.log('up next:', (up.contents ?? []).length);
if (!(up.contents ?? []).length) throw new Error('getUpNext returned nothing');
const raw = await yt.actions.execute('/browse', { browseId: 'FEmusic_home', client: 'YTMUSIC', parse: false });
const rd = raw?.data ?? raw;
console.log('raw browse keys:', Object.keys(rd || {}).join(','));
if (!rd?.contents) throw new Error('raw browse returned no contents');

// --- parser checks against real, signed-out YouTube Music pages ---
import { createRequire } from 'node:module';
const { parseBrowse } = createRequire(import.meta.url)('./parse.js');
const browse = async (browseId, params) => {
  const r = await yt.actions.execute('/browse', { browseId, ...(params ? { params } : {}), client: 'YTMUSIC', parse: false });
  return parseBrowse(r?.data ?? r);
};
const summary = (name, p) => console.log(`PARSE ${name}: header=${p.header?.title ?? '-'} sections=${p.sections.length} items=${p.sections.reduce((n, s) => n + s.items.length, 0)} kinds=${[...new Set(p.sections.flatMap((s) => s.items.map((i) => i.kind)))].join('/')}`);
let firstAlbum, firstArtist;
for (const [name, id] of [['home', 'FEmusic_home'], ['explore', 'FEmusic_explore'], ['charts', 'FEmusic_charts'], ['newreleases', 'FEmusic_new_releases_albums'], ['moods', 'FEmusic_moods_and_genres']]) {
  try {
    const p = await browse(id);
    summary(name, p);
    for (const s of p.sections) for (const i of s.items) { firstAlbum ??= i.kind === 'album' ? i : undefined; firstArtist ??= i.kind === 'artist' ? i : undefined; }
  } catch (e) { console.log(`PARSE ${name} FAILED: ${e.message}`); }
}
if (firstAlbum) { try { summary(`album(${firstAlbum.title})`, await browse(firstAlbum.id)); } catch (e) { console.log('PARSE album FAILED', e.message); } }
if (firstArtist) { try { summary(`artist(${firstArtist.title})`, await browse(firstArtist.id)); } catch (e) { console.log('PARSE artist FAILED', e.message); } }
