const { app, BrowserWindow, ipcMain, session, Menu, Tray, nativeImage, globalShortcut, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');
const http = require('http');

const REPO = 'TahaEhbal/My-ArchiveTune';
const { parseBrowse, findContinuation: findCont, idsFromRuns, hires } = require('./parse');

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
  return list.length ? hires(list[list.length - 1].url) : '';
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
    artistId: i.artists?.find?.((a) => a.channel_id)?.channel_id || i.author?.channel_id || undefined,
    albumId: i.album?.id || undefined,
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
  return a.length ? hires(a[a.length - 1].url) : '';
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
  return { id, title, artist, duration: Number.isFinite(m) && Number.isFinite(sec) ? m * 60 + sec : 0, thumbnail: lastThumb(r.thumbnail), ...idsFromRuns(cols[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs, cols[2]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs) };
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
  const add = (id, title, count, thumbnail) => {
    id = String(id || '').replace(/^VL/, '');
    title = String(title || '').trim();
    if (id && title && !found.has(id)) found.set(id, { id, title, count: count || '', thumbnail: thumbnail || '' });
  };
  let data = await rawBrowse({ browseId: 'FEmusic_liked_playlists' });
  const first = data;
  for (let page = 0; page < 10 && data; page++) {
    walk(data, (n) => {
      const two = n.musicTwoRowItemRenderer;
      if (two) {
        const be = two.navigationEndpoint?.browseEndpoint;
        if (be?.browseId?.startsWith('VL')) add(be.browseId, runsText(two.title), runsText(two.subtitle), lastThumb(two.thumbnailRenderer));
      }
      const li = n.musicResponsiveListItemRenderer;
      if (li) {
        const be = li.navigationEndpoint?.browseEndpoint;
        if (be?.browseId?.startsWith('VL')) add(be.browseId, runsText(li.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text), '', lastThumb(li.thumbnail));
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
    // Newer continuation replies carry the songs in appendContinuationItemsAction instead of a shelf.
    if (!shelves.length && page > 0) shelves.push({ contents: data });
    if (!shelves.length) break;
    let tok = null;
    for (const shelf of shelves) {
      walk(shelf.contents, (n) => {
        if (n.musicResponsiveListItemRenderer) {
          const s = songFromRenderer(n.musicResponsiveListItemRenderer);
          if (s) songs.push(s);
        }
      });
      tok = tok || findContinuation(shelf.contents === data ? data : shelf);
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

const dlDir = () => path.join(userData(), 'downloads');
const metaPath = () => path.join(userData(), 'songs.json');
function cachedFile(videoId) {
  for (const dir of [dlDir(), cacheDir()]) { // saved downloads win over the auto-managed cache
    try {
      const f = fs.readdirSync(dir).find((n) => n.startsWith(videoId + '.') && AUDIO_EXT.test(n));
      if (f) return path.join(dir, f);
    } catch { /* folder missing */ }
  }
  return null;
}
function trimCache() {
  try {
    const files = fs.readdirSync(cacheDir()).map((f) => { const p = path.join(cacheDir(), f); const st = fs.statSync(p); return { p, t: st.mtimeMs, n: st.size }; }).sort((x, y) => y.t - x.t);
    let total = 0;
    for (const f of files) { total += f.n; if (total > 600 * 1048576) fs.rmSync(f.p, { force: true }); }
  } catch { /* ignore */ }
}
const readMeta = () => { try { return JSON.parse(fs.readFileSync(metaPath(), 'utf8')); } catch { return {}; } };
const writeMeta = (m) => { try { fs.writeFileSync(metaPath(), JSON.stringify(m)); } catch { /* ignore */ } };
function keepMeta(song, extra = {}) {
  if (!song?.id) return;
  const m = readMeta();
  const fields = { id: song.id, title: song.title, artist: song.artist, thumbnail: song.thumbnail, duration: song.duration, artistId: song.artistId, albumId: song.albumId };
  for (const k of Object.keys(fields)) if (fields[k] === undefined || fields[k] === '') delete fields[k];
  m[song.id] = { ...m[song.id], ...fields, ...extra, at: Date.now() };
  writeMeta(m);
}

const procs = new Map(); // id -> { child, prio }

function cancelPreloads(exceptId) {
  for (const [id, j] of procs) {
    if (id !== exceptId && j.prio !== 'user' && j.prio !== 'download') { j.cancelled = true; j.child.kill(); }
  }
}

function runYtDlp(videoId, useCookies, prio, dir = cacheDir()) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(dir, { recursive: true });
    // yt-dlp needs a JavaScript engine to solve YouTube's checks. Use this app's own (Electron
    // behaves like Node when ELECTRON_RUN_AS_NODE is set), so nothing extra has to be installed.
    const args = ['-f', 'bestaudio[ext=m4a]/bestaudio/best', '--no-playlist', '--no-warnings', '--newline',
      '--no-part', '-o', path.join(dir, `${videoId}.%(ext)s`),
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

function resolveStream(videoId, prio = 'user', meta) {
  const existing = cachedFile(videoId);
  if (existing && !procs.has(videoId)) { try { fs.utimesSync(existing, new Date(), new Date()); } catch { /* ignore */ } return Promise.resolve(pathToFileURL(existing).href); }
  if (prio === 'hover') {
    // Only one hover-download at a time; the queue's preloads keep going.
    for (const [pid, j] of procs) if (pid !== videoId && j.prio === 'hover') { j.cancelled = true; j.child.kill(); }
  }
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
    keepMeta(meta || { id: videoId });
    return pathToFileURL(file).href;
  })().finally(() => inflight.delete(videoId));
  inflight.set(videoId, job);
  return job;
}

// ---------- play while downloading ----------
// A tiny local web server hands the player the song while yt-dlp is still writing it, so playback
// starts after the first few seconds instead of after the whole download.
const live = new Map(); // id -> { done, err }
let liveServer = null, livePort = 0;
const MIME = { m4a: 'audio/mp4', mp4: 'audio/mp4', webm: 'audio/webm', opus: 'audio/ogg', ogg: 'audio/ogg', mp3: 'audio/mpeg' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function startLiveServer() {
  if (liveServer) return Promise.resolve(livePort);
  return new Promise((resolve) => {
    liveServer = http.createServer(async (req, res) => {
      const id = decodeURIComponent((req.url || '').split('?')[0].replace(/^\/s\//, ''));
      const st = live.get(id);
      let closed = false;
      res.on('close', () => { closed = true; });
      if (!st || !/^[\w-]{11}$/.test(id)) { res.statusCode = 404; return res.end(); }
      let file = null;
      for (let i = 0; i < 400 && !closed && !file; i++) {
        file = cachedFile(id);
        if (!file) { if (st.done || st.err) break; await sleep(100); }
      }
      if (!file || closed) { res.destroy(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).slice(1).toLowerCase()] || 'audio/mp4', 'Cache-Control': 'no-store' });
      let fd;
      try { fd = fs.openSync(file, 'r'); } catch { res.destroy(); return; }
      let pos = 0;
      try {
        while (!closed) {
          const size = fs.fstatSync(fd).size;
          if (pos < size) {
            const buf = Buffer.alloc(Math.min(size - pos, 262144));
            const n = fs.readSync(fd, buf, 0, buf.length, pos);
            pos += n;
            if (!res.write(buf.subarray(0, n))) await new Promise((r) => res.once('drain', r));
          } else if (st.err) { res.destroy(); break; }
          else if (st.done) { res.end(); break; }
          else await sleep(80);
        }
      } catch { try { res.destroy(); } catch { /* gone */ } }
      try { fs.closeSync(fd); } catch { /* ignore */ }
    });
    liveServer.listen(0, '127.0.0.1', () => { livePort = liveServer.address().port; resolve(livePort); });
  });
}
async function streamLive(videoId, meta) {
  const existing = cachedFile(videoId);
  if (existing && !procs.has(videoId) && !inflight.has(videoId)) return { url: await resolveStream(videoId, 'user', meta), live: false };
  const port = await startLiveServer();
  const st = { done: false, err: null };
  live.set(videoId, st);
  resolveStream(videoId, 'user', meta).then(() => { st.done = true; }, (e) => { st.err = e; st.done = true; });
  return { url: `http://127.0.0.1:${port}/s/${videoId}`, live: true };
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

// ---------- playlist editing + radio (used by the right-click menu) ----------
async function needSignIn() {
  if (!signedIn()) throw new Error('Sign in first (top right)');
  return getYt();
}
async function playlistAdd(playlistId, videoId) {
  const y = await needSignIn();
  await y.playlist.addVideos(playlistId, [videoId]);
  return true;
}
async function playlistRemove(playlistId, videoId) {
  const y = await needSignIn();
  await y.playlist.removeVideos(playlistId, [videoId]);
  return true;
}
async function playlistCreate(title, videoId) {
  const y = await needSignIn();
  const r = await y.playlist.create(title, videoId ? [videoId] : []);
  return r?.playlist_id ?? true;
}
async function radio(videoId) {
  const y = await getYt();
  const up = await y.music.getUpNext(videoId);
  return dedupe((up.contents ?? []).map(normalizeSong));
}

// ---------- offline downloads ----------
async function downloadSong(song) {
  fs.mkdirSync(dlDir(), { recursive: true });
  let file = cachedFile(song.id);
  if (file && !file.startsWith(dlDir())) { // already played: just move it out of the auto-trimmed cache
    const dest = path.join(dlDir(), path.basename(file));
    fs.renameSync(file, dest);
    file = dest;
  }
  if (!file) {
    try { file = await runYtDlp(song.id, false, 'download', dlDir()); }
    catch (e) { file = await runYtDlp(song.id, true, 'download', dlDir()).catch(() => { throw e; }); }
  }
  keepMeta(song, { pinned: true, size: fs.statSync(file).size });
  return true;
}
function removeDownload(id) {
  const f = cachedFile(id);
  if (f && f.startsWith(dlDir())) fs.rmSync(f, { force: true });
  const m = readMeta();
  if (m[id]) { m[id].pinned = false; writeMeta(m); }
  return true;
}
function listSongs() {
  const out = { downloaded: [], cached: [] };
  for (const v of Object.values(readMeta())) {
    const f = v.title ? cachedFile(v.id) : null;
    if (!f) continue;
    (f.startsWith(dlDir()) ? out.downloaded : out.cached).push({ ...v, size: fs.statSync(f).size });
  }
  out.downloaded.sort((a, b) => (b.at || 0) - (a.at || 0));
  out.cached.sort((a, b) => (b.at || 0) - (a.at || 0));
  return out;
}
const downloadedIds = () => listSongs().downloaded.map((s) => s.id);

// ---------- sync "Recommended for you" to the YouTube account ----------
async function syncRecommended(songs) {
  const y = await needSignIn();
  const TITLE = 'Recommended for you';
  const ids = [...new Set(songs.map((s) => s.id))];
  if (!ids.length) throw new Error('Nothing to sync yet');
  const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };
  const lists = await library();
  const existing = lists.find((p) => p.title.trim().toLowerCase() === TITLE.toLowerCase());
  if (!existing) {
    const [first, ...rest] = chunk(ids, 50);
    const r = await y.playlist.create(TITLE, first);
    const pid = r?.playlist_id;
    if (!pid) throw new Error('YouTube did not return the new playlist');
    for (const c of rest) await y.playlist.addVideos(pid, c);
    return { created: true, added: ids.length, removed: 0 };
  }
  const cur = (await playlistSongs(existing.id)).map((s) => s.id);
  const want = new Set(ids), have = new Set(cur);
  const remove = cur.filter((i) => !want.has(i));
  const add = ids.filter((i) => !have.has(i));
  for (const c of chunk(remove, 50)) await y.playlist.removeVideos(existing.id, c);
  for (const c of chunk(add, 50)) await y.playlist.addVideos(existing.id, c);
  return { created: false, added: add.length, removed: remove.length };
}

// ---------- tray, close-to-tray, media keys ----------
const settingsPath = () => path.join(userData(), 'settings.json');
let settings = { closeToTray: true, startWithWindows: false, alwaysOnTop: false, icon: '' };
const iconFile = () => {
  if (/^\d+$/.test(settings.icon || '')) { const f = path.join(__dirname, 'assets', 'icons', `${settings.icon}.png`); if (fs.existsSync(f)) return f; }
  return path.join(__dirname, 'assets', 'icon.png');
};
function applyIcon() {
  try {
    const img = nativeImage.createFromPath(iconFile());
    mainWindow?.setIcon(img);
    if (miniWindow && !miniWindow.isDestroyed()) miniWindow.setIcon(img);
    tray?.setImage(img.resize({ width: 32, height: 32 }));
  } catch { /* keep the old icon */ }
}
const loadSettings = () => { try { settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) }; } catch { /* defaults */ } };
const saveSettings = () => { try { fs.writeFileSync(settingsPath(), JSON.stringify(settings)); } catch { /* ignore */ } };
let tray = null, quitting = false;
let nowPlaying = { title: '', artist: '', playing: false };
const sendMedia = (a) => mainWindow?.webContents.send('media', a);
function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}
function refreshTray() {
  if (!tray) return;
  tray.setToolTip(nowPlaying.title ? `${nowPlaying.title} – ${nowPlaying.artist}` : 'ArchiveTune');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: nowPlaying.title ? `${nowPlaying.title}` : 'Nothing playing', enabled: false },
    { type: 'separator' },
    { label: nowPlaying.playing ? 'Pause' : 'Play', click: () => sendMedia('playpause') },
    { label: 'Next', click: () => sendMedia('next') },
    { label: 'Previous', click: () => sendMedia('prev') },
    { type: 'separator' },
    { label: 'Open ArchiveTune', click: showWindow },
    { label: 'Close to tray', type: 'checkbox', checked: settings.closeToTray, click: (i) => { settings.closeToTray = i.checked; saveSettings(); } },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
}
function setupTray() {
  try {
    const img = nativeImage.createFromPath(iconFile()).resize({ width: 32, height: 32 });
    tray = new Tray(img);
    tray.on('click', showWindow);
    refreshTray();
  } catch { tray = null; }
  for (const [key, action] of [['MediaPlayPause', 'playpause'], ['MediaNextTrack', 'next'], ['MediaPreviousTrack', 'prev']]) {
    try { globalShortcut.register(key, () => sendMedia(action)); } catch { /* key unavailable */ }
  }
}
// ---------- mini player ----------
let miniWindow = null;
function toggleMini() {
  if (miniWindow && !miniWindow.isDestroyed()) { miniWindow.close(); return; }
  miniWindow = new BrowserWindow({
    width: 380, height: 132, resizable: false, maximizable: false, fullscreenable: false, frame: false, alwaysOnTop: true,
    backgroundColor: '#0c0c0f', title: 'ArchiveTune mini player', icon: iconFile(),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  miniWindow.loadFile(path.join(__dirname, 'renderer', 'mini.html'));
  miniWindow.webContents.on('did-finish-load', () => miniWindow?.webContents.send('mini:state', nowPlaying));
  mainWindow?.hide();
  miniWindow.on('closed', () => { miniWindow = null; showWindow(); });
}
ipcMain.handle('win:mini', () => { toggleMini(); return true; });
ipcMain.handle('mini:action', (_e, a) => { if (a === 'restore') { toggleMini(); } else sendMedia(a); return true; });

function updateThumbar() {
  try {
    const icon = (n) => nativeImage.createFromPath(path.join(__dirname, 'assets', `${n}.png`));
    mainWindow?.setThumbarButtons([
      { tooltip: 'Previous', icon: icon('tb-prev'), click: () => sendMedia('prev') },
      { tooltip: nowPlaying.playing ? 'Pause' : 'Play', icon: icon(nowPlaying.playing ? 'tb-pause' : 'tb-play'), click: () => sendMedia('playpause') },
      { tooltip: 'Next', icon: icon('tb-next'), click: () => sendMedia('next') },
    ]);
  } catch { /* taskbar buttons unavailable */ }
}
ipcMain.handle('player:state', (_e, s) => {
  const playingChanged = s.playing !== undefined && s.playing !== nowPlaying.playing;
  nowPlaying = { ...nowPlaying, ...s };
  if (miniWindow && !miniWindow.isDestroyed()) miniWindow.webContents.send('mini:state', nowPlaying);
  if (s.title !== undefined || playingChanged) { refreshTray(); updateThumbar(); }
});

// ---------- search, suggestions, album-art colour ----------
async function searchAll(q) {
  const y = await getYt();
  const r = await y.actions.execute('/search', { query: q, client: 'YTMUSIC', parse: false });
  return parseBrowse(r?.data ?? r).sections;
}
async function suggest(q) {
  try {
    const y = await getYt();
    const res = await y.music.getSearchSuggestions(q);
    const out = [];
    walk(res, (n) => { const t = n?.suggestion?.text ?? n?.suggestion?.toString?.(); if (typeof t === 'string' && t && !out.includes(t)) out.push(t); });
    return out.slice(0, 7);
  } catch { return []; }
}
async function artColor(url) {
  try {
    if (!/^https:\/\/(lh3\.googleusercontent\.com|i\.ytimg\.com|yt3\.ggpht\.com)\//.test(url)) return null;
    const res = await net.fetch(url);
    if (!res.ok) return null;
    const img = nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer())).resize({ width: 8, height: 8 });
    const b = img.toBitmap();
    let r = 0, g = 0, bl = 0, n = 0;
    for (let i = 0; i + 3 < b.length; i += 4) { bl += b[i]; g += b[i + 1]; r += b[i + 2]; n++; }
    return n ? [Math.round(r / n), Math.round(g / n), Math.round(bl / n)] : null;
  } catch { return null; }
}


// ---------- window / IPC ----------
function createWindow() {
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 1180, height: 760, minWidth: 480, minHeight: 400, backgroundColor: '#000000', title: 'ArchiveTune', icon: iconFile(),
    // No grey title bar: the page draws its own top edge and Windows overlays just the min/max/close buttons.
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#00000000', symbolColor: '#ffffff', height: 44 },
    show: !process.argv.includes('--hidden'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  if (settings.alwaysOnTop) mainWindow.setAlwaysOnTop(true);
  const toggleFs = () => mainWindow.setFullScreen(!mainWindow.isFullScreen());
  mainWindow.on('enter-full-screen', () => mainWindow.webContents.send('fullscreen', true));
  mainWindow.on('leave-full-screen', () => mainWindow.webContents.send('fullscreen', false));
  mainWindow.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { e.preventDefault(); toggleFs(); }
  });
  ipcMain.removeHandler('win:fullscreen');
  ipcMain.handle('win:fullscreen', () => { toggleFs(); return true; });
  mainWindow.on('close', (e) => {
    if (!quitting && settings.closeToTray && tray) { e.preventDefault(); mainWindow.hide(); }
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
let accountInfo = null;
ipcMain.handle('auth:info', wrap(async () => {
  if (!signedIn()) return {};
  if (accountInfo) return accountInfo;
  try {
    const y = await getYt();
    const info = await y.account.getInfo();
    const a = info?.contents?.contents?.[0] ?? info?.contents?.[0];
    accountInfo = { name: String(a?.account_name?.toString?.() ?? a?.account_name?.text ?? ''), photo: hires(a?.account_photo?.[0]?.url ?? '') };
  } catch { accountInfo = { name: '', photo: '' }; }
  return accountInfo;
}));
function applyLoginItem() {
  try {
    app.setLoginItemSettings({ openAtLogin: !!settings.startWithWindows, path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath, args: ['--hidden'] });
  } catch { /* not supported here */ }
}
ipcMain.handle('settings:get', wrap(async () => ({ ...settings })));
ipcMain.handle('settings:set', wrap(async (patch) => {
  for (const k of ['closeToTray', 'startWithWindows', 'alwaysOnTop']) if (patch && typeof patch[k] === 'boolean') settings[k] = patch[k];
  saveSettings();
  if (patch && typeof patch.icon === 'string' && /^\d*$/.test(patch.icon)) { settings.icon = patch.icon; saveSettings(); applyIcon(); }
  applyLoginItem();
  mainWindow?.setAlwaysOnTop(!!settings.alwaysOnTop);
  return { ...settings };
}));
ipcMain.handle('update:check', wrap(async () => { checkForUpdate(); return true; }));
ipcMain.handle('cache:clear', wrap(async () => {
  let n = 0;
  try { for (const f of fs.readdirSync(cacheDir())) { try { fs.rmSync(path.join(cacheDir(), f), { force: true }); n++; } catch { /* in use */ } } } catch { /* none */ }
  return n;
}));
ipcMain.handle('auth:logout', wrap(async () => {
  for (const f of [cookieJsonPath(), cookieTxtPath()]) fs.rmSync(f, { force: true });
  await session.fromPartition('persist:login').clearStorageData();
  cookieHeader = ''; yt = null; accountInfo = null;
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
ipcMain.handle('pl:add', wrap(playlistAdd));
ipcMain.handle('pl:remove', wrap(playlistRemove));
ipcMain.handle('pl:create', wrap(playlistCreate));
ipcMain.handle('yt:radio', wrap(radio));
ipcMain.handle('dl:add', wrap(downloadSong));
ipcMain.handle('dl:remove', wrap(removeDownload));
ipcMain.handle('dl:list', wrap(async () => listSongs()));
ipcMain.handle('dl:ids', wrap(async () => downloadedIds()));
ipcMain.handle('yt:syncRecommended', wrap(syncRecommended));
ipcMain.handle('yt:search', wrap(search));
ipcMain.handle('yt:searchAll', wrap(searchAll));
ipcMain.handle('yt:suggest', wrap(suggest));
ipcMain.handle('img:color', wrap(artColor));
ipcMain.handle('win:top', wrap(async () => { settings.alwaysOnTop = !settings.alwaysOnTop; saveSettings(); mainWindow?.setAlwaysOnTop(settings.alwaysOnTop); return settings.alwaysOnTop; }));
ipcMain.handle('yt:library', wrap(library));
ipcMain.handle('yt:playlist', wrap(playlistSongs));
ipcMain.handle('yt:recommended', wrap(async (force) => {
  // Building the list takes ~25 requests, so keep the result for 6 hours unless a refresh is asked for.
  const file = path.join(userData(), 'recommended.json');
  if (!force) {
    try {
      const c = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Date.now() - c.at < 6 * 3600e3 && c.songs?.length) return { songs: c.songs };
    } catch { /* build fresh */ }
  }
  const r = await recommended();
  if (r.songs?.length) fs.writeFileSync(file, JSON.stringify({ at: Date.now(), songs: r.songs }));
  return r;
}));
ipcMain.handle('yt:streamLive', wrap((id, meta) => streamLive(id, meta)));
ipcMain.handle('yt:stream', wrap((id, prio, meta) => resolveStream(id, prio, meta)));
ipcMain.handle('app:version', wrap(async () => currentVersion()));
ipcMain.handle('app:restart', async () => {
  const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  quitting = true;
  app.releaseSingleInstanceLock();
  spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
  app.exit(0);
});

if (!app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', showWindow);
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.whenReady().then(() => {
  loadCookies();
  loadSettings();
  createWindow();
  setupTray();
  if (process.argv.includes('--hidden') && !tray) showWindow(); // no tray icon to bring it back from
  updateThumbar();
  mainWindow.webContents.once('did-finish-load', () => {
    setTimeout(checkForUpdate, 3000);
    setInterval(checkForUpdate, 20 * 60 * 1000);
  });
});
app.on('window-all-closed', () => { if (quitting || !settings.closeToTray || !tray) app.quit(); });
