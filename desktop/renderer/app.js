const $ = (id) => document.getElementById(id);
const audio = $('audio');
const state = { view: 'search', songs: [], queue: [], index: -1, history: [], failed: new Set() };

const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const setStatus = (t) => ($('status').textContent = t || '');

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---------- rendering ----------
function renderSongs(songs, title) {
  state.songs = songs;
  $('title').textContent = title;
  const list = $('list');
  if (!songs.length) { list.innerHTML = '<div class="msg">Nothing here yet.</div>'; return; }
  const cur = state.queue[state.index]?.id;
  list.innerHTML = songs.map((s, i) => `
    <div class="row${s.id === cur ? ' playing' : ''}" data-i="${i}">
      <img loading="lazy" src="${esc(s.thumbnail)}" alt="" />
      <div><div class="t">${esc(s.title)}</div><div class="a">${esc(s.artist)}</div></div>
      <div class="d">${s.duration ? fmt(s.duration) : ''}</div>
    </div>`).join('');
}
$('list').addEventListener('click', (e) => {
  const row = e.target.closest('.row');
  if (row) return playFromList(Number(row.dataset.i));
  const pl = e.target.closest('.pl');
  if (pl) openPlaylist(pl.dataset.id, pl.dataset.title);
});

function showMessage(title, msg) { $('title').textContent = title; $('list').innerHTML = `<div class="msg">${esc(msg)}</div>`; }

// ---------- views ----------
async function show(view) {
  state.view = view;
  document.querySelectorAll('.nav').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  setStatus('');
  if (view === 'queue') {
    renderSongs(state.queue.slice(Math.max(0, state.index)), 'Queue (always shuffled)');
  } else if (view === 'library') {
    setStatus('Loading…');
    const r = await window.api.library();
    setStatus('');
    if (!r.ok) return showMessage('Library', r.error);
    if (!r.data.length) return showMessage('Library', 'No playlists found. Sign in (bottom left) to see your playlists.');
    $('title').textContent = 'Library';
    $('list').innerHTML = r.data.map((p) => `<div class="pl" data-id="${esc(p.id)}" data-title="${esc(p.title)}"><b>${esc(p.title)}</b> <span class="a">${esc(p.count)}</span></div>`).join('');
  } else if (view === 'recommended') {
    setStatus('Finding songs you\'ll like…');
    showMessage('Recommended for you', 'Building your list from "the main playlist"…');
    const r = await window.api.recommended();
    setStatus('');
    if (!r.ok) return showMessage('Recommended for you', r.error);
    if (r.data.error) return showMessage('Recommended for you', r.data.error);
    renderSongs(r.data.songs, `Recommended for you (${r.data.songs.length})`);
  }
}
async function openPlaylist(id, title) {
  setStatus('Loading…');
  const r = await window.api.playlist(id);
  setStatus('');
  if (!r.ok) return showMessage(title, r.error);
  renderSongs(r.data, title);
}
document.querySelectorAll('.nav').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));

let searchTimer;
$('q').addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = $('q').value.trim();
  if (!q) return;
  searchTimer = setTimeout(async () => {
    document.querySelectorAll('.nav').forEach((b) => b.classList.remove('active'));
    setStatus('Searching…');
    const r = await window.api.search(q);
    setStatus('');
    r.ok ? renderSongs(r.data, `Results for "${q}"`) : showMessage('Search', r.error);
  }, 350);
});

// ---------- account ----------
async function refreshAccount() {
  const r = await window.api.authStatus();
  const on = r.ok && r.data.signedIn;
  $('account').innerHTML = on ? '<button id="out">Sign out</button>' : '<button id="in">Sign in with Google</button>';
  if (on) $('out').onclick = async () => { await window.api.logout(); await refreshAccount(); show('recommended'); };
  else $('in').onclick = async () => { setStatus('Signing in…'); await window.api.login(); await refreshAccount(); show(state.view === 'search' ? 'recommended' : state.view); };
}

// ---------- playback (permanent shuffle) ----------
function playFromList(i) {
  // Whatever you click, the rest of the list is shuffled behind it. The song you picked plays first.
  const picked = state.songs[i];
  state.queue = [picked, ...shuffle(state.songs.filter((_, j) => j !== i))];
  state.index = 0;
  state.history = [];
  playCurrent();
}

async function urlFor(song) {
  const r = await window.api.stream(song.id);
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
    audio.src = await urlFor(song);
    await audio.play();
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: song.title, artist: song.artist, artwork: song.thumbnail ? [{ src: song.thumbnail }] : [] });
    }
    preloadAhead();
  } catch (e) {
    state.failed.add(song.id);
    setStatus(`Skipped "${song.title}": ${String(e.message || e).slice(0, 90)}`);
    next(true);
  }
}

// Resolve the next two links in the background so transitions are instant and bad songs show up early.
async function preloadAhead() {
  for (const song of state.queue.slice(state.index + 1, state.index + 3)) {
    try { await urlFor(song); } catch { state.failed.add(song.id); }
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
  document.querySelectorAll('.row').forEach((r) => r.classList.toggle('playing', state.songs[Number(r.dataset.i)]?.id === cur));
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
  setStatus(`Couldn't play "${song.title}" (stream refused). Skipping.`);
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
  else if (m.state === 'error') box.textContent = `Update check failed: ${String(m.message).slice(0, 80)}`;
});
refreshAccount();
show('recommended');
