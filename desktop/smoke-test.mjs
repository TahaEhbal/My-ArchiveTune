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
