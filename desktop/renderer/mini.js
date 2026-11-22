const $ = (id) => document.getElementById(id);
const PLAY = 'M8 5v14l11-7z', PAUSE = 'M6 19h4V5H6v14zm8-14v14h4V5h-4z';
document.addEventListener('click', (e) => { const b = e.target.closest('[data-a]'); if (b) window.api.miniAction(b.dataset.a); });
window.api.onMiniState((s) => {
  $('t').textContent = s.title || 'Nothing playing';
  $('a').textContent = s.artist || '';
  if (s.thumbnail !== undefined) { $('art').src = s.thumbnail || ''; $('bg').style.backgroundImage = s.thumbnail ? `url("${s.thumbnail}")` : ''; }
  $('pi').firstElementChild.setAttribute('d', s.playing ? PAUSE : PLAY);
  $('fill').style.width = s.duration ? Math.min(100, (s.position / s.duration) * 100) + '%' : '0';
});
