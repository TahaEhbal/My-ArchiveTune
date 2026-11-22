// Parses YouTube Music's raw browse JSON into simple shelves of items. Kept separate so CI can test it
// against real responses.
const runsText = (r) => (r?.runs ?? []).map((x) => x.text).join('');

function walk(node, fn) {
  if (Array.isArray(node)) { node.forEach((n) => walk(n, fn)); return; }
  if (node && typeof node === 'object') {
    fn(node);
    for (const k of Object.keys(node)) walk(node[k], fn);
  }
}

const lastThumb = (t) => {
  const a = t?.musicThumbnailRenderer?.thumbnail?.thumbnails ?? t?.croppedSquareThumbnailRenderer?.thumbnail?.thumbnails ?? t?.thumbnails ?? [];
  return a.length ? a[a.length - 1].url : '';
};

const PAGE_KIND = {
  MUSIC_PAGE_TYPE_ALBUM: 'album',
  MUSIC_PAGE_TYPE_AUDIOBOOK: 'album',
  MUSIC_PAGE_TYPE_ARTIST: 'artist',
  MUSIC_PAGE_TYPE_USER_CHANNEL: 'artist',
  MUSIC_PAGE_TYPE_LIBRARY_ARTIST: 'artist',
  MUSIC_PAGE_TYPE_PLAYLIST: 'playlist',
};

function browseTarget(nav) {
  const be = nav?.browseEndpoint;
  if (!be?.browseId) return null;
  const pageType = be.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
  let kind = PAGE_KIND[pageType];
  if (!kind) {
    if (be.browseId.startsWith('MPRE')) kind = 'album';
    else if (be.browseId.startsWith('UC')) kind = 'artist';
    else if (be.browseId.startsWith('VL')) kind = 'playlist';
    else kind = 'page';
  }
  return { kind, id: be.browseId, params: be.params };
}

// Artist / album ids hidden in the clickable parts of a subtitle line.
function idsFromRuns(...runLists) {
  const out = {};
  for (const runs of runLists) for (const r of runs ?? []) {
    const id = r.navigationEndpoint?.browseEndpoint?.browseId;
    if (!id) continue;
    if (id.startsWith('UC') && !out.artistId) out.artistId = id;
    else if (id.startsWith('MPRE') && !out.albumId) out.albumId = id;
  }
  return out;
}

function songFromListItem(r) {
  const id = r.playlistItemData?.videoId
    ?? r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId;
  if (!id || id.length !== 11) return null;
  const cols = r.flexColumns ?? [];
  const title = runsText(cols[0]?.musicResponsiveListItemFlexColumnRenderer?.text);
  const sub = runsText(cols[1]?.musicResponsiveListItemFlexColumnRenderer?.text);
  const artist = sub.split(' • ').filter((p) => !/^(Song|Video|Single|EP|Album)$/i.test(p.trim()))[0]?.trim() ?? '';
  const fixed = runsText(r.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text);
  const [m, s] = fixed.split(':').map(Number);
  return { kind: 'song', id, title, artist, duration: Number.isFinite(m) && Number.isFinite(s) ? m * 60 + s : 0, thumbnail: lastThumb(r.thumbnail), ...idsFromRuns(cols[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs, cols[2]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs) };
}

function listItem(r) {
  const song = songFromListItem(r);
  if (song) return song;
  const t = browseTarget(r.navigationEndpoint);
  if (!t) return null;
  return { kind: t.kind, id: t.id, params: t.params, title: runsText(r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text), artist: runsText(r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text), thumbnail: lastThumb(r.thumbnail) };
}

function twoRowItem(r) {
  const nav = r.navigationEndpoint;
  const title = runsText(r.title);
  const subtitle = runsText(r.subtitle);
  const thumbnail = lastThumb(r.thumbnailRenderer);
  const vid = nav?.watchEndpoint?.videoId;
  if (vid && vid.length === 11) return { kind: 'song', id: vid, title, artist: subtitle.split(' • ').filter((p) => !/^(Song|Video|Single|EP|Album)$/i.test(p.trim()))[0]?.trim() ?? '', duration: 0, thumbnail, ...idsFromRuns(r.subtitle?.runs) };
  const t = browseTarget(nav);
  if (t) return { kind: t.kind, id: t.id, params: t.params, title, artist: subtitle, thumbnail };
  const pl = nav?.watchPlaylistEndpoint?.playlistId;
  if (pl) return { kind: 'playlist', id: pl, title, artist: subtitle, thumbnail };
  return null;
}

function navButton(r) {
  const be = r.clickCommand?.browseEndpoint;
  if (!be?.browseId) return null;
  return { kind: 'mood', id: be.browseId, params: be.params, title: runsText(r.buttonText), artist: '', thumbnail: '' };
}

function itemsOf(contents) {
  const out = [];
  for (const c of contents ?? []) {
    const item =
      (c.musicTwoRowItemRenderer && twoRowItem(c.musicTwoRowItemRenderer)) ||
      (c.musicResponsiveListItemRenderer && listItem(c.musicResponsiveListItemRenderer)) ||
      (c.musicNavigationButtonRenderer && navButton(c.musicNavigationButtonRenderer));
    if (item) out.push(item);
  }
  return out;
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((i) => { const k = `${i.kind}:${i.id}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

function findContinuation(data) {
  let tok = null;
  walk(data, (n) => {
    if (!tok && n.continuationCommand?.token) tok = n.continuationCommand.token;
    if (!tok && n.nextContinuationData?.continuation) tok = n.nextContinuationData.continuation;
  });
  return tok;
}

// -> { header: {title, subtitle, thumbnail}|null, sections: [{title, items}] }
function parseBrowse(data) {
  const sections = [];
  const push = (title, items) => {
    items = dedupe(items);
    if (items.length) sections.push({ title: title || '', items });
  };
  walk(data, (n) => {
    if (n.musicCarouselShelfRenderer) {
      const c = n.musicCarouselShelfRenderer;
      push(runsText(c.header?.musicCarouselShelfBasicHeaderRenderer?.title), itemsOf(c.contents));
    }
    if (n.musicImmersiveCarouselShelfRenderer) {
      const c = n.musicImmersiveCarouselShelfRenderer;
      push(runsText(c.header?.musicImmersiveCarouselShelfBasicHeaderRenderer?.title), itemsOf(c.contents));
    }
    if (n.musicShelfRenderer) {
      const c = n.musicShelfRenderer;
      push(runsText(c.title), itemsOf(c.contents));
    }
    if (n.musicPlaylistShelfRenderer) {
      push('Songs', itemsOf(n.musicPlaylistShelfRenderer.contents));
    }
    if (n.gridRenderer) {
      const c = n.gridRenderer;
      push(runsText(c.header?.gridHeaderRenderer?.title), itemsOf(c.items));
    }
  });
  let header = null;
  walk(data, (n) => {
    if (header) return;
    const h = n.musicImmersiveHeaderRenderer || n.musicDetailHeaderRenderer || n.musicResponsiveHeaderRenderer || n.musicVisualHeaderRenderer;
    if (h) header = { title: runsText(h.title), subtitle: runsText(h.subtitle) || runsText(h.straplineTextOne), thumbnail: lastThumb(h.thumbnail) };
  });
  // Album tracks have no thumbnail of their own: borrow the album cover.
  if (header?.thumbnail) sections.forEach((s) => s.items.forEach((i) => { if (i.kind === 'song' && !i.thumbnail) i.thumbnail = header.thumbnail; }));
  return { header, sections };
}

module.exports = { idsFromRuns, parseBrowse, findContinuation, runsText, walk, songFromListItem, lastThumb };
