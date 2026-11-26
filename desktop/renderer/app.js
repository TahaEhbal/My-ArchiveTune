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

// App logos (the same community pack as the phone app's icon picker).
const APP_ICONS = [["5847", "Sakura", "morieeattonkatsu"], ["104570", "Marin Kitagawa", "raspweed"], ["950492", "Frostwave - Japanese Winter", "Animesh"], ["417667", "Suzume", "Animesh"], ["152487", "Sakura Retro", "morrieeattonkatsu"], ["944391", "pixelart", "BunglonMewing"], ["454033", "Kanade Tune", "BunglonMewing"], ["801991", "Hatsune Miku", "ValteMCPE"], ["720714", "Kawaiitune", "cognitiveshadows03"], ["207115", "Depth", "cognitiveshadows03"], ["692860", "Neon Vibes", "ValteMCPE"], ["712543", "AT6", "DougAlvarenga"], ["955439", "Minecraft", "BunglonMewing"], ["934989", "Ramadhan", "BunglonMewing"], ["399860", "Minecraft Sakura", "Sucuboy_u"]];

// ---------- theme ----------
let theme = { accent: '#b388ff', dynamic: false };
try { theme = { ...theme, ...JSON.parse(localStorage.getItem('theme') || '{}') }; } catch { /* defaults */ }
const saveTheme = () => { try { localStorage.setItem('theme', JSON.stringify(theme)); } catch { /* ignore */ } };
function rgbToAccent([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return `hsl(${Math.round(h)}, ${Math.round(Math.max(s, 0.55) * 100)}%, 68%)`;
}
function applyAccent(color) {
  document.documentElement.style.setProperty('--accent', color);
  document.documentElement.style.setProperty('--accent2', color);
}
async function accentFromArt(url) {
  if (!url) return;
  const r = await window.api.artColor(url);
  if (r.ok && r.data && theme.dynamic) applyAccent(rgbToAccent(r.data));
}
applyAccent(theme.accent);

// ---------- rendering ----------
state.sections = [];
const downloaded = new Set();
const refreshDownloaded = async () => { const r = await window.api.dlIds(); if (r.ok) { downloaded.clear(); r.data.forEach((x) => downloaded.add(x)); } updateTiles(); };
function setTile(id, url) {
  const t = $(id);
  if (!t) return;
  const icon = id === 'tile-dl' ? 'download' : 'queue';
  t.innerHTML = url ? `<img src="${esc(url)}" alt="" />` : ic(icon);
}
async function updateTiles() {
  const d = await window.api.dlList();
  const first = d.ok ? (d.data.downloaded[0] || d.data.cached[0]) : null;
  setTile('tile-dl', first?.thumbnail);
  setTile('tile-q', state.queue[Math.max(0, state.index)]?.thumbnail);
}
const KIND_LABEL = { album: 'Album', artist: 'Artist', playlist: 'Playlist', mood: '', page: '' };

// Image sharpness: covers are requested small by default. sharp() = good for lists/cards, big() = full-screen
// sizes. If a bigger variant doesn't exist, the <img> error handler below falls back to a smaller one.
const sharp = (u) => String(u || '')
  .replace(/=w\d+-h\d+[^?&#\s]*/, '=w544-h544-l90-rj')
  .replace(/=s\d+[^?&#\s]*/, '=s544')
  .replace(/(i\.ytimg\.com\/vi(?:_webp)?\/[\w-]{11}\/)(?:default|mqdefault|hqdefault|sddefault|hq720|\d)\.(jpg|webp)\S*/, '$1hqdefault.$2');
const big = (u) => sharp(u)
  .replace(/=w544-h544-l90-rj/, '=w1200-h1200-l90-rj')
  .replace(/=s544/, '=s1200')
  .replace(/(i\.ytimg\.com\/vi(?:_webp)?\/[\w-]{11}\/)hqdefault\.(jpg|webp)/, '$1maxresdefault.$2');
document.addEventListener('error', (e) => {
  const t = e.target;
  if (!t || t.tagName !== 'IMG' || !t.src) return;
  const prev = t.src;
  if (/maxresdefault/.test(prev)) t.src = prev.replace('maxresdefault', 'hqdefault');
  else if (/=w1200-h1200/.test(prev)) t.src = prev.replace('=w1200-h1200', '=w544-h544');
  else if (/=s1200/.test(prev)) t.src = prev.replace('=s1200', '=s544');
}, true);
const ic = (name) => `<svg class="i"><use href="#i-${name}"/></svg>`;
function rowHtml(s, si, i, cur) {
  return `<div class="row${s.id === cur ? ' playing' : ''}" data-s="${si}" data-i="${i}">
      <div class="n"><span>${i + 1}</span>${ic('play')}</div>
      <div class="m">${s.thumbnail ? `<img loading="lazy" src="${esc(s.thumbnail)}" alt="" />` : phHtml(s.title, 'note')}<div style="min-width:0"><div class="t">${esc(s.title)}</div><div class="a">${esc(s.artist)}</div></div></div>
      <div class="d">${downloaded.has(s.id) ? `<span class="dlmark" title="Downloaded">${ic('check')}</span>` : ''}${s.duration ? fmt(s.duration) : ''}</div>
    </div>`;
}
function cardHtml(c, si, i) {
  const playable = c.kind === 'album' || c.kind === 'playlist' || c.kind === 'mix';
  return `<div class="card-i" data-s="${si}" data-i="${i}">
      <div class="cimg">${c.thumbnail ? `<img loading="lazy" src="${esc(c.thumbnail)}" alt="" class="${c.kind === 'artist' ? 'round' : ''}" />` : phHtml(c.title, c.kind === 'artist' ? 'user' : c.kind === 'playlist' ? 'queue' : 'disc')}
      ${playable ? `<button class="cplay" data-play="1" title="Play">${ic('play')}</button>` : ''}</div>
      <div class="ct">${esc(c.title)}</div><div class="a">${esc(c.artist || KIND_LABEL[c.kind] || '')}</div>
    </div>`;
}
const phHtml = (text, icon) => `<div class="ph" style="background:linear-gradient(135deg, ${heroColor(text)}, #17131f)">${ic(icon)}</div>`;
function heroColor(text) {
  let h = 0;
  for (const ch of String(text || 'x')) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h}, 48%, 24%)`;
}
function renderPage(title, page, keepScroll) {
  state.sections = page.sections || [];
  state.pageTools = null;
  clearSelection();
  state.sections.forEach((s) => (s.items || []).forEach((it) => { if (it.thumbnail) it.thumbnail = sharp(it.thumbnail); }));
  if (page.header?.thumbnail) page.header.thumbnail = big(page.header.thumbnail);
  $('title').textContent = page.header?.title ? '' : title;
  document.querySelector('.pagehead').style.display = page.header?.title ? 'none' : '';
  $('hero').style.setProperty('--hero', heroColor(page.header?.title || title));
  const cur = state.queue[state.index]?.id;
  let html = '';
  if (page.html) { $('list').innerHTML = page.html; if (!keepScroll) $('scroll').scrollTop = 0; return; }
  const allSongs = state.sections.flatMap((s) => s.items).filter((x) => (x.kind || 'song') === 'song');
  if (page.header?.title) {
    if (!page.header.thumbnail) page.header.thumbnail = big(allSongs.find((s) => s.thumbnail)?.thumbnail || '');
    html += `<div class="phead">${page.header.thumbnail ? `<img src="${esc(page.header.thumbnail)}" alt="" />` : ''}<div><div class="pk">${esc(page.kindLabel || '')}</div><div class="pt">${esc(page.header.title)}</div><div class="a">${esc(page.header.subtitle || '')}</div></div></div>`;
  }
  if (allSongs.length && (page.header?.title || state.sections.length === 1)) {
    html += `<div class="actions"><button class="bigplay" data-playall="1" title="Shuffle play">${ic('play')}</button><button class="pill" data-dlall="1" title="Save these songs for offline">${ic('download')} Download</button>${page.syncable ? `<button class="pill" data-refresh="1" title="Build a fresh list">${ic('repeat')} Refresh</button><button class="pill" data-sync="1" title="Create or update this playlist on your YouTube account">${ic('sync')} Sync to my account</button>` : ''}<span class="hint">${allSongs.length} songs</span></div>`;
  }
  state.sections.forEach((sec, si) => {
    const items = sec.items.map((it) => ({ ...it, kind: it.kind || 'song' }));
    sec.items = items;
    const songs = items.filter((x) => x.kind === 'song');
    if (sec.quick) {
      html += `<div class="quick">${sec.quick.map((q) => `<div class="qt" ${q.view ? `data-qv="${esc(q.view)}"` : `data-qpl="${esc(q.id)}" data-qtitle="${esc(q.title)}"`}><span class="qimg${q.grad ? ' ' + q.grad : ''}">${q.thumbnail ? `<img src="${esc(q.thumbnail)}" alt="" />` : ic(q.icon || 'note')}</span><span class="qn">${esc(q.title)}</span></div>`).join('')}</div>`;
      return;
    }
    if (sec.title) {
      const shelf = sec.shelf || (songs.length !== items.length && items.length > 5);
      html += `<div class="sechead"><h3 class="sec">${esc(sec.title)}</h3>${sec.more ? `<button class="pill small" data-goview="${esc(sec.more.view)}">${esc(sec.more.label)}</button>` : ''}${shelf ? `<div class="arrows"><button data-scroll="-1" title="Back">${ic('left')}</button><button data-scroll="1" title="Next">${ic('right')}</button></div>` : ''}</div>`;
    }
    if (page.tools && si === 0 && songs.length === items.length && items.length > 1) {
      state.pageTools = { orig: items, sort: 'default', q: '' };
      html += `<div class="ptools"><label class="pfind">${ic('search')}<input id="pfilter" placeholder="Find in this playlist" /></label><span class="psort">Sort: ${[['default', 'Default'], ['title', 'Title'], ['artist', 'Artist'], ['dur', 'Length']].map(([k, l]) => `<button class="pill small${k === 'default' ? ' on' : ''}" data-sort="${k}">${l}</button>`).join('')}</span><span class="hint">Ctrl/Shift-click to select several</span></div><div id="rows">${items.map((s, i) => rowHtml(s, si, i, cur)).join('')}</div>`;
    } else if (songs.length === items.length && !sec.shelf) html += items.map((s, i) => rowHtml(s, si, i, cur)).join('');
    else html += `<div class="shelf">${items.map((c, i) => (c.kind === 'song' ? cardSong(c, si, i) : cardHtml(c, si, i))).join('')}</div>`;
  });
  $('list').innerHTML = html || '<div class="msg">Nothing here yet.</div>';
  if (!keepScroll) $('scroll').scrollTop = 0;
  if (nav.current?.id === 'queue') {
    document.querySelectorAll('#list .row').forEach((r, n) => { if (n > 0) r.draggable = true; }); // the playing song stays on top
  }
}
function cardSong(c, si, i) {
  return `<div class="card-i" data-s="${si}" data-i="${i}">
      <div class="cimg">${c.thumbnail ? `<img loading="lazy" src="${esc(c.thumbnail)}" alt="" />` : phHtml(c.title, 'note')}<button class="cplay" data-song="1" title="Play">${ic('play')}</button></div>
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
  if (desc.after) {
    // Slow extras (like Recommended) load after the page is already visible, then slot in at the top.
    desc.after(page).then((sec) => {
      if (!sec || nav.current !== desc) return;
      page.sections.unshift(...[].concat(sec));
      renderPage(page.title || desc.title, page, true);
    }).catch((e) => console.error('after failed', e));
  }
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
  playlistId: id,
  load: async () => ({ tools: true, header: { title, subtitle: '', thumbnail: '' }, kindLabel: 'Playlist', sections: [{ title: '', items: await unwrap(window.api.playlist(id)) }] }),
});

const VIEWS = {
  home: () => {
    const h = new Date().getHours();
    const d = browseDesc(h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening', 'FEmusic_home');
    d.after = async () => {
      const auth = await window.api.authStatus();
      if (!auth.ok || !auth.data.signedIn) return null;
      const [rec, lib, dl] = await Promise.all([window.api.recommended(), window.api.library(), window.api.dlList()]);
      const out = [];
      const lists = lib.ok ? lib.data.filter((p) => !isLikedList(p)) : [];
      const quick = [{ view: 'liked', title: 'Liked songs', icon: 'heart', grad: 't-like' }];
      const dlFirst = dl.ok ? (dl.data.downloaded[0] || dl.data.cached[0]) : null;
      quick.push({ view: 'downloads', title: 'Downloads', icon: 'download', thumbnail: dlFirst?.thumbnail });
      if (rec.ok && rec.data.songs?.length) quick.push({ view: 'recommended', title: 'Recommended for you', icon: 'sync', grad: 't-rec' });
      lists.slice(0, 5).forEach((p) => quick.push({ id: p.id, title: p.title, thumbnail: p.thumbnail, icon: 'queue' }));
      out.push({ quick, items: [] });
      try { const mixes = await buildMixes(); if (mixes.length) out.push({ title: 'Made for you', shelf: true, items: mixes }); } catch { /* optional */ }
      if (rec.ok && rec.data.songs?.length) out.push({ title: 'Recommended for you', shelf: true, more: { label: 'Show all', view: 'recommended' }, items: rec.data.songs.slice(0, 24) });
      if (lists.length) out.push({ title: 'Your playlists', shelf: true, items: lists.map((p) => ({ kind: 'playlist', id: p.id, title: p.title, artist: p.count ? `Playlist · ${p.count}` : 'Playlist', thumbnail: p.thumbnail })) });
      const recent = dl.ok ? [...dl.data.cached, ...dl.data.downloaded].sort((x, y) => (y.at || 0) - (x.at || 0)).slice(0, 20) : [];
      if (recent.length) out.push({ title: 'Recently played', shelf: true, more: { label: 'Show all', view: 'downloads' }, items: recent.map((s) => ({ kind: 'song', id: s.id, title: s.title || s.id, artist: s.artist || '', thumbnail: s.thumbnail || '', duration: s.duration || 0, artistId: s.artistId, albumId: s.albumId })) });
      return out;
    };
    return d;
  },
  explore: () => {
    const d = browseDesc('Explore', 'FEmusic_explore');
    const inner = d.load;
    d.load = async () => {
      const p = await inner();
      // The big "New releases / Charts / Moods" buttons are replaced by a real New releases shelf below.
      p.sections = (p.sections || []).map((s) => ({ ...s, items: s.items.filter((i) => !(i.kind === 'mood' && /moods|genres|new releases|charts/i.test(i.title))) })).filter((s) => s.items.length);
      return p;
    };
    d.after = async () => {
      const np = await unwrap(window.api.browse('FEmusic_new_releases_albums'));
      const sec = (np.sections || []).find((s) => s.items.some((i) => i.kind === 'album')) || (np.sections || [])[0];
      return sec ? { title: 'New releases', shelf: true, items: sec.items.filter((i) => i.kind !== 'mood') } : null;
    };
    return d;
  },
  charts: () => browseDesc('Charts', 'FEmusic_charts'),
  history: () => browseDesc('History', 'FEmusic_history'),
  liked: () => {
    const d = playlistDesc('Liked songs', 'LM');
    const inner = d.load;
    d.load = async () => { const p = await inner(); p.sections.forEach((s) => s.items.forEach((x) => liked.add(x.id))); return p; };
    return d;
  },
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
  downloads: () => ({
    title: 'Downloads',
    load: async () => {
      await refreshDownloaded();
      const d = await unwrap(window.api.dlList());
      const mk = (s) => ({ kind: 'song', id: s.id, title: s.title || s.id, artist: s.artist || '', thumbnail: s.thumbnail || '', duration: s.duration || 0, artistId: s.artistId, albumId: s.albumId });
      const sections = [];
      if (d.downloaded.length) sections.push({ title: `Downloaded · ${(d.downloaded.reduce((n, s) => n + s.size, 0) / 1048576).toFixed(0)} MB`, items: d.downloaded.map(mk) });
      if (d.cached.length) sections.push({ title: 'Played recently (saved automatically)', items: d.cached.map(mk) });
      if (!sections.length) return { error: 'Nothing saved yet. Right-click a song and choose Download, or press Download on any album or playlist. Songs you play are also kept here automatically, so they work offline.' };
      return { sections };
    },
  }),
  queue: () => ({ id: 'queue', title: 'Queue (always shuffled)', load: async () => ({ sections: [{ title: '', items: state.queue.slice(Math.max(0, state.index)) }] }) }),
  library: () => ({
    title: 'Library',
    load: async () => {
      const lists = (await unwrap(window.api.library())).filter((p) => !isLikedList(p));
      if (!lists.length) return { error: 'No playlists found. Sign in (bottom left) to see your playlists.' };
      return { sections: [{ title: 'Playlists', items: lists.map((p) => ({ kind: 'playlist', id: p.id, title: p.title, artist: p.count, thumbnail: p.thumbnail || '' })) }] };
    },
  }),
  recommended: () => ({
    title: 'Recommended for you',
    loading: 'Building your list from "the main playlist"…',
    load: async function () {
      const d = await unwrap(window.api.recommended(this.force));
      this.force = false;
      if (d.error) return { error: d.error };
      return { title: `Recommended for you (${d.songs.length})`, syncable: true, sections: [{ title: '', items: d.songs }] };
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
  const goView = e.target.closest('[data-goview]');
  if (goView) return show(goView.dataset.goview);
  if (e.target.closest('[data-refresh]')) { nav.current.force = true; return openPage(nav.current, false); }
  if (e.target.closest('[data-dlall]')) {
    const songs = state.sections.flatMap((s) => s.items).filter((x) => x.kind === 'song');
    return downloadMany(songs);
  }
  if (e.target.closest('[data-sync]')) {
    const songs = state.sections.flatMap((s) => s.items).filter((x) => x.kind === 'song');
    setStatus('Syncing to your account…');
    const r = await window.api.syncRecommended(songs.map(metaOf));
    setStatus('');
    if (!r.ok) return toast(`Couldn't sync: ${r.error.slice(0, 100)}`);
    toast(r.data.created ? `Created "Recommended for you" on your account (${r.data.added} songs)` : `Synced: ${r.data.added} added, ${r.data.removed} removed`);
    loadSideLibrary(true);
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

// Drag rows to reorder the queue.
let dragFrom = null;
$('list').addEventListener('dragstart', (e) => {
  const row = e.target.closest('.row');
  if (!row || nav.current?.id !== 'queue') return;
  dragFrom = Number(row.dataset.i);
  row.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
});
$('list').addEventListener('dragover', (e) => {
  const row = e.target.closest('.row');
  if (dragFrom === null || !row) return;
  e.preventDefault();
  document.querySelectorAll('.dropbefore, .dropafter').forEach((x) => x.classList.remove('dropbefore', 'dropafter'));
  const r = row.getBoundingClientRect();
  row.classList.add(e.clientY < r.top + r.height / 2 ? 'dropbefore' : 'dropafter');
});
$('list').addEventListener('drop', (e) => {
  const row = e.target.closest('.row');
  if (dragFrom === null || !row) return;
  e.preventDefault();
  const r = row.getBoundingClientRect();
  let to = Number(row.dataset.i) + (e.clientY < r.top + r.height / 2 ? 0 : 1);
  const off = Math.max(0, state.index);
  const [moved] = state.queue.splice(off + dragFrom, 1);
  if (dragFrom < to) to--;
  state.queue.splice(off + Math.max(1, to), 0, moved); // never above the playing song
  dragFrom = null;
  openPage(nav.current, false);
});
$('list').addEventListener('dragend', () => {
  dragFrom = null;
  document.querySelectorAll('.dragging, .dropbefore, .dropafter').forEach((x) => x.classList.remove('dragging', 'dropbefore', 'dropafter'));
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
      load: async () => {
        let secs = [];
        try { secs = await unwrap(window.api.searchAll(q)); } catch { /* fall back to plain song search */ }
        secs = (secs || []).filter((s) => s.items?.length);
        if (!secs.length) secs = [{ title: '', items: await unwrap(window.api.search(q)) }];
        return { sections: secs };
      },
    }, '');
  }, 350);
});
$('q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(searchTimer); $('q').dispatchEvent(new Event('input')); } });

const isLikedList = (p) => p.id === 'LM' || /^(liked music|your likes?|liked songs)$/i.test(String(p.title).trim());
// ---------- sidebar library ----------
async function loadSideLibrary(on) {
  const box = $('sidelib');
  if (!on) { box.innerHTML = '<div class="msg" style="padding:8px 10px;font-size:13px">Sign in to see your playlists here.</div>'; return; }
  const r = await window.api.library();
  if (r.ok) r.data = r.data.filter((p) => !isLikedList(p));
  if (!r.ok || !r.data.length) { box.innerHTML = ''; return; }
  box.innerHTML = r.data.map((p) => `<div class="sl" data-id="${esc(p.id)}" data-title="${esc(p.title)}"><span class="tile">${p.thumbnail ? `<img loading="lazy" src="${esc(p.thumbnail)}" alt="" />` : ic('note')}</span><div class="st"><div class="sn">${esc(p.title)}</div><div class="ss">Playlist${p.count ? ' · ' + esc(p.count) : ''}</div></div></div>`).join('');
}
$('sidelib').addEventListener('click', (e) => {
  const el = e.target.closest('.sl');
  if (el) openRoot(playlistDesc(el.dataset.title, el.dataset.id), '');
});

// ---------- account ----------
const cogDot = () => (state.update?.state === 'ready' ? '<span class="dot"></span>' : '');
async function refreshAccount() {
  const r = await window.api.authStatus();
  const on = r.ok && r.data.signedIn;
  state.signedIn = on;
  const cog = `<button class="round" id="fsbtn" title="Full screen (F11)">${ic('win')}</button><button class="round" id="cog" title="Settings">${ic('cog')}${cogDot()}</button>`;
  if (!on) {
    $('account').innerHTML = `<button class="signin" id="in">Sign in</button>${cog}`;
    $('in').onclick = async () => { setStatus('Signing in…'); await window.api.login(); await refreshAccount(); show(state.view || 'home'); };
  } else {
    $('account').innerHTML = `<button class="round" id="me" title="Account">${ic('user')}</button>${cog}`;
    $('me').onclick = (e) => {
      const b = e.currentTarget.getBoundingClientRect();
      showMenu(b.right - 230, b.bottom + 6, [
        { header: state.account?.name || 'Your YouTube account' },
        { label: 'Settings', icon: 'cog', action: () => openRoot(VIEWS.settings(), '') },
        { sep: true },
        { label: 'Sign out', icon: 'left', danger: true, action: signOut },
      ]);
    };
    window.api.accountInfo().then((ai) => {
      if (!ai.ok) return;
      state.account = ai.data;
      const me = $('me');
      if (me && ai.data.photo) me.innerHTML = `<img src="${esc(ai.data.photo)}" alt="" />`;
      else if (me && ai.data.name) me.textContent = ai.data.name.trim()[0].toUpperCase();
      if (nav.current?.id === 'settings') renderSettings();
    });
  }
  $('cog').onclick = () => openRoot(VIEWS.settings(), '');
  $('fsbtn').onclick = () => window.api.toggleFullscreen();
  loadSideLibrary(on);
}
async function signOut() { await window.api.logout(); state.account = null; await refreshAccount(); show('home'); }

// ---------- settings ----------
async function settingsHtml() {
  const [ver, st, dl] = await Promise.all([window.api.version(), window.api.getSettings(), window.api.dlList()]);
  const u = state.update || {};
  const ustate = u.state === 'downloading' ? `Downloading ${u.version} (${u.mb} MB)…` : u.state === 'ready' ? `Update ${u.version} is ready` : u.state === 'error' ? `Check failed: ${esc(String(u.message || '').slice(0, 80))}` : u.state === 'uptodate' ? "You're on the latest version" : 'Updates download in the background';
  const mb = (list) => (list.reduce((n, s) => n + s.size, 0) / 1048576).toFixed(0);
  const saved = dl.ok ? mb(dl.data.downloaded) : '0', cached = dl.ok ? mb(dl.data.cached) : '0';
  const acc = state.account || {};
  const me = state.signedIn
    ? `<div class="line">${acc.photo ? `<img class="av" src="${esc(acc.photo)}" alt="" />` : `<div class="av">${esc((acc.name || '?').trim()[0]?.toUpperCase() || '?')}</div>`}<div class="l"><div>${esc(acc.name || 'Signed in')}</div><div class="s">Same YouTube account as your phone</div></div><button class="ghost" data-set="signout">Sign out</button></div>`
    : `<div class="line"><div class="l"><div>Not signed in</div><div class="s">Sign in to see your playlists and likes</div></div><button class="go" data-set="signin">Sign in</button></div>`;
  return `<div class="set">
    <h3>Account</h3><div class="box">${me}</div>
    <h3>Updates</h3><div class="box"><div class="line"><div class="l"><div>ArchiveTune Desktop ${ver.ok ? 'v' + esc(ver.data) : ''}</div><div class="s">${ustate}</div></div>${u.state === 'ready' ? '<button class="go" data-set="restart">Restart to update</button>' : '<button data-set="check">Check for updates</button>'}</div></div>
    <h3>App icon</h3><div class="box"><div class="iconpick">
      <button class="iconopt${!st.ok || !st.data.icon ? ' on' : ''}" data-set="icon:" title="Default"><img src="../assets/icon.png" alt="" /><span>Default</span></button>
      ${APP_ICONS.map(([id, name, by]) => `<button class="iconopt${st.ok && st.data.icon === id ? ' on' : ''}" data-set="icon:${id}" title="${esc(name)} by ${esc(by)}"><img src="../assets/icons/${id}.png" alt="" loading="lazy" /><span>${esc(name)}</span></button>`).join('')}
    </div><div class="s" style="padding:0 0 12px">Changes the window, taskbar and tray icon. The .exe file keeps its original icon.</div></div>
    <h3>Appearance</h3><div class="box">
      <div class="line"><div class="l"><div>Accent colour</div><div class="s">Buttons, highlights and toggles</div></div><div class="swatches">${['#b388ff', '#1ed760', '#4aa3ff', '#ff6b9a', '#ff9f43', '#ff5a5f'].map((c) => `<button class="swatch${!theme.dynamic && theme.accent === c ? ' on' : ''}" style="background:${c}" data-set="accent:${c}" title="${c}"></button>`).join('')}</div></div>
      <div class="line"><div class="l"><div>Match the album art</div><div class="s">The accent colour follows the song that's playing</div></div><div class="sw${theme.dynamic ? ' on' : ''}" data-set="dyn"></div></div>
      <div class="line"><div class="l"><div>Crossfade</div><div class="s">Blend songs into each other (songs already saved on this PC)</div></div><div class="seg">${[0, 3, 6, 9, 12].map((n) => `<button class="${xfade === n ? 'on' : ''}" data-set="xf:${n}">${n ? n + 's' : 'Off'}</button>`).join('')}</div></div>
    </div>
    <h3>App</h3><div class="box">
      <div class="line"><div class="l"><div>Keep playing in the tray</div><div class="s">Closing the window hides the app instead of quitting</div></div><div class="sw${st.ok && st.data.closeToTray ? ' on' : ''}" data-set="tray"></div></div>
      <div class="line"><div class="l"><div>Start with Windows</div><div class="s">Opens quietly in the tray when you sign in to your PC</div></div><div class="sw${st.ok && st.data.startWithWindows ? ' on' : ''}" data-set="autostart"></div></div>
      <div class="line"><div class="l"><div>Always on top</div><div class="s">Keep the window above everything else</div></div><div class="sw${st.ok && st.data.alwaysOnTop ? ' on' : ''}" data-set="top"></div></div>
      <div class="line"><div class="l"><div>Mini player</div><div class="s">A small floating player. Press its corner button to come back</div></div><button data-set="mini">Open</button></div>
    </div>
    <h3>Storage</h3><div class="box"><div class="line"><div class="l"><div>Downloads</div><div class="s">${saved} MB saved for offline</div></div></div><div class="line"><div class="l"><div>Recently played</div><div class="s">${cached} MB kept automatically</div></div><button class="ghost" data-set="clear">Clear</button></div></div>
  </div>`;
}
async function renderSettings() { if (nav.current?.id === 'settings') $('list').innerHTML = await settingsHtml(); }
VIEWS.settings = () => ({ id: 'settings', title: 'Settings', load: async () => ({ html: await settingsHtml() }) });
$('list').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-set]');
  if (!b) return;
  const k = b.dataset.set;
  if (k === 'signout') return signOut();
  if (k === 'signin') { await window.api.login(); await refreshAccount(); return show('home'); }
  if (k === 'restart') return window.api.restart();
  if (k === 'check') { state.update = { state: 'downloading', version: '…', mb: '' }; state.update = {}; window.api.checkUpdate(); toast('Checking for updates…'); return; }
  if (k === 'tray') { const st = await window.api.getSettings(); await window.api.setSettings({ closeToTray: !(st.ok && st.data.closeToTray) }); return renderSettings(); }
  if (k === 'clear') { await window.api.clearCache(); toast('Cleared'); return renderSettings(); }
  if (k === 'autostart' || k === 'top') {
    const st = await window.api.getSettings();
    const key = k === 'top' ? 'alwaysOnTop' : 'startWithWindows';
    await window.api.setSettings({ [key]: !(st.ok && st.data[key]) });
    return renderSettings();
  }
  if (k === 'mini') return window.api.toggleMini();
  if (k.startsWith('icon:')) { await window.api.setSettings({ icon: k.slice(5) }); toast('Icon changed'); return renderSettings(); }
  if (k === 'dyn') { theme.dynamic = !theme.dynamic; saveTheme(); if (theme.dynamic) accentFromArt(state.queue[state.index]?.thumbnail); else applyAccent(theme.accent); return renderSettings(); }
  if (k.startsWith('accent:')) { theme.accent = k.slice(7); theme.dynamic = false; saveTheme(); applyAccent(theme.accent); return renderSettings(); }
  if (k.startsWith('xf:')) { xfade = Number(k.slice(3)); try { localStorage.setItem('xfade', String(xfade)); } catch { /* ignore */ } return renderSettings(); }
});

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

const metaOf = (s) => ({ id: s.id, title: s.title, artist: s.artist, thumbnail: s.thumbnail, duration: s.duration, artistId: s.artistId, albumId: s.albumId });
async function urlFor(song, prio = 'user') {
  const r = await window.api.stream(song.id, prio, metaOf(song));
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

// Start playing while the song is still downloading; when the download finishes, swap to the saved file
// (same position) so seeking works. If the live stream can't start, wait for the full download instead.
let liveStarting = false;
const durOf = () => (Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (state.queue[state.index]?.duration || 0));
async function startAudio(song) {
  const r = await window.api.streamLive(song.id, metaOf(song));
  if (!r.ok) throw new Error(r.error);
  if (!r.data.live) { audio.src = r.data.url; await audio.play(); return; }
  liveStarting = true;
  try {
    audio.src = r.data.url;
    await Promise.race([audio.play(), new Promise((_, rej) => setTimeout(() => rej(new Error('live start timed out')), 60000))]);
  } catch (e) {
    if (state.queue[state.index]?.id !== song.id) { liveStarting = false; return; }
    const file = await urlFor(song); // waits for the whole download; throws the real error if it failed
    audio.src = file;
    await audio.play();
    liveStarting = false;
    return;
  }
  liveStarting = false;
  urlFor(song).then((file) => {
    if (state.queue[state.index]?.id !== song.id || audio.src === file) return;
    const t = Math.max(audio.currentTime, typeof takeResume === 'function' ? takeResume(song.id) : 0), playing = !audio.paused;
    audio.src = file;
    audio.addEventListener('loadedmetadata', () => { audio.currentTime = t; if (playing) audio.play().catch(() => {}); }, { once: true });
  }).catch(() => {});
}

// ---------- crossfade ----------
let xfade = Number((() => { try { return localStorage.getItem('xfade'); } catch { return 0; } })()) || 0; // seconds, 0 = off
let xf = null;
const userVol = () => $('vol').value / 100;
function cancelCrossfade() {
  if (!xf) return;
  clearInterval(xf.timer);
  try { xf.el?.pause(); if (xf.el) xf.el.src = ''; } catch { /* gone */ }
  xf = null;
  audio.volume = userVol();
}
async function startCrossfade(song, ni) {
  const mine = (xf = { ni, song, el: null, timer: null });
  try {
    const r = await window.api.streamLive(song.id, metaOf(song));
    if (xf !== mine || !r.ok || r.data.live) { if (xf === mine) xf = null; return; } // only crossfade into songs already saved on disk
    const el = new Audio(r.data.url);
    el.volume = 0;
    await el.play();
    if (xf !== mine) { el.pause(); return; }
    mine.el = el;
    const t0 = performance.now(), span = Math.max(1, xfade - 0.4) * 1000;
    mine.timer = setInterval(() => {
      if (xf !== mine) return clearInterval(mine.timer);
      const p = Math.min(1, (performance.now() - t0) / span);
      audio.volume = userVol() * (1 - p);
      el.volume = userVol() * p;
      if (p >= 1) finishCrossfade();
    }, 80);
  } catch { if (xf === mine) xf = null; }
}
function finishCrossfade() {
  if (!xf || !xf.el) return;
  const { el, ni, song, timer } = xf;
  clearInterval(timer);
  const t = el.currentTime;
  state.history.push(state.index);
  state.index = ni;
  showSong(song);
  highlight();
  failStreak = 0;
  const url = el.src;
  audio.volume = userVol();
  audio.src = url;
  audio.addEventListener('loadedmetadata', () => {
    audio.currentTime = t + 0.12;
    audio.play().then(() => { el.pause(); el.src = ''; xf = null; preloadAhead(); }).catch(() => { xf = null; });
  }, { once: true });
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: song.title, artist: song.artist, artwork: song.thumbnail ? [{ src: song.thumbnail }] : [] });
}
function maybeCrossfade() {
  if (!xfade || xf || repeatMode === 'one' || !audio.duration || !Number.isFinite(audio.duration) || audio.duration < xfade * 2 + 6) return;
  if (audio.duration - audio.currentTime > xfade) return;
  let ni = state.index + 1;
  while (ni < state.queue.length && state.failed.has(state.queue[ni].id)) ni++;
  if (ni >= state.queue.length) return;
  startCrossfade(state.queue[ni], ni);
}
audio.addEventListener('timeupdate', maybeCrossfade);

function showSong(song) {
  $('np-title').textContent = song.title;
  $('np-artist').textContent = song.artist;
  if (song.thumbnail) song.thumbnail = sharp(song.thumbnail);
  $('art').src = song.thumbnail || '';
  setTile('tile-q', song.thumbnail);
  if (typeof fullFill === 'function') fullFill();
  updateOffsetLabels();
  document.title = `${song.title} · ArchiveTune`;
  highlight();
  refreshLike();
  countedFor = null;
  if (!$('lyrics').hidden) loadLyrics(song);
  if (theme.dynamic) accentFromArt(song.thumbnail);
}
async function playCurrent() {
  const song = state.queue[state.index];
  if (!song) return;
  cancelCrossfade();
  showSong(song);
  try {
    setStatus('Loading song…');
    await startAudio(song);
    setStatus('');
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

// ---------- repeat ----------
let repeatMode = 'all'; // all = loop the (reshuffled) queue, one = repeat the song, off = stop at the end
const REPEAT_TITLES = { all: 'Repeat: loop the queue', one: 'Repeat: this song', off: 'Repeat: off (stop at the end)' };
$('repeat').onclick = () => {
  repeatMode = repeatMode === 'all' ? 'one' : repeatMode === 'one' ? 'off' : 'all';
  $('repeat').classList.toggle('on', repeatMode !== 'off');
  $('rep1').textContent = repeatMode === 'one' ? '1' : '';
  $('repeat').title = REPEAT_TITLES[repeatMode];
  toast(REPEAT_TITLES[repeatMode]);
};

// ---------- controls ----------
const togglePlay = () => {
  if (!audio.src && state.queue[state.index]) return resumeRestored();
  return audio.paused ? audio.play() : audio.pause();
};
$('play').onclick = togglePlay;
$('next').onclick = () => next(false);
$('prev').onclick = prev;
audio.addEventListener('play', () => ($('play').innerHTML = ic('pause')));
audio.addEventListener('pause', () => ($('play').innerHTML = ic('play')));
audio.addEventListener('ended', () => {
  if (xf) { if (xf.el) finishCrossfade(); return; }
  if (repeatMode === 'one') { audio.currentTime = 0; audio.play(); return; }
  if (repeatMode === 'off' && state.index + 1 >= state.queue.length) { setStatus('Reached the end of the queue'); return; }
  if (sleepAfterSong) { sleepIdx = 0; sleepAfterSong = false; updateSleepLabel(); setStatus('Sleep timer: stopped after song'); return; }
  next(true);
});
audio.addEventListener('error', () => {
  if (liveStarting) return;
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
  const dur = durOf();
  if (!dur || seeking) return;
  $('bar').value = Math.min(1000, (audio.currentTime / dur) * 1000);
  $('bar').style.setProperty('--p', Math.min(100, (audio.currentTime / dur) * 100) + '%');
  $('cur').textContent = fmt(audio.currentTime);
  $('dur').textContent = fmt(dur);
});
let seeking = false;
$('bar').addEventListener('input', () => { seeking = true; });
$('bar').addEventListener('change', () => { if (durOf()) audio.currentTime = ($('bar').value / 1000) * durOf(); seeking = false; });
$('vol').addEventListener('input', () => { setVolume(Number($('vol').value)); saveSession(true); });
$('vol').style.setProperty('--p', '80%');
audio.volume = 0.8;

if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('nexttrack', () => next(false));
  navigator.mediaSession.setActionHandler('previoustrack', prev);
  navigator.mediaSession.setActionHandler('play', () => (audio.src ? audio.play() : togglePlay()));
  navigator.mediaSession.setActionHandler('pause', () => audio.pause());
}
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { e.preventDefault(); $('play').click(); }
});


// ---------- lyrics ----------
let lyricsState = { id: null, lines: [], idx: -1 };
// Per-song lyric timing nudge (seconds). Negative = show lyrics earlier, positive = later.
const offKey = () => 'lyroff:' + (state.queue[state.index]?.id || '');
const lyrOffset = () => { try { return Number(localStorage.getItem(offKey())) || 0; } catch { return 0; } };
function adjustOffset(delta) {
  let v = delta === 0 ? 0 : Math.round((lyrOffset() + delta) * 10) / 10;
  try { v === 0 ? localStorage.removeItem(offKey()) : localStorage.setItem(offKey(), String(v)); } catch { /* storage unavailable */ }
  lyricsState.idx = -1; fIdx = -1;
  updateOffsetLabels();
  syncLyrics(); fullSync();
}
function updateOffsetLabels() {
  const v = lyrOffset();
  const t = v === 0 ? 'In sync' : `${v > 0 ? '+' : ''}${v.toFixed(1)}s`;
  document.querySelectorAll('.offval').forEach((e) => { e.textContent = t; });
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-off]');
  if (b) adjustOffset(Number(b.dataset.off));
});
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
  const off = lyrOffset();
  for (let i = 0; i < L.length; i++) { if (L[i].t + off <= audio.currentTime + 0.25) idx = i; else break; }
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
  if (ln && lyricsState.lines[Number(ln.dataset.i)]) audio.currentTime = lyricsState.lines[Number(ln.dataset.i)].t + lyrOffset();
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
async function toggleLike(song) {
  if (!song) return;
  const want = !liked.has(song.id);
  want ? liked.add(song.id) : liked.delete(song.id);
  refreshLike();
  const r = await window.api.like(song.id, want);
  if (!r.ok) {
    want ? liked.delete(song.id) : liked.add(song.id);
    refreshLike();
    toast(`Couldn't ${want ? 'like' : 'unlike'}: ${r.error.slice(0, 100)}`);
  } else toast(want ? 'Added to your liked songs' : 'Removed from liked songs');
}
$('like').onclick = () => toggleLike(state.queue[state.index]);

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
    window.api.addHistory?.(song.id).catch(() => {});
  }
});

// ---------- remember where you left off ----------
// The queue, the song, the position, the volume and repeat survive closing the app. Nothing plays by
// itself on launch: press play and it carries on from the same spot.
const SESSION_KEY = 'session:v1';
let resumeAt = 0;
let pendingResume = null;
let lastSessionSave = 0;
function saveSession(force) {
  if (!force && Date.now() - lastSessionSave < 5000) return;
  lastSessionSave = Date.now();
  try {
    const start = Math.max(0, state.index - 50);
    const queue = state.queue.slice(start, start + 600).map(metaOf);
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      queue, index: state.index - start, pos: audio.src ? audio.currentTime : resumeAt,
      vol: Number($('vol').value), repeat: repeatMode,
    }));
  } catch { /* storage unavailable */ }
}
function setVolume(v) {
  v = Math.min(100, Math.max(0, Math.round(v)));
  $('vol').value = v;
  $('vol').style.setProperty('--p', v + '%');
  audio.volume = v / 100;
}
function restoreSession() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { /* none */ }
  if (!saved) return;
  if (Number.isFinite(saved.vol)) setVolume(saved.vol);
  while (saved.repeat && REPEAT_TITLES[saved.repeat] && repeatMode !== saved.repeat) {
    repeatMode = repeatMode === 'all' ? 'one' : repeatMode === 'one' ? 'off' : 'all';
  }
  $('repeat').classList.toggle('on', repeatMode !== 'off');
  $('rep1').textContent = repeatMode === 'one' ? '1' : '';
  $('repeat').title = REPEAT_TITLES[repeatMode];
  const queue = Array.isArray(saved.queue) ? saved.queue.filter((x) => x && /^[\w-]{11}$/.test(x.id)) : [];
  const song = queue[saved.index];
  if (!song) return;
  state.queue = queue;
  state.index = saved.index;
  resumeAt = Number(saved.pos) || 0;
  showSong(song);
  $('cur').textContent = fmt(resumeAt);
  if (song.duration) {
    $('dur').textContent = fmt(song.duration);
    $('bar').value = Math.min(1000, (resumeAt / song.duration) * 1000);
    $('bar').style.setProperty('--p', Math.min(100, (resumeAt / song.duration) * 100) + '%');
  }
  setStatus('Press play to carry on where you left off');
}
// Play from the restored spot the first time play is pressed after launch.
async function resumeRestored() {
  const song = state.queue[state.index];
  if (!song) return;
  const at = resumeAt;
  resumeAt = 0;
  pickedByUser = true;
  pendingResume = at > 2 ? { id: song.id, at } : null;
  await playCurrent();
  // A song saved on disk can seek straight away; one still downloading seeks when its file is ready.
  if (pendingResume && state.queue[state.index]?.id === song.id && audio.src.startsWith('file:')) {
    const seek = () => { const t = takeResume(song.id); if (t && durOf() && t < durOf() - 3) audio.currentTime = t; };
    if (audio.readyState >= 1) seek(); else audio.addEventListener('loadedmetadata', seek, { once: true });
  }
}
function takeResume(id) {
  if (!pendingResume || pendingResume.id !== id) return 0;
  const t = pendingResume.at;
  pendingResume = null;
  return t;
}
audio.addEventListener('timeupdate', () => saveSession(false));
audio.addEventListener('pause', () => saveSession(true));
window.addEventListener('beforeunload', () => saveSession(true));

// ---------- right-click menu ----------
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), 2800);
}
function askName(title, okLabel = 'Create') {
  return new Promise((resolve) => {
    const modal = $('modal'), input = $('m-input');
    $('m-title').textContent = title;
    $('m-ok').textContent = okLabel;
    input.value = '';
    modal.hidden = false;
    setTimeout(() => input.focus(), 30);
    const done = (v) => { modal.hidden = true; $('m-ok').onclick = $('m-cancel').onclick = input.onkeydown = null; resolve(v); };
    $('m-ok').onclick = () => done(input.value.trim() || null);
    $('m-cancel').onclick = () => done(null);
    input.onkeydown = (e) => { if (e.key === 'Enter') done(input.value.trim() || null); if (e.key === 'Escape') done(null); };
  });
}
const copyText = async (t) => { try { await navigator.clipboard.writeText(t); toast('Link copied'); } catch { toast("Couldn't copy"); } };

function closeMenu() {
  const ctx = $('ctx');
  ctx.hidden = true;
  ctx.innerHTML = '';
  document.querySelectorAll('.ctxing').forEach((e) => e.classList.remove('ctxing'));
}
function buildMenu(items, level) {
  const m = document.createElement('div');
  m.className = 'cm';
  m.dataset.level = level;
  for (const it of items) {
    if (it.sep) { m.insertAdjacentHTML('beforeend', '<div class="msep"></div>'); continue; }
    if (it.header) { m.insertAdjacentHTML('beforeend', `<div class="mhead">${esc(it.header)}</div>`); continue; }
    if (it.none) { m.insertAdjacentHTML('beforeend', `<div class="mnone">${esc(it.none)}</div>`); continue; }
    const el = document.createElement('div');
    el.className = `mi${it.on ? ' on' : ''}${it.danger ? ' danger' : ''}`;
    el.innerHTML = `${it.icon ? ic(it.icon) : '<span style="width:18px"></span>'}<span class="lab">${esc(it.label)}</span>${it.sub ? ic('right').replace('class="i"', 'class="i chev"') : ''}`;
    el.addEventListener('mouseenter', () => {
      m.querySelectorAll('.mi.sel').forEach((x) => x.classList.remove('sel'));
      el.classList.add('sel');
      closeDeeper(level);
      if (it.sub) openSub(el, it, level);
    });
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (it.sub) return openSub(el, it, level);
      closeMenu();
      it.action?.();
    });
    m.appendChild(el);
  }
  return m;
}
function closeDeeper(level) {
  document.querySelectorAll('#ctx .cm').forEach((x) => { if (Number(x.dataset.level) > level) x.remove(); });
}
function place(m, x, y, anchor) {
  const ctx = $('ctx');
  ctx.appendChild(m);
  const w = m.offsetWidth, h = m.offsetHeight;
  let left = x, top = y;
  if (anchor) { // submenu: to the right of its parent, or the left if there is no room
    left = anchor.right + 4;
    if (left + w > innerWidth - 8) left = anchor.left - w - 4;
    top = anchor.top - 6;
  }
  if (left + w > innerWidth - 8) left = Math.max(8, innerWidth - w - 8);
  if (top + h > innerHeight - 8) top = Math.max(8, innerHeight - h - 8);
  m.style.left = `${left}px`;
  m.style.top = `${top}px`;
}
async function openSub(el, it, level) {
  if (el.dataset.open) return;
  closeDeeper(level);
  const rect = el.getBoundingClientRect();
  const loading = buildMenu([{ none: 'Loading…' }], level + 1);
  place(loading, 0, 0, rect);
  const items = typeof it.sub === 'function' ? await it.sub() : it.sub;
  if (!loading.isConnected) return;
  loading.remove();
  place(buildMenu(items, level + 1), 0, 0, rect);
}
function showMenu(x, y, items, target) {
  closeMenu();
  const ctx = $('ctx');
  ctx.hidden = false;
  target?.classList.add('ctxing');
  place(buildMenu(items, 0), x, y);
}
$('ctx').addEventListener('mousedown', (e) => { if (e.target === $('ctx')) closeMenu(); });
$('ctx').addEventListener('contextmenu', (e) => { e.preventDefault(); if (e.target === $('ctx')) closeMenu(); });
window.addEventListener('blur', closeMenu);
window.addEventListener('resize', closeMenu);
$('scroll').addEventListener('scroll', () => { if (!$('ctx').hidden) closeMenu(); });
document.addEventListener('keydown', (e) => {
  if ($('ctx').hidden) return;
  const menus = [...document.querySelectorAll('#ctx .cm')];
  const last = menus[menus.length - 1];
  if (!last) return;
  const items = [...last.querySelectorAll('.mi')];
  const cur = items.findIndex((x) => x.classList.contains('sel'));
  if (e.key === 'Escape') { e.preventDefault(); menus.length > 1 ? last.remove() : closeMenu(); }
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = (cur + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items.forEach((x) => x.classList.remove('sel'));
    items[n]?.classList.add('sel');
    items[n]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter' || e.key === 'ArrowRight') {
    e.preventDefault();
    items[cur]?.click();
  } else if (e.key === 'ArrowLeft' && menus.length > 1) { e.preventDefault(); last.remove(); }
});

// --- queue helpers
function playNow(song) {
  if (state.index < 0 || !state.queue.length) { state.queue = [song]; state.index = 0; state.history = []; }
  else { state.history.push(state.index); state.queue.splice(state.index + 1, 0, song); state.index++; }
  pickedByUser = true;
  failStreak = 0;
  playCurrent();
}
function queueSong(song, next) {
  if (state.index < 0 || !state.queue.length) return playNow(song);
  if (next) state.queue.splice(state.index + 1, 0, song);
  else state.queue.push(song);
  toast(next ? 'Playing next' : 'Added to queue');
}
async function songsOf(item) {
  if (item.kind === 'song') return [item];
  const page = item.kind === 'playlist'
    ? { sections: [{ items: await unwrap(window.api.playlist(item.id)) }] }
    : await unwrap(window.api.browse(item.id, item.params));
  return page.sections.flatMap((s) => s.items).filter((x) => (x.kind || 'song') === 'song').map((x) => ({ ...x, kind: 'song' }));
}
const linkOf = (item) => item.kind === 'song' ? `https://music.youtube.com/watch?v=${item.id}`
  : item.kind === 'playlist' ? `https://music.youtube.com/playlist?list=${String(item.id).replace(/^VL/, '')}`
  : item.kind === 'artist' ? `https://music.youtube.com/channel/${item.id}`
  : `https://music.youtube.com/browse/${item.id}`;

// --- downloads
async function downloadMany(songs) {
  const todo = songs.filter((s) => !downloaded.has(s.id));
  if (!todo.length) return toast('Already downloaded');
  let done = 0, failed = 0;
  for (const s of todo) {
    setStatus(`Downloading ${done + failed + 1} of ${todo.length}…`);
    const r = await window.api.dlAdd(metaOf(s));
    if (r.ok) { done++; downloaded.add(s.id); } else failed++;
  }
  setStatus('');
  toast(failed ? `Downloaded ${done}, ${failed} failed` : `Downloaded ${done} song${done === 1 ? '' : 's'} for offline`);
  document.querySelectorAll('.row').forEach((r) => {
    const it = state.sections[Number(r.dataset.s)]?.items[Number(r.dataset.i)];
    if (it && downloaded.has(it.id) && !r.querySelector('.dlmark')) r.querySelector('.d')?.insertAdjacentHTML('afterbegin', `<span class="dlmark" title="Downloaded">${ic('check')}</span>`);
  });
}
async function removeDownloaded(song) {
  await window.api.dlRemove(song.id);
  downloaded.delete(song.id);
  toast('Removed from downloads');
  document.querySelectorAll('.row').forEach((r) => {
    const it = state.sections[Number(r.dataset.s)]?.items[Number(r.dataset.i)];
    if (it?.id === song.id) r.querySelector('.dlmark')?.remove();
  });
}

// --- song actions
async function playlistSubmenu(song) {
  const r = await window.api.library();
  const lists = (r.ok ? r.data : []).filter((p) => !isLikedList(p));
  const out = [{ label: 'New playlist…', icon: 'plus', action: async () => {
    const name = await askName('New playlist');
    if (!name) return;
    const res = await window.api.playlistCreate(name, song.id);
    toast(res.ok ? `Created "${name}" with this song` : `Couldn't create: ${res.error.slice(0, 90)}`);
    if (res.ok) loadSideLibrary(true);
  } }];
  if (!r.ok) return [...out, { none: r.error.slice(0, 80) }];
  if (lists.length) out.push({ sep: true });
  for (const p of lists) {
    out.push({ label: p.title, icon: 'note', action: async () => {
      const res = await window.api.playlistAdd(p.id, song.id);
      toast(res.ok ? `Added to ${p.title}` : `Couldn't add: ${res.error.slice(0, 90)}`);
    } });
  }
  return out;
}
async function removeFromPlaylist(plId, song) {
  const res = await window.api.playlistRemove(plId, song.id);
  if (!res.ok) return toast(`Couldn't remove: ${res.error.slice(0, 90)}`);
  toast('Removed from playlist');
  openPage(nav.current, false);
}
function startRadio(song) {
  openPage({
    title: `${song.title} radio`,
    loading: 'Building radio…',
    load: async () => {
      const more = await unwrap(window.api.radio(song.id));
      return { header: { title: `${song.title} radio`, subtitle: 'Songs similar to this one', thumbnail: song.thumbnail }, kindLabel: 'Radio', sections: [{ title: '', items: [song, ...more.filter((s) => s.id !== song.id)] }] };
    },
  });
}
function goArtist(song) {
  const name = String(song.artist || '').split(/, | & /)[0];
  if (song.artistId) return openPage(browseDesc(name, song.artistId));
  $('q').value = name;
  $('q').dispatchEvent(new Event('input'));
}
function songMenu(song) {
  const isLiked = liked.has(song.id);
  const plId = nav.current?.playlistId;
  const items = [
    { label: 'Play now', icon: 'play', action: () => playNow(song) },
    { label: 'Play next', icon: 'next-up', action: () => queueSong(song, true) },
    { label: 'Add to queue', icon: 'queue', action: () => queueSong(song, false) },
    { sep: true },
    { label: isLiked ? 'Remove from liked songs' : 'Like', icon: 'heart', on: isLiked, action: () => toggleLike(song) },
    { label: 'Add to playlist', icon: 'plus', sub: () => playlistSubmenu(song) },
  ];
  if (plId && plId !== 'LM' && state.sections.some((s) => s.items.some((x) => x.id === song.id))) {
    items.push({ label: 'Remove from this playlist', icon: 'trash', danger: true, action: () => removeFromPlaylist(plId, song) });
  }
  if (nav.current?.id === 'queue' && state.queue[state.index]?.id !== song.id) {
    items.push({ label: 'Remove from queue', icon: 'trash', danger: true, action: () => {
      const at = state.queue.findIndex((x, n) => n > state.index && x.id === song.id);
      if (at > -1) state.queue.splice(at, 1);
      openPage(nav.current, false);
    } });
  }
  items.push({ label: downloaded.has(song.id) ? 'Remove download' : 'Download', icon: 'download', action: () => (downloaded.has(song.id) ? removeDownloaded(song) : downloadMany([song])) });
  items.push({ sep: true });
  items.push({ label: 'Start radio', icon: 'radio', action: () => startRadio(song) });
  if (song.artist) items.push({ label: 'Go to artist', icon: 'user', action: () => goArtist(song) });
  if (song.albumId) items.push({ label: 'Go to album', icon: 'disc', action: () => openPage(browseDesc('Album', song.albumId)) });
  items.push({ label: 'Copy link', icon: 'link', action: () => copyText(linkOf(song)) });
  return items;
}
function collectionMenu(item) {
  const items = [{ label: 'Open', icon: 'right', action: () => (item.kind === 'playlist' ? openPage(playlistDesc(item.title, item.id)) : openPage(browseDesc(item.title, item.id, item.params))) }];
  if (item.kind === 'album' || item.kind === 'playlist' || item.kind === 'artist') {
    items.unshift({ label: 'Shuffle play', icon: 'play', action: async () => {
      setStatus(`Loading ${item.title}…`);
      try { const s = await songsOf(item); setStatus(''); s.length ? playFromList(s, s[Math.floor(Math.random() * s.length)].id) : toast('Nothing playable there'); }
      catch (e) { setStatus(''); toast(String(e.message || e).slice(0, 90)); }
    } });
    items.splice(2, 0, { label: 'Add to queue', icon: 'queue', action: async () => {
      try { const s = await songsOf(item); s.forEach((x) => (state.index < 0 ? state.queue.push(x) : state.queue.push(x))); toast(`Added ${s.length} songs to the queue`); if (state.index < 0 && s.length) { state.index = 0; playCurrent(); } }
      catch (e) { toast(String(e.message || e).slice(0, 90)); }
    } });
  }
  items.push({ sep: true }, { label: 'Copy link', icon: 'link', action: () => copyText(linkOf(item)) });
  return items;
}
document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const row = e.target.closest('.row, .card-i');
  if (row) {
    const item = state.sections[Number(row.dataset.s)]?.items[Number(row.dataset.i)];
    if (!item || item.kind === 'artist-stat') return;
    return showMenu(e.clientX, e.clientY, item.kind === 'song' ? songMenu(item) : collectionMenu(item), row);
  }
  const sl = e.target.closest('.sl');
  if (sl) return showMenu(e.clientX, e.clientY, collectionMenu({ kind: 'playlist', id: sl.dataset.id, title: sl.dataset.title }), sl);
  if (e.target.closest('#np')) {
    const song = state.queue[state.index];
    if (song) showMenu(e.clientX, e.clientY, songMenu(song), $('np'));
  }
});

// ---------- tray + media keys ----------
const reportState = () => {
  const s = state.queue[state.index];
  window.api.playerState({ title: s?.title || '', artist: s?.artist || '', thumbnail: s?.thumbnail || '', playing: !audio.paused, position: audio.currentTime || 0, duration: durOf() });
};
let lastReport = 0;
audio.addEventListener('timeupdate', () => { const n = Date.now(); if (n - lastReport > 1000) { lastReport = n; reportState(); } });
audio.addEventListener('play', reportState);
audio.addEventListener('pause', reportState);
window.api.onMedia((action) => {
  if (action === 'playpause') $('play').click();
  else if (action === 'next') next(false);
  else if (action === 'prev') prev();
});

// ---------- offline ----------
function showOffline() {
  setStatus(navigator.onLine ? '' : 'Offline – downloaded and recently played songs still work');
}
window.addEventListener('offline', () => { showOffline(); toast("You're offline – opening Downloads"); show('downloads'); });
window.addEventListener('online', showOffline);

window.api.onUpdate((m) => {
  state.update = m;
  if (m.state === 'ready') { toast(`Update ${m.version} ready – open Settings to restart`); refreshAccount(); }
  renderSettings();
});
window.api.onProgress((m) => { if (m.id === state.queue[state.index]?.id && audio.paused) setStatus(`Downloading song… ${m.pct}%`); });
refreshDownloaded();
refreshAccount();
show(navigator.onLine ? 'home' : 'downloads');
showOffline();

$('list').addEventListener('click', (e) => {
  const q = e.target.closest('.qt');
  if (!q) return;
  if (q.dataset.qv) show(q.dataset.qv);
  else openRoot(playlistDesc(q.dataset.qtitle, q.dataset.qpl), '');
});

// ---------- sidebar filter + create ----------
$('libfilter').addEventListener('input', () => {
  const t = $('libfilter').value.trim().toLowerCase();
  document.querySelectorAll('#sidelib .sl').forEach((el) => { el.hidden = !!t && !el.dataset.title.toLowerCase().includes(t); });
});
$('libcreate').onclick = async () => {
  const name = await askName('New playlist');
  if (!name) return;
  const res = await window.api.playlistCreate(name, null);
  toast(res.ok ? `Created "${name}"` : 'Could not create the playlist');
  loadSideLibrary(true);
};

// ---------- full-screen now playing ----------
let fLines = [], fIdx = -1, fId = null;
function fullOpen() { $('full').hidden = false; fId = null; fullFill(); }
function fullClose() { $('full').hidden = true; }
function fullFill() {
  const s = state.queue[state.index];
  if ($('full').hidden) return;
  $('fbg').style.backgroundImage = s?.thumbnail ? `url("${s.thumbnail}")` : '';
  $('fart').src = big(s?.thumbnail);
  $('ft').textContent = s?.title || 'Nothing playing';
  $('fa').textContent = s?.artist || '';
  $('fplay').innerHTML = ic(audio.paused ? 'play' : 'pause');
  $('frep').classList.toggle('on', $('repeat').classList.contains('on'));
  if (s && s.id !== fId) fullLyrics(s);
}
async function fullLyrics(s) {
  fId = s.id; fLines = []; fIdx = -1;
  $('full').classList.remove('nolyr');
  $('flyr').innerHTML = '<div class="fmsg">Loading lyrics…</div>';
  const r = await window.api.lyrics({ id: s.id, title: s.title, artist: s.artist, duration: s.duration || audio.duration || 0 });
  if (fId !== s.id) return;
  if (r.ok && r.data.synced.length) {
    fLines = r.data.synced;
    $('flyr').innerHTML = fLines.map((l, i) => `<div class="fl" data-i="${i}">${esc(l.text) || '♪'}</div>`).join('');
  } else if (r.ok && r.data.plain) {
    $('flyr').innerHTML = `<div class="fmsg">${esc(r.data.plain)}</div>`;
  } else {
    $('full').classList.add('nolyr');
  }
}
function fullSync() {
  if ($('full').hidden) return;
  if (durOf() && !fSeeking) {
    $('fbar').value = Math.min(1000, (audio.currentTime / durOf()) * 1000);
    $('fbar').style.setProperty('--p', Math.min(100, (audio.currentTime / durOf()) * 100) + '%');
  }
  $('fcur').textContent = fmt(audio.currentTime || 0);
  $('fdur').textContent = fmt(durOf());
  if (!fLines.length) return;
  let idx = -1;
  const off = lyrOffset();
  for (let i = 0; i < fLines.length; i++) { if (fLines[i].t + off <= audio.currentTime + 0.25) idx = i; else break; }
  if (idx === fIdx) return;
  fIdx = idx;
  const els = $('flyr').children;
  for (let i = 0; i < els.length; i++) { els[i].classList.toggle('cur', i === idx); els[i].classList.toggle('past', i < idx); }
  els[idx]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
let fSeeking = false;
$('fbar').addEventListener('input', () => { fSeeking = true; });
$('fbar').addEventListener('change', () => { if (durOf()) audio.currentTime = ($('fbar').value / 1000) * durOf(); fSeeking = false; });
audio.addEventListener('timeupdate', fullSync);
audio.addEventListener('play', () => { $('fplay').innerHTML = ic('pause'); });
audio.addEventListener('pause', () => { $('fplay').innerHTML = ic('play'); });
$('fplay').onclick = () => $('play').click();
$('fprev').onclick = () => $('prev').click();
$('fnextb').onclick = () => $('next').click();
$('frep').onclick = () => { $('repeat').click(); setTimeout(() => $('frep').classList.toggle('on', $('repeat').classList.contains('on')), 0); };
$('flyr').addEventListener('click', (e) => {
  const l = e.target.closest('.fl');
  if (l && fLines[Number(l.dataset.i)]) audio.currentTime = fLines[Number(l.dataset.i)].t + lyrOffset();
});
$('expand').onclick = () => ($('full').hidden ? fullOpen() : fullClose());
$('art').onclick = fullOpen;
$('fclose').onclick = fullClose;
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('full').hidden && $('ctx').hidden) fullClose(); });

window.api.onFullscreen((on) => document.body.classList.toggle('fs', on));

// ---------- playlist tools: find / sort / select several ----------
function refreshRows() {
  const t = state.pageTools;
  if (!t || !$('rows')) return;
  const q = t.q.toLowerCase();
  let items = t.orig.filter((s) => !q || `${s.title} ${s.artist}`.toLowerCase().includes(q));
  const by = { title: (x, y) => x.title.localeCompare(y.title), artist: (x, y) => (x.artist || '').localeCompare(y.artist || '') || x.title.localeCompare(y.title), dur: (x, y) => (y.duration || 0) - (x.duration || 0) }[t.sort];
  if (by) items = [...items].sort(by);
  state.sections[0].items = items;
  const cur = state.queue[state.index]?.id;
  $('rows').innerHTML = items.length ? items.map((s, i) => rowHtml(s, 0, i, cur)).join('') : '<div class="msg">No songs match.</div>';
  clearSelection();
}
$('list').addEventListener('input', (e) => {
  if (e.target.id !== 'pfilter' || !state.pageTools) return;
  state.pageTools.q = e.target.value.trim();
  refreshRows();
});
$('list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-sort]');
  if (!b || !state.pageTools) return;
  state.pageTools.sort = b.dataset.sort;
  document.querySelectorAll('[data-sort]').forEach((x) => x.classList.toggle('on', x === b));
  refreshRows();
});
const sel = new Set();
let selAnchor = -1;
function clearSelection() { sel.clear(); selAnchor = -1; document.querySelectorAll('.row.sel').forEach((r) => r.classList.remove('sel')); updateSelBar(); }
function updateSelBar() {
  let bar = $('selbar');
  if (!sel.size) { bar?.remove(); return; }
  if (!bar) { bar = document.createElement('div'); bar.id = 'selbar'; document.body.appendChild(bar); }
  const plId = nav.current?.playlistId;
  bar.innerHTML = `<b>${sel.size} selected</b><button data-sel="play">Play</button><button data-sel="queue">Add to queue</button><button data-sel="dl">Download</button>${plId && plId !== 'LM' ? '<button data-sel="rm" class="danger">Remove from playlist</button>' : ''}<button data-sel="clear" class="ghost">Clear</button>`;
}
$('list').addEventListener('click', (e) => {
  if (!(e.ctrlKey || e.metaKey || e.shiftKey)) return;
  const row = e.target.closest('.row');
  if (!row) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const rows = [...document.querySelectorAll('#list .row')];
  const i = rows.indexOf(row);
  const setRow = (r, on) => { const it = state.sections[Number(r.dataset.s)]?.items[Number(r.dataset.i)]; if (!it) return; on ? sel.add(it.id) : sel.delete(it.id); r.classList.toggle('sel', on); };
  if (e.shiftKey && selAnchor >= 0) { const [lo, hi] = [Math.min(selAnchor, i), Math.max(selAnchor, i)]; rows.slice(lo, hi + 1).forEach((r) => setRow(r, true)); }
  else { setRow(row, !row.classList.contains('sel')); selAnchor = i; }
  updateSelBar();
}, true);
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-sel]');
  if (!b) return;
  const songs = state.sections.flatMap((s) => s.items).filter((x) => x.kind === 'song' && sel.has(x.id));
  const k = b.dataset.sel;
  if (k === 'clear') return clearSelection();
  if (k === 'play') { if (songs.length) playFromList(songs, songs[0].id); return clearSelection(); }
  if (k === 'queue') { songs.forEach((s) => queueSong(s, false)); return clearSelection(); }
  if (k === 'dl') { clearSelection(); return downloadMany(songs); }
  if (k === 'rm') {
    const plId = nav.current?.playlistId;
    setStatus(`Removing ${songs.length} songs…`);
    let bad = 0;
    for (const s of songs) { const r = await window.api.playlistRemove(plId, s.id); if (!r.ok) bad++; }
    clearSelection(); setStatus('');
    toast(bad ? `Removed ${songs.length - bad}, ${bad} failed` : `Removed ${songs.length} songs`);
    openPage(nav.current, false);
  }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sel.size && $('ctx').hidden && $('full').hidden) clearSelection(); });

// ---------- Daily Mixes ----------
const mixKey = () => new Date().toISOString().slice(0, 10);
async function buildMixes() {
  try { const c = JSON.parse(localStorage.getItem('mixes') || 'null'); if (c && c.day === mixKey() && c.mixes?.length) return c.mixes; } catch { /* rebuild */ }
  const [lr, rr] = await Promise.all([window.api.playlist('LM'), window.api.recommended()]);
  const liked = lr.ok ? lr.data : [];
  const rec = rr.ok ? rr.data.songs || [] : [];
  const pool = [...liked, ...rec];
  const byArtist = new Map();
  for (const s of pool) {
    const name = String(s.artist || '').split(/, | & /)[0].trim();
    if (!name) continue;
    if (!byArtist.has(name)) byArtist.set(name, new Map());
    byArtist.get(name).set(s.id, s);
  }
  const artists = [...byArtist.entries()].sort((x, y) => y[1].size - x[1].size).slice(0, 16);
  const mixes = [];
  for (let m = 0; m < 4; m++) {
    const mine = artists.filter((_, i) => i % 4 === m);
    const songs = shuffle([...new Map(mine.flatMap(([, ss]) => [...ss.values()]).map((s) => [s.id, s])).values()]).slice(0, 40);
    if (songs.length < 8) continue;
    const names = mine.map(([n]) => n);
    mixes.push({ kind: 'mix', id: `mix${m + 1}`, title: `Daily Mix ${mixes.length + 1}`, artist: names.slice(0, 3).join(', ') + (names.length > 3 ? ' and more' : ''), thumbnail: songs.find((s) => s.thumbnail)?.thumbnail || '', songs: songs.map(metaOf) });
  }
  try { localStorage.setItem('mixes', JSON.stringify({ day: mixKey(), mixes })); } catch { /* storage full */ }
  return mixes;
}
$('list').addEventListener('click', (e) => {
  const el = e.target.closest('.card-i');
  const it = el && state.sections[Number(el.dataset.s)]?.items[Number(el.dataset.i)];
  if (!it || it.kind !== 'mix') return;
  e.stopImmediatePropagation();
  const songs = it.songs.map((s) => ({ ...s, kind: 'song' }));
  if (e.target.closest('[data-play]')) return playFromList(songs, songs[Math.floor(Math.random() * songs.length)].id);
  openPage({ title: it.title, load: async () => ({ header: { title: it.title, subtitle: it.artist, thumbnail: it.thumbnail }, kindLabel: 'Made for you', sections: [{ title: '', items: songs }] }) });
}, true);

try { restoreSession(); } catch (e) { console.warn('restore failed', e); }
