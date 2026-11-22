const { app, BrowserWindow, ipcMain, session, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');

const REPO = 'TahaEhbal/My-ArchiveTune';
const { parseBrowse, findContinuation: findCont } = require('./parse');

const SOURCE_PLAYLIST_NAME = 'the main playlist';
const COOKIE_DOMAINS = ['.youtube.com', 'youtube.com', '.google.com', 'accounts.google.com', 'music.youtube.com'];

let mainWindow = null;
let yt = null; // youtubei.js Innertube instance
let cookieHeader = '';

const userData = () => app.getPath('userData');
const cookieJsonPath = () => path.join(userData(), 'cookies.json');
const cookieTxtPath = () => path.join(userData(), 'cookies.txt');

// ---------- helpers ----------
const text = (v) => (v == null ? '' : typeof v === 'string' ? v : v.text ?? v.toString?.() ?? '');
const thumb = (t) => {
  const arr = t?.contents ?? t ?? [];
  const list = Array.isArray(arr) ? arr : [];
  return list.length ? list[list.length - 1].url : '';
};
function normalizeSong(i) {
  const id = i.id || i.video_id || i.endpoint?.payload?.videoId;
  if (!id || String(id).length !== 11) return null;
  const artists = (i.artists || (i.author ? [i.author] : [])).map((a) => text(a.name ?? a)).filter(Boolean);
  return {
    id,
    title: text(i.title ?? i.name),
    artist: artists.join(', ') || text(i.subtitle).split('•')[0].trim(),
    duration: i.duration?.seconds ?? i.duration ?? 0,
    thumbnail: thumb(i.thumbnail ?? i.thumbnails),
  };
}
const dedupe = (songs) => {
  const seen = new Set();
  return songs.filter((s) => s && !seen.has(s.id) && seen.add(s.id));
};

// ---------- auth / cookies ----------
function toNetscape(cookies) {
  const lines = ['# Netscape HTTP Cookie File'];
  for (const c of cookies) {
    const domain = c.domain.startsWith('.') || !c.hostOnly ? (c.domain.startsWith('.') ? c.domain : '.' + c.domain) : c.domain;
    lines.push([domain, domain.startsWith('.') ? 'TRUE' : 'FALSE', c.path || '/', c.secure ? 'TRUE' : 'FALSE', Math.floor(c.expirationDate || 0), c.name, c.value].join('\t'));
  }
  return lines.join('\n') + '\n';
}
function buildHeader(cookies) {
  const byName = new Map();
  for (const c of cookies) {
    if (!/youtube\.com|google\.com/.test(c.domain)) continue;
    const prefer = c.domain.includes('youtube.com');
    if (!byName.has(c.name) || prefer) byName.set(c.name, c.value);
  }
  return [...byName].map(([k, v]) => `${k}=${v}`).join('; ');
}
function saveCookies(cookies) {
  fs.writeFileSync(cookieJsonPath(), JSON.stringify(cookies));
  fs.writeFileSync(cookieTxtPath(), toNetscape(cookies));
  cookieHeader = buildHeader(cookies);
}
function loadCookies() {
  try {
    cookieHeader = buildHeader(JSON.parse(fs.readFileSync(cookieJsonPath(), 'utf8')));
  } catch {
    cookieHeader = '';
  }
}
const signedIn = () => /(^|; )(SAPISID|__Secure-3PAPISID)=/.test(cookieHeader);

async function getYt() {
  if (yt) return yt;
  const { Innertube } = await import('youtubei.js');
  yt = await Innertube.create({ cookie: cookieHeader || undefined, retrieve_player: false });
  return yt;
}

async function loginFlow() {
  const ses = session.fromPartition('persist:login');
  const win = new BrowserWindow({
    width: 520, height: 720, parent: mainWindow, modal: true, title: 'Sign in to Google', backgroundColor: '#000000',
    webPreferences: { session: ses },
  });
  win.setMenuBarVisibility(false);
  // Google refuses sign-in inside embedded browsers that say "Electron", so present a plain Chrome UA.
  const ua = win.webContents.userAgent.replace(/\s*Electron\/\S+/, '').replace(/\s*archivetune-desktop\/\S+/i, '');
  win.webContents.setUserAgent(ua);
  await win.loadURL('https://accounts.google.com/ServiceLogin?service=youtube&continue=https://music.youtube.com/');
  return new Promise((resolve) => {
    const finish = async () => {
      const all = [];
      for (const d of COOKIE_DOMAINS) all.push(...(await ses.cookies.get({ domain: d })));
      const uniq = [...new Map(all.map((c) => [`${c.domain}|${c.path}|${c.name}`, c])).values()];
      saveCookies(uniq);
      yt = null;
      resolve(signedIn());
    };
    let done = false;
    const check = async () => {
      if (done) return;
      const url = win.webContents.getURL();
      if (!url.startsWith('https://music.youtube.com') && !url.startsWith('https://www.youtube.com')) return;
      const all = await ses.cookies.get({ domain: 'youtube.com' });
      if (!all.some((c) => c.name === 'SAPISID' || c.name === '__Secure-3PAPISID')) return;
      done = true;
      await finish();
      win.close();
    };
    win.webContents.on('did-navigate', check);
    win.webContents.on('did-navigate-in-page', check);
    win.webContents.on('did-finish-load', check);
    win.on('closed', () => resolve(signedIn()));
  });
}

// ---------- YouTube data ----------
async function search(q) {
  const y = await getYt();
  const res = await y.music.search(q, { type: 'song' });
  const items = res.songs?.contents ?? res.contents?.flatMap?.((s) => s.contents ?? []) ?? [];
  return dedupe(items.map(normalizeSong));
}

// Raw browse helpers: walk YouTube Music's JSON directly so changes to the page layout can't break parsing.
const runsText = (r) => (r?.runs ?? []).map((x) => x.text).join('');
function walk(node, fn) {
  if (Array.isArray(node)) { node.forEach((n) => walk(n, fn)); return; }
  if (node && typeof node === 'object') {
    fn(node);
    for (const k of Object.keys(node)) walk(node[k], fn);
  }
}
async function rawBrowse(args) {
  const y = await getYt();
  const r = await y.actions.execute('/browse', { ...args, client: 'YTMUSIC', parse: false });
  return r?.data ?? r;
}
const lastThumb = (t) => {
  const a = t?.musicThumbnailRenderer?.thumbnail?.thumbnails ?? t?.thumbnails ?? [];
  return a.length ? a[a.length - 1].url : '';
};
function songFromRenderer(r) {
  const id = r.playlistItemData?.videoId ?? r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId;
  if (!id || id.length !== 11) return null;
  const cols = r.flexColumns ?? [];
  const title = runsText(cols[0]?.musicResponsiveListItemFlexColumnRenderer?.text);
  const sub = (cols[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? []).map((x) => x.text);
  const artist = sub.join('').split(' • ')[0].trim();
  const fixed = runsText(r.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text);
  const [m, sec] = fixed.split(':').map(Number);
  return { id, title, artist, duration: Number.isFinite(m) && Number.isFinite(sec) ? m * 60 + sec : 0, thumbnail: lastThumb(r.thumbnail) };
}
function findContinuation(data) {
  let tok = null;
  walk(data, (n) => {
    if (!tok && n.continuationCommand?.token) tok = n.continuationCommand.token;
    if (!tok && n.nextContinuationData?.continuation) tok = n.nextContinuationData.continuation;
  });
  return tok;
}

async function library() {
  if (!signedIn()) return [];
  const found = new Map();
  const add = (id, title, count) => {
    id = String(id || '').replace(/^VL/, '');
    title = String(title || '').trim();
    if (id && title && !found.has(id)) found.set(id, { id, title, count: count || '' });
  };
  let data = await rawBrowse({ browseId: 'FEmusic_liked_playlists' });
  const first = data;
  for (let page = 0; page < 10 && data; page++) {
    walk(data, (n) => {
      const two = n.musicTwoRowItemRenderer;
      if (two) {
        const be = two.navigationEndpoint?.browseEndpoint;
        if (be?.browseId?.startsWith('VL')) add(be.browseId, runsText(two.title), runsText(two.subtitle));
      }
      const li = n.musicResponsiveListItemRenderer;
      if (li) {
        const be = li.navigationEndpoint?.browseEndpoint;
        if (be?.browseId?.startsWith('VL')) add(be.browseId, runsText(li.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text), '');
      }
    });
    const tok = findContinuation(data);
    if (!tok) break;
    data = await rawBrowse({ continuation: tok }).catch(() => null);
  }
  if (!found.size) {
    let loggedIn = '?';
    walk(first, (n) => { if (n.key === 'logged_in') loggedIn = n.value; });
    const y = await getYt();
    throw new Error(`YouTube returned no playlists (logged_in=${loggedIn}, session=${y.session?.logged_in}, cookies=${cookieHeader.split('; ').length}, SAPISID=${/SAPISID=/.test(cookieHeader)}, top=${Object.keys(first?.contents ?? first ?? {}).join(',')}). Try Sign out, then Sign in again.`);
  }
  return [...found.values()];
}

async function playlistSongs(id) {
  const songs = [];
  let data = await rawBrowse({ browseId: 'VL' + String(id).replace(/^VL/, '') });
  for (let page = 0; page < 40 && data && songs.length < 4000; page++) {
    // Only read the playlist's own shelf (not the "Suggestions" shelf below it).
    const shelves = [];
    walk(data, (n) => {
      if (n.musicPlaylistShelfRenderer) shelves.push(n.musicPlaylistShelfRenderer);
      if (n.musicPlaylistShelfContinuation) shelves.push(n.musicPlaylistShelfContinuation);
    });
    if (!shelves.length) break;
    let tok = null;
    for (const shelf of shelves) {
      walk(shelf.contents, (n) => {
        if (n.musicResponsiveListItemRenderer) {
          const s = songFromRenderer(n.musicResponsiveListItemRenderer);
          if (s) songs.push(s);
        }
      });
      tok = tok || findContinuation(shelf);
    }
    if (!tok) break;
    data = await rawBrowse({ continuation: tok }).catch(() => null);
  }
  return dedupe(songs);
}

// Port of the Android "Recommended for you": seed from "the main playlist", score by how high and how
// often songs appear in each seed's related list, bonus for artists already in the playlist.
async function recommended() {
  const y = await getYt();
  const lists = await library();
  const src = lists.find((p) => p.title.trim().toLowerCase() === SOURCE_PLAYLIST_NAME);
  if (!src) {
    const names = lists.slice(0, 12).map((p) => p.title).join(', ');
    return { songs: [], error: `No playlist called "${SOURCE_PLAYLIST_NAME}" found. ${lists.length ? `Playlists I can see: ${names}` : 'I can see no playlists, so sign-in may not have worked.'}` };
  }
  const mine = await playlistSongs(src.id);
  const mineIds = new Set(mine.map((s) => s.id));
  const artistCount = {};
  mine.forEach((s) => s.artist.split(', ').forEach((a) => (artistCount[a] = (artistCount[a] || 0) + 1)));
  const seeds = [...mine].sort(() => Math.random() - 0.5).slice(0, 25);
  const scores = new Map(), hits = new Map(), info = new Map();
  let idx = 0;
  const worker = async () => {
    while (idx < seeds.length) {
      const seed = seeds[idx++];
      try {
        const up = await y.music.getUpNext(seed.id);
        const items = dedupe((up.contents ?? []).map(normalizeSong)).filter((s) => s.id !== seed.id && !mineIds.has(s.id));
        items.forEach((s, rank) => {
          info.set(s.id, s);
          scores.set(s.id, (scores.get(s.id) || 0) + 1 / (1 + rank / 8));
          hits.set(s.id, (hits.get(s.id) || 0) + 1);
        });
      } catch { /* skip seed */ }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  const ranked = [...info.values()]
    .map((s) => {
      const bonus = Math.min(Math.max(0, ...s.artist.split(', ').map((a) => artistCount[a] || 0)), 5) * 0.15;
      return [s, scores.get(s.id) + bonus + (hits.get(s.id) - 1) * 0.5];
    })
    .sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return { songs: [], error: 'YouTube returned no related songs.' };
  const cutoff = ranked[0][1] * 0.2;
  return { songs: ranked.filter((r) => r[1] >= cutoff).slice(0, 400).map((r) => r[0]) };
}

// ---------- streaming via yt-dlp ----------
function ytDlpPath() {
  const packaged = path.join(process.resourcesPath || '', 'yt-dlp.exe');
  if (fs.existsSync(packaged)) return packaged;
  const dev = path.join(__dirname, 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  return fs.existsSync(dev) ? dev : 'yt-dlp';
}
// Songs are downloaded by yt-dlp into a cache folder and played from disk. That avoids YouTube's
// connection-bound links being refused when the player (a different connection) asks for them.
const cacheDir = () => path.join(userData(), 'audio-cache');
const inflight = new Map(); // id -> Promise<path>
const AUDIO_EXT = /\.(m4a|webm|opus|mp3|ogg|mp4)$/i;

function cachedFile(videoId) {
  try {
    return fs.readdirSync(cacheDir()).map((f) => path.join(cacheDir(), f)).find((f) => path.basename(f).startsWith(videoId + '.') && AUDIO_EXT.test(f)) || null;
  } catch { return null; }
}
function trimCache() {
  try {
    const files = fs.readdirSync(cacheDir()).map((f) => { const p = path.join(cacheDir(), f); const st = fs.statSync(p); return { p, t: st.mtimeMs, n: st.size }; }).sort((x, y) => y.t - x.t);
    let total = 0;
    for (const f of files) { total += f.n; if (total > 600 * 1048576) fs.rmSync(f.p, { force: true }); }
  } catch { /* ignore */ }
}

const procs = new Map(); // id -> { child, prio }

function cancelPreloads(exceptId) {
  for (const [id, j] of procs) {
    if (id !== exceptId && j.prio === 'preload') { j.cancelled = true; j.child.kill(); }
  }
}

function runYtDlp(videoId, useCookies, prio) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(cacheDir(), { recursive: true });
    // yt-dlp needs a JavaScript engine to solve YouTube's checks. Use this app's own (Electron
    // behaves like Node when ELECTRON_RUN_AS_NODE is set), so nothing extra has to be installed.
    const args = ['-f', 'bestaudio[ext=m4a]/bestaudio/best', '--no-playlist', '--no-warnings', '--newline',
      '--no-part', '-o', path.join(cacheDir(), `${videoId}.%(ext)s`),
      '--js-runtimes', `node:${process.execPath}`];
    if (useCookies && fs.existsSync(cookieTxtPath()) && signedIn()) args.push('--cookies', cookieTxtPath());
    args.push(`https://music.youtube.com/watch?v=${videoId}`);
    const child = spawn(ytDlpPath(), args, { windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    const job = { child, prio, cancelled: false };
    procs.set(videoId, job);
    let err = '';
    child.stdout.on('data', (d) => {
      if (job.prio !== 'user') return;
      const m = /\[download\]\s+([\d.]+)%/.exec(String(d));
      if (m) mainWindow?.webContents.send('progress', { id: videoId, pct: Math.round(Number(m[1])) });
    });
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { procs.delete(videoId); reject(new Error(`Could not start yt-dlp: ${e.message}`)); });
    child.on('close', (code) => {
      procs.delete(videoId);
      if (job.cancelled) {
        const f = cachedFile(videoId);
        if (f) fs.rmSync(f, { force: true });
        return reject(new Error('cancelled'));
      }
      const file = cachedFile(videoId);
      if (code === 0 && file) resolve(file);
      else reject(new Error(err.trim().split('\n').filter(Boolean).slice(-2).join(' ') || `yt-dlp exited with ${code}`));
    });
  });
}

function resolveStream(videoId, prio = 'user') {
  const existing = cachedFile(videoId);
  if (existing && !procs.has(videoId)) { try { fs.utimesSync(existing, new Date(), new Date()); } catch { /* ignore */ } return Promise.resolve(pathToFileURL(existing).href); }
  if (prio === 'user') {
    // A song the user asked for gets all the bandwidth: pause background preloading.
    cancelPreloads(videoId);
    const running = procs.get(videoId);
    if (running) running.prio = 'user';
  }
  if (inflight.has(videoId)) return inflight.get(videoId);
  const job = (async () => {
    let file;
    try {
      file = await runYtDlp(videoId, false, prio);
    } catch (first) {
      if (first.message === 'cancelled') throw first;
      try { file = await runYtDlp(videoId, true, prio); } catch { throw new Error(String(first.message).slice(0, 300)); }
    }
    trimCache();
    return pathToFileURL(file).href;
  })().finally(() => inflight.delete(videoId));
  inflight.set(videoId, job);
  return job;
}

// ---------- self-update (downloads only the app code, a few MB, not the whole .exe) ----------
const cmpVer = (a, b) => {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
};
const currentVersion = () => global.__codeVersion || app.getVersion();
const sendUpdate = (msg) => mainWindow?.webContents.send('update', msg);

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(err.trim() || `${cmd} exited ${c}`))));
  });
}

async function checkForUpdate() {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100`, { headers: { 'User-Agent': 'ArchiveTune-Desktop' } });
    if (!res.ok) return sendUpdate({ state: 'error', message: `GitHub answered ${res.status}` });
    let best = null;
    for (const r of await res.json()) {
      const m = /^desktop-v(\d+\.\d+\.\d+)$/.exec(r.tag_name || '');
      if (!m) continue;
      const asset = (r.assets || []).find((a) => a.name === `code-${m[1]}.zip`);
      if (asset && cmpVer(m[1], currentVersion()) > 0 && (!best || cmpVer(m[1], best.v) > 0)) best = { v: m[1], url: asset.browser_download_url, size: asset.size };
    }
    if (!best) return sendUpdate({ state: 'uptodate', version: currentVersion() });
    if (fs.existsSync(path.join(userData(), 'code-staged', 'version.txt')) &&
        fs.readFileSync(path.join(userData(), 'code-staged', 'version.txt'), 'utf8').trim() === best.v) {
      return sendUpdate({ state: 'ready', version: best.v });
    }
    sendUpdate({ state: 'downloading', version: best.v, mb: (best.size / 1048576).toFixed(1) });
    const zip = path.join(userData(), 'code-update.zip');
    const tmp = path.join(userData(), 'code-staged-tmp');
    fs.rmSync(tmp, { recursive: true, force: true });
    const dl = await fetch(best.url, { headers: { 'User-Agent': 'ArchiveTune-Desktop' } });
    if (!dl.ok) throw new Error(`download failed (${dl.status})`);
    fs.writeFileSync(zip, Buffer.from(await dl.arrayBuffer()));
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -Force -LiteralPath '${zip}' -DestinationPath '${tmp}'`]);
    if (!fs.existsSync(path.join(tmp, 'app-main.js')) || !fs.existsSync(path.join(tmp, 'version.txt'))) throw new Error('update package incomplete');
    fs.rmSync(path.join(userData(), 'code-staged'), { recursive: true, force: true });
    fs.renameSync(tmp, path.join(userData(), 'code-staged'));
    fs.rmSync(zip, { force: true });
    sendUpdate({ state: 'ready', version: best.v });
  } catch (e) {
    sendUpdate({ state: 'error', message: String(e.message || e) });
  }
}


// ---------- lyrics (synced via LRCLIB, plain text via YouTube as a fallback) ----------
function cleanTitle(t) {
  return String(t).replace(/\s*[\(\[][^)\]]*(official|video|audio|lyrics?|visualizer|remaster|feat|ft\.|with)[^)\]]*[\)\]]/gi, '').replace(/\s+-\s+(Official|Lyric).*$/i, '').trim();
}
function parseLrc(lrc) {
  const out = [];
  for (const line of String(lrc || '').split('\n')) {
    const m = /^\s*((?:\[\d+:\d+(?:[.:]\d+)?\])+)\s*(.*)$/.exec(line);
    if (!m) continue;
    for (const ts of m[1].match(/\[\d+:\d+(?:[.:]\d+)?\]/g)) {
      const [, mm, ss] = /\[(\d+):(\d+(?:[.:]\d+)?)\]/.exec(ts);
      out.push({ t: Number(mm) * 60 + Number(ss.replace(':', '.')), text: m[2] });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}
const lyricsCache = new Map();
async function getLyrics({ id, title, artist, duration }) {
  if (lyricsCache.has(id)) return lyricsCache.get(id);
  const headers = { 'User-Agent': 'ArchiveTune-Desktop (https://github.com/TahaEhbal/My-ArchiveTune)' };
  const name = cleanTitle(title);
  const art = String(artist || '').split(/,|&/)[0].trim();
  let result = null;
  const take = (r) => {
    if (!r) return false;
    const synced = parseLrc(r.syncedLyrics);
    if (synced.length || r.plainLyrics) { result = { synced, plain: r.plainLyrics || '', source: 'LRCLIB' }; return true; }
    return false;
  };
  try {
    const q = new URLSearchParams({ track_name: name, artist_name: art, ...(duration ? { duration: String(Math.round(duration)) } : {}) });
    const r = await fetch(`https://lrclib.net/api/get?${q}`, { headers });
    if (r.ok) take(await r.json());
  } catch { /* try search */ }
  if (!result) {
    try {
      const r = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(`${name} ${art}`)}`, { headers });
      if (r.ok) {
        const list = await r.json();
        const best = list.find((x) => x.syncedLyrics) || list[0];
        take(best);
      }
    } catch { /* ignore */ }
  }
  if (!result) {
    try {
      const y = await getYt();
      const l = await y.music.getLyrics(id);
      const plain = l?.description?.text ?? '';
      if (plain) result = { synced: [], plain, source: 'YouTube Music' };
    } catch { /* ignore */ }
  }
  result = result || { synced: [], plain: '', source: '' };
  lyricsCache.set(id, result);
  return result;
}

// ---------- local listening stats ----------
const statsPath = () => path.join(userData(), 'stats.json');
function readStats() {
  try { return JSON.parse(fs.readFileSync(statsPath(), 'utf8')); } catch { return { songs: {}, total: { plays: 0, seconds: 0 } }; }
}
function recordPlay(song) {
  const s = readStats();
  const e = s.songs[song.id] || { id: song.id, title: song.title, artist: song.artist, thumbnail: song.thumbnail, plays: 0, seconds: 0 };
  e.plays++; e.seconds += Math.round(song.seconds || 0);
  e.last = Date.now();
  s.songs[song.id] = e;
  s.total.plays++; s.total.seconds += Math.round(song.seconds || 0);
  fs.writeFileSync(statsPath(), JSON.stringify(s));
}
function statsSummary() {
  const s = readStats();
  const songs = Object.values(s.songs);
  const artists = {};
  songs.forEach((x) => String(x.artist || 'Unknown').split(', ').forEach((a) => {
    artists[a] = artists[a] || { title: a, plays: 0 };
    artists[a].plays += x.plays;
  }));
  return {
    total: s.total,
    topSongs: songs.sort((a, b) => b.plays - a.plays || b.last - a.last).slice(0, 50),
    topArtists: Object.values(artists).sort((a, b) => b.plays - a.plays).slice(0, 30),
  };
}

// Like / unlike a song on the YouTube account, so it shows up in the phone app too.
async function setLiked(id, liked) {
  const y = await getYt();
  if (!signedIn()) throw new Error('Sign in to like songs');
  if (liked) await y.interact.like(id); else await y.interact.removeRating(id);
  return liked;
}

// ---------- window / IPC ----------
function createWindow() {
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 1180, height: 760, minWidth: 820, minHeight: 560, backgroundColor: '#000000', title: 'ArchiveTune', icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  // Googlevideo wants a browser-like Referer/Origin on media requests.
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['*://*.googlevideo.com/*'] }, (d, cb) => {
    d.requestHeaders['Referer'] = 'https://music.youtube.com/';
    d.requestHeaders['Origin'] = 'https://music.youtube.com';
    cb({ requestHeaders: d.requestHeaders });
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

const wrap = (fn) => async (_e, ...a) => {
  try { return { ok: true, data: await fn(...a) }; } catch (e) { return { ok: false, error: String(e.message || e) }; }
};
ipcMain.handle('auth:status', wrap(async () => ({ signedIn: signedIn() })));
ipcMain.handle('auth:login', wrap(async () => ({ signedIn: await loginFlow() })));
ipcMain.handle('auth:logout', wrap(async () => {
  for (const f of [cookieJsonPath(), cookieTxtPath()]) fs.rmSync(f, { force: true });
  await session.fromPartition('persist:login').clearStorageData();
  cookieHeader = ''; yt = null;
  return { signedIn: false };
}));
ipcMain.handle('yt:browse', wrap(async (id, params) => {
  let data = await rawBrowse({ browseId: id, ...(params ? { params } : {}) });
  const page = parseBrowse(data);
  // The home feed loads more shelves as you scroll; fetch a few extra pages up front.
  for (let i = 0; i < 3 && id === 'FEmusic_home'; i++) {
    const tok = findCont(data);
    if (!tok) break;
    data = await rawBrowse({ continuation: tok }).catch(() => null);
    if (!data) break;
    page.sections.push(...parseBrowse(data).sections);
  }
  return page;
}));
ipcMain.handle('yt:lyrics', wrap(getLyrics));
ipcMain.handle('stats:play', wrap(async (song) => recordPlay(song)));
ipcMain.handle('stats:get', wrap(async () => statsSummary()));
ipcMain.handle('yt:like', wrap(setLiked));
ipcMain.handle('yt:search', wrap(search));
ipcMain.handle('yt:library', wrap(library));
ipcMain.handle('yt:playlist', wrap(playlistSongs));
ipcMain.handle('yt:recommended', wrap(recommended));
ipcMain.handle('yt:stream', wrap((id, prio) => resolveStream(id, prio)));
ipcMain.handle('app:version', wrap(async () => currentVersion()));
ipcMain.handle('app:restart', async () => {
  const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
  app.exit(0);
});

app.whenReady().then(() => {
  loadCookies();
  createWindow();
  mainWindow.webContents.once('did-finish-load', () => {
    setTimeout(checkForUpdate, 3000);
    setInterval(checkForUpdate, 20 * 60 * 1000);
  });
});
app.on('window-all-closed', () => app.quit());
