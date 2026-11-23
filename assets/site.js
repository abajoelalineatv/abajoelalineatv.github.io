// Menú móvil
const menuBtn = document.querySelector('.menu-btn');
const nav = document.getElementById('mainnav');
menuBtn?.addEventListener('click', () => {
  const open = !nav.classList.contains('open');
  nav.classList.toggle('open', open);
  menuBtn.setAttribute('aria-expanded', String(open));
  menuBtn.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
});

// Publicidad: si hay varios avisos en el mismo espacio, mostrar uno al azar
document.querySelectorAll('.ad').forEach((ad) => {
  const items = ad.querySelectorAll('.ad-item');
  if (items.length < 2) return;
  const elegido = Math.floor(Math.random() * items.length);
  items.forEach((it, i) => { it.hidden = i !== elegido; });
});

// Copiar enlace de una nota
document.querySelectorAll('.copy').forEach((b) => b.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(b.dataset.url); b.textContent = '¡Copiado!'; } catch { prompt('Copia este enlace:', b.dataset.url); }
  setTimeout(() => { b.textContent = 'Copiar enlace'; }, 2000);
}));

// Videos de YouTube en ventana emergente (sin salir de la página)
const dlg = document.getElementById('player');
const frame = dlg?.querySelector('.player-frame');
const closePlayer = () => { dlg.close(); };
dlg?.addEventListener('close', () => { frame.innerHTML = ''; });
dlg?.querySelector('.player-close').addEventListener('click', closePlayer);
dlg?.addEventListener('click', (e) => { if (e.target === dlg) closePlayer(); });

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-yt]');
  if (!a || !dlg || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  const id = a.dataset.yt;
  document.getElementById('player-title').textContent = a.dataset.title || '';
  frame.classList.toggle('vertical', !!a.dataset.short);
  frame.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0" title="${(a.dataset.title || 'Video').replace(/"/g, '&quot;')}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
  const live = document.getElementById('live');
  if (live && !live.paused) live.pause();
  dlg.showModal();
});

// Señal en vivo (HLS)
const video = document.getElementById('live');
if (video && window.STREAM_URL) {
  const msg = document.querySelector('.live-msg');
  const unmute = document.querySelector('.unmute');
  let hls;

  let retryTimer;
  // Si la señal se cae, mostrar aviso y reintentar solo cada 20 segundos
  const fail = () => { msg.hidden = false; unmute.hidden = true; clearTimeout(retryTimer); retryTimer = setTimeout(start, 20000); };
  const ok = () => {
    msg.hidden = true;
    video.play().then(() => { unmute.hidden = !video.muted; }).catch(() => { /* autoplay bloqueado: el usuario usa los controles */ });
  };

  function start() {
    clearTimeout(retryTimer);
    if (window.Hls && Hls.isSupported()) {
      hls?.destroy();
      hls = new Hls({ liveSyncDurationCount: 3 });
      hls.loadSource(window.STREAM_URL);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, ok);
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else fail();
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = window.STREAM_URL;
      video.addEventListener('loadedmetadata', ok, { once: true });
      video.addEventListener('error', fail, { once: true });
    } else {
      fail();
    }
  }

  unmute.addEventListener('click', () => { video.muted = false; video.volume = 1; unmute.hidden = true; });
  video.addEventListener('volumechange', () => { if (!video.muted) unmute.hidden = true; });
  document.querySelector('.retry').addEventListener('click', start);

  // hls.js se carga con defer: esperamos a que esté listo
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
}
