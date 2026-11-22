const { app, BrowserWindow, ipcMain, session, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

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
function saveCookies(cookies) {
  fs.writeFileSync(cookieJsonPath(), JSON.stringify(cookies));
  fs.writeFileSync(cookieTxtPath(), toNetscape(cookies));
  cookieHeader = cookies.filter((c) => /youtube\.com|google\.com/.test(c.domain)).map((c) => `${c.name}=${c.value}`).join('; ');
}
function loadCookies() {
  try {
    const cookies = JSON.parse(fs.readFileSync(cookieJsonPath(), 'utf8'));
    cookieHeader = cookies.filter((c) => /youtube\.com|google\.com/.test(c.domain)).map((c) => `${c.name}=${c.value}`).join('; ');
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

async function library() {
  const y = await getYt();
  if (!signedIn()) return [];
  const found = new Map();
  const add = (p) => {
    const id = p?.id || p?.playlist_id;
    const title = text(p?.title).trim();
    if (id && title && !found.has(id)) found.set(id, { id, title, count: text(p.item_count ?? p.video_count ?? p.subtitle) });
  };
  const errors = [];
  try {
    const feed = await y.getPlaylists();
    (feed.playlists ?? feed.contents ?? []).forEach(add);
  } catch (e) { errors.push(String(e.message || e)); }
  try {
    const lib = await y.music.getLibrary();
    const pl = await lib.getPlaylists?.();
    (pl?.contents ?? pl?.playlists ?? lib.playlists ?? []).forEach(add);
  } catch (e) { errors.push(String(e.message || e)); }
  if (!found.size && errors.length) throw new Error(errors.join(' | '));
  return [...found.values()];
}

async function playlistSongs(id) {
  const y = await getYt();
  const pl = await y.music.getPlaylist(String(id).replace(/^VL/, ''));
  let all = [...(pl.items ?? [])];
  let page = pl;
  while (page.has_continuation && all.length < 2000) {
    page = await page.getContinuation();
    all = all.concat(page.items ?? []);
  }
  return dedupe(all.map(normalizeSong));
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
const urlCache = new Map(); // id -> { url, at }
function resolveStream(videoId) {
  const hit = urlCache.get(videoId);
  if (hit && Date.now() - hit.at < 20 * 60 * 1000) return Promise.resolve(hit.url);
  return new Promise((resolve, reject) => {
    const args = ['-f', 'bestaudio[ext=m4a]/bestaudio', '-g', '--no-playlist', '--no-warnings'];
    if (fs.existsSync(cookieTxtPath()) && signedIn()) args.push('--cookies', cookieTxtPath());
    args.push(`https://music.youtube.com/watch?v=${videoId}`);
    const p = spawn(ytDlpPath(), args, { windowsHide: true });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => reject(new Error(`Could not start yt-dlp: ${e.message}`)));
    p.on('close', (code) => {
      const url = out.split('\n').map((l) => l.trim()).find((l) => l.startsWith('http'));
      if (code === 0 && url) {
        urlCache.set(videoId, { url, at: Date.now() });
        resolve(url);
      } else reject(new Error(err.trim().split('\n').pop() || `yt-dlp exited with ${code}`));
    });
  });
}

// ---------- window / IPC ----------
function createWindow() {
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 1180, height: 760, minWidth: 820, minHeight: 560, backgroundColor: '#000000', title: 'ArchiveTune', icon: path.join(__dirname, 'build', 'icon.png'),
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
ipcMain.handle('yt:search', wrap(search));
ipcMain.handle('yt:library', wrap(library));
ipcMain.handle('yt:playlist', wrap(playlistSongs));
ipcMain.handle('yt:recommended', wrap(recommended));
ipcMain.handle('yt:stream', wrap(resolveStream));

app.whenReady().then(() => { loadCookies(); createWindow(); });
app.on('window-all-closed', () => app.quit());
