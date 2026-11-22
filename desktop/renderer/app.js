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

const ic = (name) => `<svg class="i"><use href="#i-${name}"/></svg>`;
function rowHtml(s, si, i, cur) {
  return `<div class="row${s.id === cur ? ' playing' : ''}" data-s="${si}" data-i="${i}">
      <div class="n"><span>${i + 1}</span>${ic('play')}</div>
      <div class="m">${s.thumbnail ? `<img loading="lazy" src="${esc(s.thumbnail)}" alt="" />` : phHtml(s.title, 'note')}<div style="min-width:0"><div class="t">${esc(s.title)}</div><div class="a">${esc(s.artist)}</div></div></div>
      <div class="d">${downloaded.has(s.id) ? `<span class="dlmark" title="Downloaded">${ic('check')}</span>` : ''}${s.duration ? fmt(s.duration) : ''}</div>
    </div>`;
}
function cardHtml(c, si, i) {
  const playable = c.kind === 'album' || c.kind === 'playlist';
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
  $('title').textContent = page.header?.title ? '' : title;
  document.querySelector('.pagehead').style.display = page.header?.title ? 'none' : '';
  $('hero').style.setProperty('--hero', heroColor(page.header?.title || title));
  const cur = state.queue[state.index]?.id;
  let html = '';
  if (page.html) { $('list').innerHTML = page.html; if (!keepScroll) $('scroll').scrollTop = 0; return; }
  const allSongs = state.sections.flatMap((s) => s.items).filter((x) => (x.kind || 'song') === 'song');
  if (page.header?.title) {
    if (!page.header.thumbnail) page.header.thumbnail = allSongs.find((s) => s.thumbnail)?.thumbnail || '';
    html += `<div class="phead">${page.header.thumbnail ? `<img src="${esc(page.header.thumbnail)}" alt="" />` : ''}<div><div class="pk">${esc(page.kindLabel || '')}</div><div class="pt">${esc(page.header.title)}</div><div class="a">${esc(page.header.subtitle || '')}</div></div></div>`;
  }
  if (allSongs.length && (page.header?.title || state.sections.length === 1)) {
    html += `<div class="actions"><button class="bigplay" data-playall="1" title="Shuffle play">${ic('play')}</button><button class="pill" data-dlall="1" title="Save these songs for offline">${ic('download')} Download</button>${page.syncable ? `<button class="pill" data-refresh="1" title="Build a fresh list">${ic('repeat')} Refresh</button><button class="pill" data-sync="1" title="Create or update this playlist on your YouTube account">${ic('sync')} Sync to my account</button>` : ''}<span class="hint">${allSongs.length} songs</span></div>`;
  }
  state.sections.forEach((sec, si) => {
    const items = sec.items.map((it) => ({ ...it, kind: it.kind || 'song' }));
    sec.items = items;
    const songs = items.filter((x) => x.kind === 'song');
    if (sec.title) {
      const shelf = sec.shelf || (songs.length !== items.length && items.length > 5);
      html += `<div class="sechead"><h3 class="sec">${esc(sec.title)}</h3>${sec.more ? `<button class="pill small" data-goview="${esc(sec.more.view)}">${esc(sec.more.label)}</button>` : ''}${shelf ? `<div class="arrows"><button data-scroll="-1" title="Back">${ic('left')}</button><button data-scroll="1" title="Next">${ic('right')}</button></div>` : ''}</div>`;
    }
    if (songs.length === items.length && !sec.shelf) html += items.map((s, i) => rowHtml(s, si, i, cur)).join('');
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
      page.sections.unshift(sec);
      renderPage(page.title || desc.title, page, true);
    }).catch(() => {});
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
  load: async () => ({ header: { title, subtitle: '', thumbnail: '' }, kindLabel: 'Playlist', sections: [{ title: '', items: await unwrap(window.api.playlist(id)) }] }),
});

const VIEWS = {
  home: () => {
    const d = browseDesc('Home', 'FEmusic_home');
    d.after = async () => {
      const auth = await window.api.authStatus();
      if (!auth.ok || !auth.data.signedIn) return null;
      const r = await window.api.recommended();
      if (!r.ok || !r.data.songs?.length) return null;
      return { title: 'Recommended for you', shelf: true, more: { label: 'Show all', view: 'recommended' }, items: r.data.songs.slice(0, 24) };
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
      load: async () => ({ sections: [{ title: '', items: await unwrap(window.api.search(q)) }] }),
    }, '');
  }, 350);
});

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
  const cog = `<button class="round" id="cog" title="Settings">${ic('cog')}${cogDot()}</button>`;
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
    <h3>App</h3><div class="box"><div class="line"><div class="l"><div>Keep playing in the tray</div><div class="s">Closing the window hides the app instead of quitting</div></div><div class="sw${st.ok && st.data.closeToTray ? ' on' : ''}" data-set="tray"></div></div></div>
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

async function playCurrent() {
  const song = state.queue[state.index];
  if (!song) return;
  $('np-title').textContent = song.title;
  $('np-artist').textContent = song.artist;
  $('art').src = song.thumbnail || '';
  setTile('tile-q', song.thumbnail);
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
$('play').onclick = () => (audio.paused ? audio.play() : audio.pause());
$('next').onclick = () => next(false);
$('prev').onclick = prev;
audio.addEventListener('play', () => ($('play').innerHTML = ic('pause')));
audio.addEventListener('pause', () => ($('play').innerHTML = ic('play')));
audio.addEventListener('ended', () => {
  if (repeatMode === 'one') { audio.currentTime = 0; audio.play(); return; }
  if (repeatMode === 'off' && state.index + 1 >= state.queue.length) { setStatus('Reached the end of the queue'); return; }
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
  }
});

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
  window.api.playerState({ title: s?.title || '', artist: s?.artist || '', playing: !audio.paused });
};
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
