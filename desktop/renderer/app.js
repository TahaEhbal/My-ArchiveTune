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

const ic = (name) => `<svg class="i"><use href="#i-${name}"/></svg>`;
function rowHtml(s, si, i, cur) {
  return `<div class="row${s.id === cur ? ' playing' : ''}" data-s="${si}" data-i="${i}">
      <div class="n"><span>${i + 1}</span>${ic('play')}</div>
      <div class="m"><img loading="lazy" src="${esc(s.thumbnail)}" alt="" /><div style="min-width:0"><div class="t">${esc(s.title)}</div><div class="a">${esc(s.artist)}</div></div></div>
      <div class="d">${s.duration ? fmt(s.duration) : ''}</div>
    </div>`;
}
function cardHtml(c, si, i) {
  const playable = c.kind === 'album' || c.kind === 'playlist';
  return `<div class="card-i" data-s="${si}" data-i="${i}">
      <div class="cimg">${c.thumbnail ? `<img loading="lazy" src="${esc(c.thumbnail)}" alt="" class="${c.kind === 'artist' ? 'round' : ''}" />` : `<div class="ph"></div>`}
      ${playable ? `<button class="cplay" data-play="1" title="Play">${ic('play')}</button>` : ''}</div>
      <div class="ct">${esc(c.title)}</div><div class="a">${esc(c.artist || KIND_LABEL[c.kind] || '')}</div>
    </div>`;
}
function heroColor(text) {
  let h = 0;
  for (const ch of String(text || 'x')) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h}, 48%, 24%)`;
}
function renderPage(title, page) {
  state.sections = page.sections || [];
  $('title').textContent = page.header?.title ? '' : title;
  document.querySelector('.pagehead').style.display = page.header?.title ? 'none' : '';
  $('hero').style.setProperty('--hero', heroColor(page.header?.title || title));
  const cur = state.queue[state.index]?.id;
  let html = '';
  const allSongs = state.sections.flatMap((s) => s.items).filter((x) => (x.kind || 'song') === 'song');
  if (page.header?.title) {
    html += `<div class="phead">${page.header.thumbnail ? `<img src="${esc(page.header.thumbnail)}" alt="" />` : ''}<div><div class="pk">${esc(page.kindLabel || '')}</div><div class="pt">${esc(page.header.title)}</div><div class="a">${esc(page.header.subtitle || '')}</div></div></div>`;
  }
  if (allSongs.length && (page.header?.title || state.sections.length === 1)) {
    html += `<div class="actions"><button class="bigplay" data-playall="1" title="Shuffle play">${ic('play')}</button><span class="hint">Shuffle play · ${allSongs.length} songs</span></div>`;
  }
  state.sections.forEach((sec, si) => {
    const items = sec.items.map((it) => ({ ...it, kind: it.kind || 'song' }));
    sec.items = items;
    const songs = items.filter((x) => x.kind === 'song');
    if (sec.title) {
      const shelf = songs.length !== items.length && items.length > 5;
      html += `<div class="sechead"><h3 class="sec">${esc(sec.title)}</h3>${shelf ? `<div class="arrows"><button data-scroll="-1" title="Back">${ic('left')}</button><button data-scroll="1" title="Next">${ic('right')}</button></div>` : ''}</div>`;
    }
    if (songs.length === items.length) html += items.map((s, i) => rowHtml(s, si, i, cur)).join('');
    else html += `<div class="shelf">${items.map((c, i) => (c.kind === 'song' ? cardSong(c, si, i) : cardHtml(c, si, i))).join('')}</div>`;
  });
  $('list').innerHTML = html || '<div class="msg">Nothing here yet.</div>';
  $('scroll').scrollTop = 0;
}
function cardSong(c, si, i) {
  return `<div class="card-i" data-s="${si}" data-i="${i}">
      <div class="cimg">${c.thumbnail ? `<img loading="lazy" src="${esc(c.thumbnail)}" alt="" />` : '<div class="ph"></div>'}<button class="cplay" data-song="1" title="Play">${ic('play')}</button></div>
      <div class="ct">${esc(c.title)}</div><div class="a">${esc(c.artist)}</div>
    </div>`;
}
function showMessage(title, msg) {
  $('title').textContent = title;
  document.querySelector('.pagehead').style.display = '';
  $('hero').style.setProperty('--hero', heroColor(title));
  $('list').innerHTML = `<div class="msg">${esc(msg)}</div>`;
}

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
const browseDesc = (title, id, params) => ({ title, load: async () => { const p = await unwrap(window.api.browse(id, params)); p.kindLabel = /^MPRE|^OLAK/.test(id) ? 'Album' : id.startsWith('UC') ? 'Artist' : ''; return p; } });
const playlistDesc = (title, id) => ({
  title,
  load: async () => ({ header: { title, subtitle: '', thumbnail: '' }, kindLabel: 'Playlist', sections: [{ title: '', items: await unwrap(window.api.playlist(id)) }] }),
});

const VIEWS = {
  home: () => browseDesc('Home', 'FEmusic_home'),
  explore: () => browseDesc('Explore', 'FEmusic_explore'),
  charts: () => browseDesc('Charts', 'FEmusic_charts'),
  newreleases: () => browseDesc('New releases', 'FEmusic_new_releases_albums'),
  moods: () => browseDesc('Moods & genres', 'FEmusic_moods_and_genres'),
  history: () => browseDesc('History', 'FEmusic_history'),
  liked: () => playlistDesc('Liked songs', 'LM'),
  stats: () => ({
    title: 'Stats',
    load: async () => {
      const d = await unwrap(window.api.stats());
      if (!d.total.plays) return { error: 'No listening yet. Play some songs and your top songs and artists will show up here.' };
      const hrs = (d.total.seconds / 3600).toFixed(1);
      return {
        header: { title: `${d.total.plays} plays · ${hrs} hours`, subtitle: 'Counted on this PC (a song counts after 30 seconds)', thumbnail: '' },
        sections: [
          { title: 'Top songs', items: d.topSongs.map((s) => ({ kind: 'song', id: s.id, title: s.title, artist: `${s.artist} · ${s.plays} plays`, thumbnail: s.thumbnail, duration: 0 })) },
          { title: 'Top artists', items: d.topArtists.map((x) => ({ kind: 'artist-stat', id: x.title, title: x.title, artist: `${x.plays} plays`, thumbnail: '' })) },
        ],
      };
    },
  }),
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

$('list').addEventListener('click', async (e) => {
  const scrollBtn = e.target.closest('[data-scroll]');
  if (scrollBtn) {
    const shelf = scrollBtn.closest('.sechead').nextElementSibling;
    shelf?.scrollBy({ left: Number(scrollBtn.dataset.scroll) * 600 });
    return;
  }
  if (e.target.closest('[data-playall]')) {
    const songs = state.sections.flatMap((s) => s.items).filter((x) => x.kind === 'song');
    if (songs.length) playFromList(songs, songs[Math.floor(Math.random() * songs.length)].id);
    return;
  }
  const el = e.target.closest('.row, .card-i');
  if (!el) return;
  const sec = state.sections[Number(el.dataset.s)];
  const item = sec?.items[Number(el.dataset.i)];
  if (!item) return;
  if (item.kind === 'song') return playFromList(sec.items.filter((x) => x.kind === 'song'), item.id);
  if (item.kind === 'artist-stat') return;
  if (e.target.closest('[data-play]')) {
    // Play button on an album / playlist card: load it and shuffle-play without opening the page.
    setStatus(`Loading ${item.title}…`);
    try {
      const page = item.kind === 'playlist'
        ? { sections: [{ items: await unwrap(window.api.playlist(item.id)) }] }
        : await unwrap(window.api.browse(item.id, item.params));
      const songs = page.sections.flatMap((s) => s.items).filter((x) => (x.kind || 'song') === 'song').map((x) => ({ ...x, kind: 'song' }));
      setStatus('');
      if (songs.length) playFromList(songs, songs[Math.floor(Math.random() * songs.length)].id);
      else setStatus('Nothing playable in that one');
    } catch (err) { setStatus(String(err.message || err).slice(0, 100)); }
    return;
  }
  if (item.kind === 'playlist') return openPage(playlistDesc(item.title, item.id));
  openPage(browseDesc(item.title, item.id, item.params));
});

// Start downloading a song when the pointer rests on it, so clicking it starts sooner.
let hoverTimer = null;
$('list').addEventListener('mouseover', (e) => {
  const el = e.target.closest('.row, .card-i');
  clearTimeout(hoverTimer);
  if (!el) return;
  const item = state.sections[Number(el.dataset.s)]?.items[Number(el.dataset.i)];
  if (!item || item.kind !== 'song') return;
  hoverTimer = setTimeout(() => { window.api.stream(item.id, 'hover'); }, 500);
});
$('list').addEventListener('mouseleave', () => clearTimeout(hoverTimer));

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

// ---------- sidebar library ----------
async function loadSideLibrary(on) {
  const box = $('sidelib');
  if (!on) { box.innerHTML = '<div class="msg" style="padding:8px 10px;font-size:13px">Sign in to see your playlists here.</div>'; return; }
  const r = await window.api.library();
  if (!r.ok || !r.data.length) { box.innerHTML = ''; return; }
  box.innerHTML = r.data.map((p) => `<div class="sl" data-id="${esc(p.id)}" data-title="${esc(p.title)}"><span class="tile">${ic('note')}</span><div class="st"><div class="sn">${esc(p.title)}</div><div class="ss">Playlist${p.count ? ' · ' + esc(p.count) : ''}</div></div></div>`).join('');
}
$('sidelib').addEventListener('click', (e) => {
  const el = e.target.closest('.sl');
  if (el) openRoot(playlistDesc(el.dataset.title, el.dataset.id), '');
});

// ---------- account ----------
async function refreshAccount() {
  const r = await window.api.authStatus();
  const on = r.ok && r.data.signedIn;
  $('account').innerHTML = on ? '<button id="out">Sign out</button>' : '<button id="in">Sign in</button>';
  loadSideLibrary(on);
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
  refreshLike();
  countedFor = null;
  if (!$('lyrics').hidden) loadLyrics(song);
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
audio.addEventListener('play', () => ($('play').innerHTML = ic('pause')));
audio.addEventListener('pause', () => ($('play').innerHTML = ic('play')));
audio.addEventListener('ended', () => {
  if (sleepAfterSong) { sleepIdx = 0; sleepAfterSong = false; updateSleepLabel(); setStatus('Sleep timer: stopped after song'); return; }
  next(true);
});
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
  $('bar').style.setProperty('--p', (audio.currentTime / audio.duration) * 100 + '%');
  $('cur').textContent = fmt(audio.currentTime);
  $('dur').textContent = fmt(audio.duration);
});
let seeking = false;
$('bar').addEventListener('input', () => { seeking = true; });
$('bar').addEventListener('change', () => { if (audio.duration) audio.currentTime = ($('bar').value / 1000) * audio.duration; seeking = false; });
$('vol').addEventListener('input', () => { audio.volume = $('vol').value / 100; $('vol').style.setProperty('--p', $('vol').value + '%'); });
$('vol').style.setProperty('--p', '80%');
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


// ---------- lyrics ----------
let lyricsState = { id: null, lines: [], idx: -1 };
async function loadLyrics(song) {
  if (!song || lyricsState.id === song.id) return;
  lyricsState = { id: song.id, lines: [], idx: -1 };
  $('lyr-body').textContent = 'Loading lyrics…';
  $('lyr-src').textContent = '';
  const r = await window.api.lyrics({ id: song.id, title: song.title, artist: song.artist, duration: song.duration || audio.duration || 0 });
  if (lyricsState.id !== song.id) return;
  if (!r.ok || (!r.data.synced.length && !r.data.plain)) { $('lyr-body').textContent = 'No lyrics found for this song.'; return; }
  $('lyr-src').textContent = r.data.source;
  if (r.data.synced.length) {
    lyricsState.lines = r.data.synced;
    $('lyr-body').innerHTML = r.data.synced.map((l, i) => `<div class="ln" data-i="${i}">${esc(l.text) || '♪'}</div>`).join('');
  } else {
    $('lyr-body').innerHTML = `<div class="plain">${esc(r.data.plain)}</div>`;
  }
}
function syncLyrics() {
  const L = lyricsState.lines;
  if (!L.length || $('lyrics').hidden) return;
  let idx = -1;
  for (let i = 0; i < L.length; i++) { if (L[i].t <= audio.currentTime + 0.25) idx = i; else break; }
  if (idx === lyricsState.idx) return;
  lyricsState.idx = idx;
  document.querySelectorAll('#lyr-body .ln').forEach((el, i) => el.classList.toggle('cur', i === idx));
  document.querySelector('#lyr-body .ln.cur')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
$('lyr').onclick = () => {
  const open = $('lyrics').hidden;
  $('lyrics').hidden = !open;
  $('lyr').classList.toggle('on', open);
  if (open) { lyricsState.id = null; loadLyrics(state.queue[state.index]); }
};
$('lyr-close').onclick = () => { $('lyrics').hidden = true; $('lyr').classList.remove('on'); };
$('lyr-body').addEventListener('click', (e) => {
  const ln = e.target.closest('.ln');
  if (ln && lyricsState.lines[Number(ln.dataset.i)]) audio.currentTime = lyricsState.lines[Number(ln.dataset.i)].t;
});
audio.addEventListener('timeupdate', syncLyrics);
audio.addEventListener('loadedmetadata', () => { if (!$('lyrics').hidden) { lyricsState.id = null; loadLyrics(state.queue[state.index]); } });

// ---------- likes ----------
const liked = new Set();
function refreshLike() {
  const song = state.queue[state.index];
  const on = song && liked.has(song.id);
  $('like').classList.toggle('on', !!on);
}
$('like').onclick = async () => {
  const song = state.queue[state.index];
  if (!song) return;
  const want = !liked.has(song.id);
  want ? liked.add(song.id) : liked.delete(song.id);
  refreshLike();
  const r = await window.api.like(song.id, want);
  if (!r.ok) {
    want ? liked.delete(song.id) : liked.add(song.id);
    refreshLike();
    setStatus(`Couldn't ${want ? 'like' : 'unlike'}: ${r.error.slice(0, 100)}`);
  } else setStatus(want ? 'Added to your liked songs' : 'Removed from liked songs');
};

// ---------- sleep timer ----------
const SLEEP_STEPS = [0, 15, 30, 45, 60, 'song'];
let sleepIdx = 0, sleepEnd = 0, sleepTimer = null, sleepAfterSong = false;
function updateSleepLabel() {
  const btn = $('sleep');
  const step = SLEEP_STEPS[sleepIdx];
  btn.classList.toggle('on', step !== 0);
  $('sleep-txt').textContent = step === 0 ? '' : step === 'song' ? 'end of song' : `${Math.max(0, Math.ceil((sleepEnd - Date.now()) / 60000))} min`;
}
function startSleep() {
  clearInterval(sleepTimer);
  sleepAfterSong = SLEEP_STEPS[sleepIdx] === 'song';
  const step = SLEEP_STEPS[sleepIdx];
  if (typeof step === 'number' && step > 0) sleepEnd = Date.now() + step * 60000;
  updateSleepLabel();
  if (step === 0 || step === 'song') return;
  sleepTimer = setInterval(() => {
    const left = sleepEnd - Date.now();
    if (left <= 10000 && left > 0) audio.volume = Math.max(0, (left / 10000) * ($('vol').value / 100)); // fade out
    if (left <= 0) {
      clearInterval(sleepTimer);
      audio.pause(); audio.volume = $('vol').value / 100;
      sleepIdx = 0; updateSleepLabel(); setStatus('Sleep timer: paused');
    } else updateSleepLabel();
  }, 1000);
}
$('sleep').onclick = () => { sleepIdx = (sleepIdx + 1) % SLEEP_STEPS.length; startSleep(); };

// ---------- stats ----------
let countedFor = null;
audio.addEventListener('timeupdate', () => {
  const song = state.queue[state.index];
  if (song && countedFor !== song.id && audio.currentTime >= 30) {
    countedFor = song.id;
    window.api.recordPlay({ id: song.id, title: song.title, artist: song.artist, thumbnail: song.thumbnail, seconds: audio.duration || 0 });
  }
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
