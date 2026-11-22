const $ = (id) => document.getElementById(id);
const audio = $('audio');
let failStreak = 0;
let pickedByUser = false;
const state = { view: '', songs: [], queue: [], index: -1, history: [], failed: new Set() };

const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const setStatus = (t) => ($('status').textContent = t || '');

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---------- rendering ----------
state.sections = [];
const KIND_LABEL = { album: 'Album', artist: 'Artist', playlist: 'Playlist', mood: '', page: '' };

function rowHtml(s, si, i, cur) {
  return `<div class="row${s.id === cur ? ' playing' : ''}" data-s="${si}" data-i="${i}">
      <img loading="lazy" src="${esc(s.thumbnail)}" alt="" />
      <div><div class="t">${esc(s.title)}</div><div class="a">${esc(s.artist)}</div></div>
      <div class="d">${s.duration ? fmt(s.duration) : ''}</div>
    </div>`;
}
function cardHtml(c, si, i) {
  return `<div class="card" data-s="${si}" data-i="${i}">
      ${c.thumbnail ? `<img loading="lazy" src="${esc(c.thumbnail)}" alt="" class="${c.kind === 'artist' ? 'round' : ''}" />` : '<div class="ph"></div>'}
      <div class="ct">${esc(c.title)}</div><div class="a">${esc(c.artist || KIND_LABEL[c.kind] || '')}</div>
    </div>`;
}
function renderPage(title, page) {
  state.sections = page.sections || [];
  $('title').textContent = title;
  const cur = state.queue[state.index]?.id;
  let html = '';
  if (page.header?.title) {
    html += `<div class="phead">${page.header.thumbnail ? `<img src="${esc(page.header.thumbnail)}" alt="" />` : ''}<div><div class="pt">${esc(page.header.title)}</div><div class="a">${esc(page.header.subtitle || '')}</div></div></div>`;
  }
  state.sections.forEach((sec, si) => {
    const items = sec.items.map((it) => ({ ...it, kind: it.kind || 'song' }));
    sec.items = items;
    const songs = items.filter((x) => x.kind === 'song');
    html += `<h3 class="sec">${esc(sec.title)}</h3>`;
    if (songs.length === items.length) html += items.map((s, i) => rowHtml(s, si, i, cur)).join('');
    else html += `<div class="cards">${items.map((c, i) => (c.kind === 'song' ? rowHtml(c, si, i, cur) : cardHtml(c, si, i))).join('')}</div>`;
  });
  $('list').innerHTML = html || '<div class="msg">Nothing here yet.</div>';
}
function showMessage(title, msg) { $('title').textContent = title; $('list').innerHTML = `<div class="msg">${esc(msg)}</div>`; }

// ---------- navigation ----------
const nav = { stack: [], current: null };
async function openPage(desc, push = true) {
  if (push && nav.current) nav.stack.push(nav.current);
  nav.current = desc;
  $('back').hidden = nav.stack.length === 0;
  setStatus(desc.loading || 'Loading…');
  showMessage(desc.title, desc.loading || 'Loading…');
  let page;
  try { page = await desc.load(); } catch (e) { page = { error: String(e.message || e) }; }
  if (nav.current !== desc) return; // user went somewhere else meanwhile
  setStatus('');
  if (page.error) return showMessage(desc.title, page.error);
  renderPage(page.title || desc.title, page);
}
function openRoot(desc, viewName) {
  nav.stack = [];
  nav.current = null;
  state.view = viewName || '';
  document.querySelectorAll('.nav').forEach((b) => b.classList.toggle('active', b.dataset.view === viewName));
  return openPage(desc, false);
}
$('back').onclick = () => {
  const prev = nav.stack.pop();
  if (prev) openPage(prev, false);
};

const unwrap = async (p) => { const r = await p; if (!r.ok) throw new Error(r.error); return r.data; };
const browseDesc = (title, id, params) => ({ title, load: async () => unwrap(window.api.browse(id, params)) });
const playlistDesc = (title, id) => ({
  title,
  load: async () => ({ sections: [{ title: '', items: await unwrap(window.api.playlist(id)) }] }),
});

const VIEWS = {
  home: () => browseDesc('Home', 'FEmusic_home'),
  explore: () => browseDesc('Explore', 'FEmusic_explore'),
  charts: () => browseDesc('Charts', 'FEmusic_charts'),
  newreleases: () => browseDesc('New releases', 'FEmusic_new_releases_albums'),
  moods: () => browseDesc('Moods & genres', 'FEmusic_moods_and_genres'),
  history: () => browseDesc('History', 'FEmusic_history'),
  liked: () => playlistDesc('Liked songs', 'LM'),
  queue: () => ({ title: 'Queue (always shuffled)', load: async () => ({ sections: [{ title: '', items: state.queue.slice(Math.max(0, state.index)) }] }) }),
  library: () => ({
    title: 'Library',
    load: async () => {
      const lists = await unwrap(window.api.library());
      if (!lists.length) return { error: 'No playlists found. Sign in (bottom left) to see your playlists.' };
      return { sections: [{ title: 'Playlists', items: lists.map((p) => ({ kind: 'playlist', id: p.id, title: p.title, artist: p.count, thumbnail: '' })) }] };
    },
  }),
  recommended: () => ({
    title: 'Recommended for you',
    loading: 'Building your list from "the main playlist"…',
    load: async () => {
      const d = await unwrap(window.api.recommended());
      if (d.error) return { error: d.error };
      return { title: `Recommended for you (${d.songs.length})`, sections: [{ title: '', items: d.songs }] };
    },
  }),
};
function show(view) { return openRoot(VIEWS[view](), view); }
document.querySelectorAll('.nav').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));

$('list').addEventListener('click', (e) => {
  const el = e.target.closest('.row, .card');
  if (!el) return;
  const sec = state.sections[Number(el.dataset.s)];
  const item = sec?.items[Number(el.dataset.i)];
  if (!item) return;
  if (item.kind === 'song') return playFromList(sec.items.filter((x) => x.kind === 'song'), item.id);
  if (item.kind === 'playlist') return openPage(playlistDesc(item.title, item.id));
  openPage(browseDesc(item.title, item.id, item.params));
});

let searchTimer;
$('q').addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = $('q').value.trim();
  if (!q) return;
  searchTimer = setTimeout(() => {
    openRoot({
      title: `Results for "${q}"`,
      loading: 'Searching…',
      load: async () => ({ sections: [{ title: '', items: await unwrap(window.api.search(q)) }] }),
    }, '');
  }, 350);
});

// ---------- account ----------
async function refreshAccount() {
  const r = await window.api.authStatus();
  const on = r.ok && r.data.signedIn;
  $('account').innerHTML = on ? '<button id="out">Sign out</button>' : '<button id="in">Sign in with Google</button>';
  if (on) $('out').onclick = async () => { await window.api.logout(); await refreshAccount(); show('home'); };
  else $('in').onclick = async () => { setStatus('Signing in…'); await window.api.login(); await refreshAccount(); show(state.view || 'home'); };
}

// ---------- playback (permanent shuffle) ----------
function playFromList(songs, pickedId) {
  // Whatever you click, the rest of the list is shuffled behind it. The song you picked plays first.
  const picked = songs.find((s) => s.id === pickedId);
  state.queue = [picked, ...shuffle(songs.filter((s) => s.id !== pickedId))];
  state.index = 0;
  state.history = [];
  pickedByUser = true;
  failStreak = 0;
  playCurrent();
}

async function urlFor(song, prio = 'user') {
  const r = await window.api.stream(song.id, prio);
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

async function playCurrent() {
  const song = state.queue[state.index];
  if (!song) return;
  $('np-title').textContent = song.title;
  $('np-artist').textContent = song.artist;
  $('art').src = song.thumbnail || '';
  document.title = `${song.title} · ArchiveTune`;
  highlight();
  try {
    setStatus('Loading song…');
    audio.src = await urlFor(song);
    setStatus('');
    await audio.play();
    failStreak = 0;
    pickedByUser = false;
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: song.title, artist: song.artist, artwork: song.thumbnail ? [{ src: song.thumbnail }] : [] });
    }
    preloadAhead();
  } catch (e) {
    state.failed.add(song.id);
    failStreak++;
    const why = String(e.message || e).slice(0, 400);
    if (pickedByUser) {
      pickedByUser = false;
      showError(`"${song.title}" couldn't be played: ${why}`);
      return;
    }
    if (failStreak >= 3) {
      showError(`Stopped after ${failStreak} songs in a row failed. Last error for "${song.title}": ${why}`);
      return;
    }
    setStatus(`Skipped "${song.title}": ${why.slice(0, 120)}`);
    next(true);
  }
}
function showError(text) {
  failStreak = 0;
  $('np-title').textContent = 'Playback failed';
  $('np-artist').textContent = '';
  const box = document.createElement('div');
  box.className = 'msg';
  box.style.cssText = 'white-space:pre-wrap;user-select:text;border:1px solid #4a2a2a;border-radius:8px;margin:8px 0;color:#ffb4b4';
  box.textContent = text;
  $('list').prepend(box);
  setStatus('');
}

// Resolve the next two links in the background so transitions are instant and bad songs show up early.
async function preloadAhead() {
  for (const song of state.queue.slice(state.index + 1, state.index + 4)) {
    try { await urlFor(song, 'preload'); } catch (e) {
      if (String(e.message) === 'cancelled') return; // the user picked something else; stop preloading
      state.failed.add(song.id);
    }
  }
}

function next(auto) {
  if (state.index < 0) return;
  if (state.index + 1 >= state.queue.length) {
    // End of queue: reshuffle everything and carry on, so music never stops.
    const last = state.queue[state.index];
    state.queue = shuffle(state.queue.filter((s) => !state.failed.has(s.id)));
    if (state.queue.length > 1 && state.queue[0].id === last.id) state.queue.push(state.queue.shift());
    state.index = -1;
  } else state.history.push(state.index);
  state.index++;
  if (state.queue.length === 0) return;
  while (state.failed.has(state.queue[state.index]?.id) && state.index < state.queue.length - 1) state.index++;
  playCurrent();
}
function prev() {
  if (audio.currentTime > 4 || !state.history.length) { audio.currentTime = 0; return; }
  state.index = state.history.pop();
  playCurrent();
}
function highlight() {
  const cur = state.queue[state.index]?.id;
  document.querySelectorAll('.row').forEach((r) => r.classList.toggle('playing', state.sections[Number(r.dataset.s)]?.items[Number(r.dataset.i)]?.id === cur));
}

// ---------- controls ----------
$('play').onclick = () => (audio.paused ? audio.play() : audio.pause());
$('next').onclick = () => next(false);
$('prev').onclick = prev;
audio.addEventListener('play', () => ($('play').textContent = '⏸'));
audio.addEventListener('pause', () => ($('play').textContent = '▶'));
audio.addEventListener('ended', () => next(true));
audio.addEventListener('error', () => {
  const song = state.queue[state.index];
  if (!song || !audio.src) return;
  state.failed.add(song.id);
  failStreak++;
  if (pickedByUser) {
    pickedByUser = false;
    const c = audio.error ? `media error ${audio.error.code}${audio.error.message ? ': ' + audio.error.message : ''}` : 'unknown audio error';
    return showError(`"${song.title}" was found but the audio would not load (${c}).`);
  }
  const code = audio.error ? `media error ${audio.error.code}${audio.error.message ? ': ' + audio.error.message : ''}` : 'unknown audio error';
  if (failStreak >= 3) return showError(`Stopped after ${failStreak} songs failed to play. The link was found but the audio would not load (${code}). Last: "${song.title}"`);
  setStatus(`Couldn't play "${song.title}" (${code}). Skipping.`);
  next(true);
});
audio.addEventListener('timeupdate', () => {
  if (!audio.duration || seeking) return;
  $('bar').value = (audio.currentTime / audio.duration) * 1000;
  $('cur').textContent = fmt(audio.currentTime);
  $('dur').textContent = fmt(audio.duration);
});
let seeking = false;
$('bar').addEventListener('input', () => { seeking = true; });
$('bar').addEventListener('change', () => { if (audio.duration) audio.currentTime = ($('bar').value / 1000) * audio.duration; seeking = false; });
$('vol').addEventListener('input', () => (audio.volume = $('vol').value / 100));
audio.volume = 0.8;

if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('nexttrack', () => next(false));
  navigator.mediaSession.setActionHandler('previoustrack', prev);
  navigator.mediaSession.setActionHandler('play', () => audio.play());
  navigator.mediaSession.setActionHandler('pause', () => audio.pause());
}
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { e.preventDefault(); $('play').click(); }
});

window.api.version().then((r) => { if (r.ok) $('ver').textContent = `· v${r.data}`; });
window.api.onUpdate((m) => {
  const box = $('update');
  if (m.state === 'downloading') box.textContent = `Downloading update ${m.version} (${m.mb} MB)…`;
  else if (m.state === 'ready') { box.innerHTML = `<button id="restart">Update ${m.version} ready – restart</button>`; $('restart').onclick = () => window.api.restart(); }
  else if (m.state === 'uptodate') box.textContent = 'Up to date';
  else if (m.state === 'error') box.textContent = `Update check failed: ${String(m.message).slice(0, 80)}`;
});
window.api.onProgress((m) => { if (m.id === state.queue[state.index]?.id && audio.paused) setStatus(`Downloading song… ${m.pct}%`); });
refreshAccount();
show('home');
