// Genera la web completa en public/ a partir de:
//   config.json            → datos del canal, categorías y programas
//   data/videos.json       → videos de YouTube (se actualiza solo)
//   content/noticias/*.md  → notas (se escriben desde el administrador)
// Uso: node scripts/build.mjs   (Vercel lo corre solo en cada publicación)
import { readFile, writeFile, mkdir, rm, cp, readdir } from 'node:fs/promises';
import matter from 'gray-matter';
import { marked } from 'marked';
import { medidas } from './medidas.mjs';

const root = new URL('..', import.meta.url);
const out = new URL('public/', root);
const cfg = JSON.parse(await readFile(new URL('config.json', root), 'utf8'));
const raw = JSON.parse(await readFile(new URL('data/videos.json', root), 'utf8'));
// Textos editables desde el administrador ("Textos del sitio") → content/textos.json
let T = {};
try { T = JSON.parse(await readFile(new URL('content/textos.json', root), 'utf8')); } catch { /* usa config.json */ }
const S = {
  ...cfg.sitio,
  ...(T.lema ? { lema: T.lema } : {}),
  ...(T.descripcion ? { descripcion: T.descripcion } : {}),
  ...(T.canal_tvd ? { canalTvd: T.canal_tvd } : {}),
  ...(T.email ? { email: T.email } : {}),
  ...(T.whatsapp !== undefined ? { whatsapp: T.whatsapp } : {}),
};
const tx = (k, porDefecto) => (T[k] !== undefined && T[k] !== '' ? T[k] : porDefecto);
const TZ = 'America/Santiago';

// ---------- utilidades ----------
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s = '') => s.normalize('NFKC').toLowerCase();
const fecha = (d, modo = 'corta') => {
  const opts = { corta: { day: 'numeric', month: 'short' }, larga: { day: 'numeric', month: 'long', year: 'numeric' }, hora: { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false } }[modo];
  return new Date(d).toLocaleString('es-CL', { ...opts, timeZone: TZ }).replace('.', '');
};
const aFecha = (v) => {
  if (v instanceof Date) return v;
  const s = String(v || '').trim();
  if (!s) return new Date(0);
  // Fecha sin zona horaria (como la guarda el administrador) = hora de Chile
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : (s.length <= 10 ? `${s}T12:00` : s) + '-03:00');
};

function limpiarTitulo(t) {
  return t.normalize('NFKC')
    .replace(/\*\*/g, '')
    .replace(/(^|\s)#[\p{L}\p{N}_]+/gu, '')
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/gu, '')
    .split('|').map((x) => x.trim()).filter((x) => x && !/abajo.{0,3}e.? ?la l[ií]nea/i.test(x))
    .join(' | ').replace(/\s{2,}/g, ' ').replace(/^[“"]|[”"]$/g, '').trim();
}

const cats = Object.fromEntries(cfg.categorias.map((c) => [c.id, c]));
const progs = Object.fromEntries(cfg.programas.map((p) => [p.id, p]));
const catNombre = (id) => cats[id]?.nombre || id;

// ---------- videos ----------
function clasificar(v) {
  const t = norm(v.titulo + ' ' + (v.descripcion || '').slice(0, 120));
  const tn = norm(v.titulo);
  const programa = v.programa ?? cfg.programas.find((p) => p.palabras.some((w) => tn.includes(norm(w))))?.id ?? null;
  let categoria = v.categoria ?? (programa ? progs[programa].categoria : null);
  if (!categoria) {
    let mejor = null, max = 0;
    for (const c of cfg.categorias) {
      const n = c.palabras.filter((w) => t.includes(norm(w))).length;
      if (n > max) { max = n; mejor = c.id; }
    }
    categoria = mejor || cfg.categorias[0].id;
  }
  let titulo = limpiarTitulo(v.titulo);
  if (programa) {
    const n = norm(progs[programa].nombre);
    const resto = titulo.split(' | ').filter((x) => !(norm(x).includes(n) && x.length <= n.length + 12));
    if (resto.length) titulo = resto.join(' | ');
  }
  return { ...v, programa, categoria, titulo };
}
const videos = raw.filter((v) => !v.oculto).map(clasificar).sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
const vidCat = (id) => videos.filter((v) => v.categoria === id);
const vidProg = (id) => videos.filter((v) => v.programa === id);
const thumb = (id, q = 'hqdefault') => `https://i.ytimg.com/vi/${id}/${q}.jpg`;
const ytId = (u = '') => (String(u).match(/(?:youtu\.be\/|v=|embed\/|shorts\/|live\/)([\w-]{11})/) || [])[1];

// ---------- noticias ----------
const dirNotas = new URL('content/noticias/', root);
let archivos = [];
try { archivos = (await readdir(dirNotas)).filter((f) => f.endsWith('.md')); } catch { /* sin notas aún */ }
const notas = [];
for (const f of archivos) {
  const { data: d, content } = matter(await readFile(new URL(f, dirNotas), 'utf8'));
  if (d.borrador || !d.titulo) continue;
  const slug = f.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  const html = marked.parse(content || '');
  // Proporción de la foto (alto/ancho), para decidir cómo encuadrarla
  let proporcion = null;
  if (d.imagen && String(d.imagen).startsWith('/')) {
    try { const m = medidas(await readFile(new URL('.' + d.imagen, root))); if (m) proporcion = m.h / m.w; } catch { /* imagen no encontrada */ }
  }
  const texto = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  notas.push({
    slug, url: `/noticias/${slug}`,
    titulo: String(d.titulo).trim(),
    bajada: String(d.bajada || texto.slice(0, 180)).trim(),
    fecha: aFecha(d.fecha),
    categoria: cats[d.categoria] ? d.categoria : cfg.categorias[0].id,
    imagen: d.imagen || '',
    proporcion,
    pie: d.pie_imagen || '',
    autor: d.autor || S.nombre,
    destacada: !!d.destacada,
    video: ytId(d.video),
    fuente: d.fuente || '',
    html,
    minutos: Math.max(1, Math.round(texto.split(' ').length / 200)),
  });
}
notas.sort((a, b) => b.fecha - a.fecha);
const notCat = (id) => notas.filter((n) => n.categoria === id);
// Portada: la última nota marcada como destacada (si es reciente) o la más nueva
const lead = notas.find((n) => n.destacada && n.fecha > (notas[0]?.fecha || 0) - 7 * 864e5) || notas[0];

// ---------- piezas ----------
const etiqueta = (v) => v.programa ? progs[v.programa].nombre : catNombre(v.categoria);
const tag = (c, txt = catNombre(c)) => `<span class="tag tag-${c}">${esc(txt)}</span>`;
// Imagen completa sobre un fondo difuminado de sí misma: así las gráficas
// verticales de Instagram y los Shorts no se cortan ni dejan franjas negras.
const marco = (src, vertical = false) =>
  `<img class="bg" src="${src}" alt="" aria-hidden="true" loading="lazy"><img class="fg${vertical ? ' vert' : ''}" src="${src}" alt="" loading="lazy">`;
// Noticias en 4:5: las gráficas 4:5 y 9:16 de Instagram llenan la tarjeta;
// solo las fotos horizontales (raras) usan el marco difuminado.
const img = (n) => {
  if (!n.imagen) return `<div class="noimg"><img src="/assets/img/logo.png" alt=""></div>`;
  if (n.proporcion !== null && n.proporcion < 1.05) return marco(esc(n.imagen));
  return `<img src="${esc(n.imagen)}" alt="" loading="lazy">`;
};
const vthumb = (v) => `<img src="${thumb(v.id)}" alt="" loading="lazy" width="480" height="360">`;
const sthumb = (v) => `<img src="https://i.ytimg.com/vi/${v.id}/oar2.jpg" alt="" loading="lazy" width="360" height="640" onerror="this.onerror=null;this.src='${thumb(v.id)}'">`;

const card = (v) => `
<a class="card" href="https://www.youtube.com/watch?v=${v.id}" data-yt="${v.id}" data-title="${esc(v.titulo)}">
  <div class="thumb">${vthumb(v)}<span class="play" aria-hidden="true"></span></div>
  <div class="card-body">${tag(v.categoria, etiqueta(v))}<h3>${esc(v.titulo)}</h3><time datetime="${v.fecha}">${fecha(v.fecha)}</time></div>
</a>`;

const scard = (v) => `
<a class="scard" href="https://www.youtube.com/shorts/${v.id}" data-yt="${v.id}" data-short="1" data-title="${esc(v.titulo)}">
  <div class="sthumb">${sthumb(v)}<span class="play" aria-hidden="true"></span><p>${esc(v.titulo)}</p></div>
</a>`;
const shelf = (lista) => `<div class="shelf">${lista.map(scard).join('')}</div>`;

const ncard = (n, { bajada = false } = {}) => `
<a class="card ncard" href="${n.url}">
  <div class="thumb t45">${img(n)}${n.video ? '<span class="play" aria-hidden="true"></span>' : ''}</div>
  <div class="card-body">${tag(n.categoria)}<h3>${esc(n.titulo)}</h3>${bajada ? `<p>${esc(n.bajada)}</p>` : ''}<time datetime="${n.fecha.toISOString()}">${fecha(n.fecha)}</time></div>
</a>`;

const nrow = (n) => `
<a class="nrow" href="${n.url}">
  <time datetime="${n.fecha.toISOString()}">${fecha(n.fecha, 'hora').replace(/,\s*/, '<br>')}</time>
  <div>${tag(n.categoria)}<p>${esc(n.titulo)}</p></div>
</a>`;

const leadBlock = (principal, secundarias) => principal ? `
<div class="front">
  <a class="front-lead" href="${principal.url}">
    <div class="front-img t45">${img(principal)}</div>
    <div class="front-txt">${tag(principal.categoria)}<h3>${esc(principal.titulo)}</h3><p>${esc(principal.bajada)}</p><time>${fecha(principal.fecha, 'larga')} · ${esc(principal.autor)}</time><span class="read">Leer nota →</span></div>
  </a>
  <div class="front-side">${secundarias.map((n) => `
    <a class="front-sec" href="${n.url}"><div class="front-sec-img t45">${img(n)}</div><div>${tag(n.categoria)}<h4>${esc(n.titulo)}</h4><time>${fecha(n.fecha)}</time></div></a>`).join('')}
  </div>
</div>` : '<p class="empty">Todavía no hay noticias publicadas.</p>';

const progCard = (p) => {
  const eps = vidProg(p.id);
  return `
<a class="prog" href="/programa-${p.id}">
  <div class="prog-img">${eps.length ? vthumb(eps.find((v) => !v.short) || eps[0]) : '<div class="noimg"><img src="/assets/img/logo.png" alt=""></div>'}</div>
  <div class="prog-body">${tag(p.categoria)}<h3>${esc(p.nombre)}</h3><p>${esc(p.descripcion)}</p><span class="meta">${eps.length} ${eps.length === 1 ? 'episodio' : 'episodios'}</span></div>
</a>`;
};

const seccion = ({ kicker, titulo, desc = '', link, linkTxt = 'Ver todo', cuerpo, id = '', clase = '' }) => `
<section class="block ${clase}" ${id ? `id="${id}"` : ''}>
  <div class="wrap">
    <header class="block-head">
      <div>${kicker ? `<span class="kicker">${esc(kicker)}</span>` : ''}<h2>${esc(titulo)}</h2>${desc ? `<p>${esc(desc)}</p>` : ''}</div>
      ${link ? `<a class="more" href="${link}">${esc(linkTxt)} <span aria-hidden="true">→</span></a>` : ''}
    </header>
    ${cuerpo}
  </div>
</section>`;

const grid = (items, fn = card) => items.length ? `<div class="grid">${items.map((x) => fn(x)).join('')}</div>` : `<p class="empty">Pronto habrá contenido en esta sección.</p>`;
const ngrid = (items, opts) => items.length ? `<div class="grid grid-n${items.length === 5 ? ' row5' : ''}">${items.map((n) => ncard(n, opts)).join('')}</div>` : `<p class="empty">Todavía no hay noticias en esta sección.</p>`;
// Videos: los Shorts van aparte en su fila vertical
const largos = (l) => l.filter((v) => !v.short);
const cortos = (l) => l.filter((v) => v.short);

const enviaNota = S.whatsapp ? `https://wa.me/${S.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent('Hola, quiero mandarles una nota:')}` : `mailto:${S.email}?subject=${encodeURIComponent('Nota para Abajo\'e la Línea')}`;

const icon = {
  yt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M23 7.2a3 3 0 0 0-2.1-2.1C19 4.6 12 4.6 12 4.6s-7 0-8.9.5A3 3 0 0 0 1 7.2 31 31 0 0 0 .6 12 31 31 0 0 0 1 16.8a3 3 0 0 0 2.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .4-4.8 31 31 0 0 0-.4-4.8ZM9.7 15.1V8.9L15.5 12l-5.8 3.1Z"/></svg>',
  ig: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.2c3.2 0 3.6 0 4.8.1 3.3.1 4.8 1.7 4.9 4.9.1 1.3.1 1.6.1 4.8s0 3.6-.1 4.8c-.1 3.2-1.7 4.8-4.9 4.9-1.3.1-1.6.1-4.8.1s-3.6 0-4.8-.1c-3.3-.1-4.8-1.7-4.9-4.9C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.8C2.4 3.9 3.9 2.4 7.2 2.3c1.2-.1 1.6-.1 4.8-.1ZM12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0 8.2a3.2 3.2 0 1 1 0-6.4 3.2 3.2 0 0 1 0 6.4Zm5.2-9.6a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Z"/></svg>',
  fb: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M24 12a12 12 0 1 0-13.9 11.9v-8.4h-3V12h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.4l-.5 3.5h-2.9v8.4A12 12 0 0 0 24 12Z"/></svg>',
  wa: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.5 14.4c-.3-.1-1.8-.9-2-1-.3-.1-.5-.1-.7.1-.2.3-.8 1-.9 1.2-.2.2-.3.2-.6.1-.3-.1-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.4-.5.3-.5v-.5c-.1-.1-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.3-.7.3-1.3.2-1.4-.1-.1-.3-.2-.6-.3ZM12 21.8c-1.8 0-3.5-.5-5-1.4l-.4-.2-3.7 1 1-3.6-.2-.4A9.8 9.8 0 1 1 12 21.8ZM12 0a12 12 0 0 0-10.3 18L0 24l6.2-1.6A12 12 0 1 0 12 0Z"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.2 2.3h3.4l-7.4 8.4 8.7 11.5h-6.8l-5.3-7-6.1 7H1.3l7.9-9L.9 2.3h7l4.8 6.4 5.5-6.4Zm-1.2 18h1.9L7.1 4.2H5.1l11.9 16.1Z"/></svg>',
};

const redes = `
<div class="social">
  <a href="${cfg.redes.youtube}" target="_blank" rel="noopener" aria-label="YouTube">${icon.yt}</a>
  <a href="${cfg.redes.instagram}" target="_blank" rel="noopener" aria-label="Instagram">${icon.ig}</a>
  <a href="${cfg.redes.facebook}" target="_blank" rel="noopener" aria-label="Facebook">${icon.fb}</a>
</div>`;

function pagina({ ruta, titulo, desc = S.descripcion, activo, cuerpo, hls = false, imagen, extraHead = '' }) {
  const full = titulo ? `${titulo} — ${S.nombre}` : `${S.nombre} — Televisión comunitaria de Temuco`;
  const url = S.url + ruta;
  const ogImg = imagen ? (imagen.startsWith('http') ? imagen : S.url + imagen) : `${S.url}/assets/img/logo.png`;
  const main = [['/', 'Inicio', 'inicio'], ['/noticias', 'Noticias', 'noticias'], ['/programas', 'Programas', 'programas'], ['/nosotros', 'Nosotros', 'nosotros']];
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(full)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="${ruta.startsWith('/noticias/') ? 'article' : 'website'}">
<meta property="og:site_name" content="${esc(S.nombre)}">
<meta property="og:title" content="${esc(titulo || full)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${esc(ogImg)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0c0c0e">
<link rel="icon" href="/assets/img/logo.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,500;12..96,600;12..96,700;12..96,800&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/style.css">
${extraHead}
</head>
<body>
<a class="skip" href="#contenido">Saltar al contenido</a>
<header class="topbar">
  <div class="wrap topbar-inner">
    <a class="brand" href="/" aria-label="${esc(S.nombre)}, inicio">
      <img src="/assets/img/logo.png" alt="" width="44" height="44">
      <span><strong>Abajo'e la Línea</strong><small>TV comunitaria · Temuco</small></span>
    </a>
    <nav class="mainnav" id="mainnav" aria-label="Principal">
      ${main.map(([h, t, k]) => `<a href="${h}"${k === activo ? ' aria-current="page"' : ''}>${t}</a>`).join('')}
      <span class="nav-sep">Secciones</span>
      ${cfg.categorias.map((c) => `<a class="nav-cat" href="/${c.id}"${c.id === activo ? ' aria-current="page"' : ''}>${esc(c.nombre)}</a>`).join('')}
    </nav>
    <a class="send-btn" href="${enviaNota}">${S.whatsapp ? icon.wa : '✉'}<span>Envía tu nota</span></a>
    <a class="live-btn" href="/#envivo"><span class="dot"></span>En vivo</a>
    <button class="menu-btn" aria-controls="mainnav" aria-expanded="false" aria-label="Abrir menú"><span></span></button>
  </div>
  <nav class="catbar" aria-label="Secciones"><div class="wrap">
    ${cfg.categorias.map((c) => `<a class="cat cat-${c.id}" href="/${c.id}"${c.id === activo ? ' aria-current="page"' : ''}>${esc(c.nombre)}</a>`).join('')}
    <a class="cat" href="/programas"${activo === 'programas' ? ' aria-current="page"' : ''}>Programas</a>
  </div></nav>
</header>
<main id="contenido">
${cuerpo}
</main>
<div class="guarda" aria-hidden="true"></div>
<footer class="footer">
  <div class="wrap footer-grid">
    <div class="footer-brand">
      <img src="/assets/img/logo.png" alt="" width="64" height="64">
      <p><strong>${esc(S.nombre)}</strong><br>${esc(tx('pie_texto', `Televisión comunitaria desde ${S.ciudad}. Señal abierta TVD ${S.canalTvd} y en vivo por internet.`))}</p>
      ${redes}
    </div>
    <div><h4>Noticias</h4><ul>${cfg.categorias.map((c) => `<li><a href="/${c.id}">${esc(c.nombre)}</a></li>`).join('')}</ul></div>
    <div><h4>Programas</h4><ul>${cfg.programas.map((p) => `<li><a href="/programa-${p.id}">${esc(p.nombre)}</a></li>`).join('')}</ul></div>
    <div><h4>El canal</h4><ul><li><a href="/#envivo">Señal en vivo</a></li><li><a href="/nosotros">Quiénes somos</a></li><li><a href="/nosotros#sintonia">Cómo sintonizarnos</a></li><li><a href="${enviaNota}">Envía tu nota</a></li><li><a href="mailto:${S.email}">${esc(S.email)}</a></li></ul></div>
  </div>
  <div class="wrap footer-legal"><span>© ${new Date().getFullYear()} ${esc(S.nombre)}</span><span>Medio comunitario autogestionado</span></div>
</footer>
<dialog class="player" id="player" aria-label="Reproductor de video">
  <div class="player-inner">
    <div class="player-head"><p id="player-title"></p><button class="player-close" aria-label="Cerrar">✕</button></div>
    <div class="player-frame"></div>
  </div>
</dialog>
${hls ? `<script>window.STREAM_URL=${JSON.stringify(cfg.envivo.hls)};</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.13/hls.min.js" defer></script>` : ''}
<script src="/assets/site.js" defer></script>
</body>
</html>
`;
}

// Texto plano con correos convertidos en enlaces
const conEnlaces = (s = '') => esc(s).replace(/[\w.+-]+@[\w-]+\.[\w.]+[a-z]/gi, (m) => `<a href="mailto:${m}">${m}</a>`);
const sintoniaBlock = (clase = 'alt', conRedes = false) => {
  const items = Array.isArray(T.sintonia) && T.sintonia.length ? T.sintonia : [
    { destacado: S.canalTvd, titulo: 'TV abierta · 24 horas', texto: `Busca el canal ${S.canalTvd} en Temuco y alrededores.` },
    { destacado: 'En vivo', titulo: 'Por internet', texto: 'La misma señal, en vivo en la portada de esta web.' },
  ];
  return `
<section class="block tune ${clase}" id="sintonia"><div class="wrap">
  <header class="block-head"><div><span class="kicker">Sintonía</span><h2>${esc(tx('sintonia_titulo', 'Cómo vernos'))}</h2></div></header>
  <div class="tune-grid">${items.map((it, i) => `
    <div class="tune-item"><span class="num">${esc(it.destacado || '')}</span><h3>${esc(it.titulo || '')}</h3><p>${conEnlaces(it.texto || '')}</p>${conRedes && i === items.length - 1 ? redes : ''}</div>`).join('')}
  </div>
</div></section>`;
};

const paginas = {}; // archivo → html
const add = (archivo, opts) => { paginas[archivo] = pagina(opts); };

// ---------- Inicio ----------
{
  const secundarias = notas.filter((n) => n !== lead).slice(0, 4);
  const usadas = new Set([lead, ...secundarias]);
  const masNoticias = notas.filter((n) => !usadas.has(n)).slice(0, 5);
  masNoticias.forEach((n) => usadas.add(n));
  const insta = cfg.redes.beholdFeedId
    ? `<behold-widget feed-id="${esc(cfg.redes.beholdFeedId)}"></behold-widget><script type="module" src="https://w.behold.so/widget.js"></script>`
    : `<a class="insta-cta" href="${cfg.redes.instagram}" target="_blank" rel="noopener">${icon.ig}<div><strong>@${esc(cfg.redes.instagramUsuario)}</strong><span>${esc(tx('instagram_texto', 'Síguenos en Instagram.'))}</span></div><span class="more">Ir a Instagram →</span></a>`;

  const bloqueCat = (c) => {
    const ns = notCat(c.id).filter((n) => !usadas.has(n)).slice(0, 5);
    const vs = largos(vidCat(c.id)).slice(0, 4);
    if (!ns.length && !vs.length) return '';
    return seccion({ kicker: 'Sección', titulo: c.nombre, desc: c.descripcion, link: `/${c.id}`, cuerpo: ns.length ? ngrid(ns) : grid(vs) });
  };

  add('index.html', {
    ruta: '/', activo: 'inicio', hls: true,
    cuerpo: `
<section class="hero" id="envivo">
  <div class="wrap hero-grid">
    <div class="live">
      <div class="live-frame">
        <video id="live" playsinline muted autoplay controls poster="/assets/img/poster.svg"></video>
        <span class="onair"><span class="dot"></span>EN VIVO</span>
        <button class="unmute" hidden>🔊 Activar sonido</button>
        <div class="live-msg" hidden><strong>Señal en pausa</strong><span>No pudimos cargar la transmisión en este momento. Intenta de nuevo en unos minutos o sintoniza el canal ${esc(S.canalTvd)}.</span><button class="retry">Reintentar</button></div>
      </div>
      <div class="live-info">
        <div><span class="kicker">${esc(tx('etiqueta_envivo', 'Señal en vivo'))}</span><h1${S.lema.length > 48 ? ' class="largo"' : ''}>${esc(S.lema)}</h1></div>
        <div class="channel-badge"><span>TVD</span><strong>${esc(S.canalTvd)}</strong><small>Temuco</small></div>
      </div>
    </div>
    <aside class="hero-side">
      <h2 class="side-title"><span class="dot red"></span>Últimas noticias</h2>
      <div class="side-list">${notas.slice(0, 6).map(nrow).join('')}</div>
      <a class="more" href="/noticias">Todas las noticias →</a>
    </aside>
  </div>
</section>

<div class="guarda" aria-hidden="true"></div>

${seccion({ kicker: 'Portada', titulo: 'Noticias', link: '/noticias', linkTxt: 'Ver todas', clase: 'front-block', cuerpo: leadBlock(lead, secundarias) + (masNoticias.length ? `<div class="more-news">${ngrid(masNoticias)}</div>` : '') })}

${cortos(videos).length ? seccion({ kicker: 'Formato corto', titulo: 'Shorts y reels', link: `${cfg.redes.youtube}/shorts`, linkTxt: 'Ver en YouTube', cuerpo: shelf(cortos(videos).slice(0, 12)), clase: 'alt' }) : ''}

${seccion({ kicker: 'Video', titulo: 'Lo último en video', link: cfg.redes.youtube, linkTxt: 'Canal de YouTube', cuerpo: grid(largos(videos).slice(0, 8)) })}

${seccion({ kicker: 'Al aire', titulo: 'Nuestros programas', desc: 'Espacios propios, hechos en Temuco con la comunidad.', link: '/programas', cuerpo: `<div class="progs">${cfg.programas.map(progCard).join('')}</div>`, clase: 'alt' })}

${cfg.categorias.map(bloqueCat).join('')}

<section class="block alt">
  <div class="wrap send-band">
    <div><span class="kicker">${esc(tx('envia_etiqueta', 'Periodismo desde el territorio'))}</span><h2>${esc(tx('envia_titulo', '¿Pasa algo en tu barrio?'))}</h2><p>${esc(tx('envia_texto', ''))}</p></div>
    <a class="btn" href="${enviaNota}">${esc(tx('envia_boton', 'Envía tu nota'))}</a>
  </div>
</section>

${seccion({ kicker: 'Redes', titulo: 'En Instagram', cuerpo: insta })}

${sintoniaBlock()}`,
  });
}

// ---------- Noticias (todas) ----------
const filtros = (activo) => `<div class="chips"><a class="chip${activo === 'todas' ? ' on' : ''}" href="/noticias">Todas</a>${cfg.categorias.filter((c) => notCat(c.id).length).map((c) => `<a class="chip chip-${c.id}${activo === c.id ? ' on' : ''}" href="/${c.id}">${esc(c.nombre)}</a>`).join('')}</div>`;
add('noticias.html', {
  ruta: '/noticias', titulo: 'Noticias', activo: 'noticias',
  desc: `Noticias de Temuco y La Araucanía desde los territorios: ${cfg.categorias.map((c) => c.nombre).join(', ')}.`,
  cuerpo: `
<section class="page-head"><div class="wrap"><span class="kicker">Noticias</span><h1>Lo que pasa en el territorio</h1><p>Noticias de Temuco y La Araucanía contadas desde las organizaciones, los barrios y las comunidades.</p>${filtros('todas')}</div></section>
${seccion({ titulo: 'Portada', cuerpo: leadBlock(lead, notas.filter((n) => n !== lead).slice(0, 4)) })}
${seccion({ titulo: 'Todas las noticias', cuerpo: ngrid(notas.filter((n) => n !== lead).slice(4), { bajada: true }), clase: 'alt' })}`,
});

// ---------- Cada nota ----------
for (const n of notas) {
  const rel = notCat(n.categoria).filter((x) => x !== n).slice(0, 5);
  const recientes = notas.filter((x) => x !== n).slice(0, 5);
  const share = encodeURIComponent(S.url + n.url);
  const ld = { '@context': 'https://schema.org', '@type': 'NewsArticle', headline: n.titulo, description: n.bajada, datePublished: n.fecha.toISOString(), author: { '@type': 'Organization', name: n.autor }, publisher: { '@type': 'Organization', name: S.nombre, logo: { '@type': 'ImageObject', url: `${S.url}/assets/img/logo.png` } }, ...(n.imagen ? { image: [S.url + n.imagen] } : {}), mainEntityOfPage: S.url + n.url };
  add(`noticias/${n.slug}.html`, {
    ruta: n.url, titulo: n.titulo, desc: n.bajada, activo: n.categoria, imagen: n.imagen,
    extraHead: `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`,
    cuerpo: `
<article class="article wrap">
  <div class="article-main">
    <nav class="crumbs"><a href="/noticias">Noticias</a> / <a href="/${n.categoria}">${esc(catNombre(n.categoria))}</a></nav>
    ${tag(n.categoria)}
    <h1>${esc(n.titulo)}</h1>
    <p class="lede">${esc(n.bajada)}</p>
    <div class="byline"><span>Por <strong>${esc(n.autor)}</strong></span><time datetime="${n.fecha.toISOString()}">${fecha(n.fecha, 'larga')}</time><span>${n.minutos} min de lectura</span></div>
    ${n.video ? `<div class="article-video"><iframe src="https://www.youtube-nocookie.com/embed/${n.video}?rel=0" title="${esc(n.titulo)}" loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`
      : n.imagen ? `<figure class="article-img"><img src="${esc(n.imagen)}" alt="${esc(n.pie || '')}">${n.pie ? `<figcaption>${esc(n.pie)}</figcaption>` : ''}</figure>` : ''}
    <div class="prose article-body">${n.html}</div>
    ${n.fuente ? `<p class="source">Publicado originalmente en <a href="${esc(n.fuente)}" target="_blank" rel="noopener">${/instagram/.test(n.fuente) ? 'nuestro Instagram' : 'esta fuente'}</a>.</p>` : ''}
    <div class="share"><span>Compartir</span>
      <a href="https://wa.me/?text=${encodeURIComponent(n.titulo + ' ')}${share}" target="_blank" rel="noopener" aria-label="Compartir en WhatsApp">${icon.wa}</a>
      <a href="https://www.facebook.com/sharer/sharer.php?u=${share}" target="_blank" rel="noopener" aria-label="Compartir en Facebook">${icon.fb}</a>
      <a href="https://twitter.com/intent/tweet?url=${share}&text=${encodeURIComponent(n.titulo)}" target="_blank" rel="noopener" aria-label="Compartir en X">${icon.x}</a>
      <button class="copy" data-url="${S.url + n.url}">Copiar enlace</button>
    </div>
  </div>
  <aside class="article-side">
    <a class="side-live" href="/#envivo"><span class="onair"><span class="dot"></span>EN VIVO</span><strong>Mira la señal en vivo</strong><span>Canal ${esc(S.canalTvd)} · TV abierta e internet</span></a>
    <h2 class="side-title">Lo más reciente</h2>
    <div class="side-list">${recientes.map(nrow).join('')}</div>
  </aside>
</article>
${rel.length ? seccion({ kicker: 'Sigue leyendo', titulo: `Más en ${catNombre(n.categoria)}`, link: `/${n.categoria}`, cuerpo: ngrid(rel), clase: 'alt' }) : ''}`,
  });
}

// ---------- Cada categoría ----------
for (const c of cfg.categorias) {
  const ns = notCat(c.id);
  const ps = cfg.programas.filter((p) => p.categoria === c.id);
  const vs = vidCat(c.id);
  add(`${c.id}.html`, {
    ruta: `/${c.id}`, titulo: c.nombre, activo: c.id, desc: c.descripcion,
    cuerpo: `
<section class="page-head page-${c.id}"><div class="wrap"><span class="kicker">Sección</span><h1>${esc(c.nombre)}</h1><p>${esc(c.descripcion)}</p>
${ps.length ? `<div class="chips">${ps.map((p) => `<a class="chip" href="/programa-${p.id}">▶ ${esc(p.nombre)}</a>`).join('')}</div>` : ''}</div></section>
${ns.length ? seccion({ titulo: 'Noticias', cuerpo: leadBlock(ns[0], ns.slice(1, 5)) + (ns.length > 5 ? `<div class="more-news">${ngrid(ns.slice(5))}</div>` : '') }) : ''}
${cortos(vs).length ? seccion({ titulo: 'Shorts y reels', cuerpo: shelf(cortos(vs)), clase: 'alt' }) : ''}
${largos(vs).length ? seccion({ titulo: 'Videos', cuerpo: grid(largos(vs)) }) : ''}
${!ns.length && !vs.length ? seccion({ titulo: 'Pronto', cuerpo: '<p class="empty">Todavía no hay publicaciones en esta sección.</p>' }) : ''}`,
  });
}

// ---------- Programas ----------
add('programas.html', {
  ruta: '/programas', titulo: 'Programas', activo: 'programas',
  desc: `Todos los programas de ${S.nombre}: ${cfg.programas.map((p) => p.nombre).join(', ')}.`,
  cuerpo: `
<section class="page-head"><div class="wrap"><span class="kicker">Al aire</span><h1>Programas</h1><p>Espacios propios de ${esc(S.nombre)}, hechos en Temuco con la comunidad.</p></div></section>
${seccion({ titulo: 'Todos los programas', cuerpo: `<div class="progs">${cfg.programas.map(progCard).join('')}</div>` })}`,
});

for (const p of cfg.programas) {
  const eps = vidProg(p.id);
  const ultimo = eps.find((v) => !v.short) || eps[0];
  add(`programa-${p.id}.html`, {
    ruta: `/programa-${p.id}`, titulo: p.nombre, activo: 'programas', desc: p.descripcion, imagen: ultimo ? thumb(ultimo.id) : undefined,
    cuerpo: `
<section class="show-head" ${ultimo ? `style="--hero-img:url('${thumb(ultimo.id)}')"` : ''}>
  <div class="wrap show-grid">
    <div>
      <a class="crumb" href="/programas">← Programas</a>
      ${tag(p.categoria)}
      <h1>${esc(p.nombre)}</h1>
      <p>${esc(p.descripcion)}</p>
      <span class="meta">${eps.length} ${eps.length === 1 ? 'episodio' : 'episodios'}${ultimo ? ` · último: ${fecha(ultimo.fecha, 'larga')}` : ''}</span>
      ${ultimo ? `<a class="btn" href="https://www.youtube.com/watch?v=${ultimo.id}" data-yt="${ultimo.id}" data-title="${esc(ultimo.titulo)}">▶ Ver último episodio</a>` : ''}
    </div>
  </div>
</section>
${largos(eps).length ? seccion({ kicker: 'Episodios', titulo: 'Todos los episodios', cuerpo: grid(largos(eps)) }) : ''}
${cortos(eps).length ? seccion({ kicker: 'Formato corto', titulo: 'Shorts y reels', cuerpo: shelf(cortos(eps)), clase: 'alt' }) : ''}`,
  });
}

// ---------- Nosotros / 404 ----------
add('nosotros.html', {
  ruta: '/nosotros', titulo: 'Nosotros', activo: 'nosotros',
  cuerpo: `
<section class="page-head"><div class="wrap"><span class="kicker">Quiénes somos</span><h1>${esc(tx('nosotros_titulo', 'Quiénes somos'))}</h1><p>${esc(S.descripcion)}</p></div></section>
<section class="block"><div class="wrap about">
  <div class="prose">${marked.parse(tx('nosotros_texto', ''))}</div>
  <dl class="facts">${(Array.isArray(T.nosotros_datos) ? T.nosotros_datos : []).map((d) => `
    <div><dt>${esc(d.etiqueta || '')}</dt><dd>${esc(d.valor || '')}</dd></div>`).join('')}
  </dl>
</div></section>
${sintoniaBlock('alt', true)}`,
});

add('404.html', {
  ruta: '/404', titulo: 'Página no encontrada',
  cuerpo: `<section class="page-head"><div class="wrap"><span class="kicker">Error 404</span><h1>Esta página no existe</h1><p>Puede que la hayamos movido. <a href="/">Vuelve al inicio</a> para ver la señal en vivo y lo último.</p></div></section>`,
});

// ---------- escribir ----------
await rm(out, { recursive: true, force: true });
await mkdir(new URL('noticias/', out), { recursive: true });
await cp(new URL('assets/', root), new URL('assets/', out), { recursive: true });
for (const [archivo, html] of Object.entries(paginas)) await writeFile(new URL(archivo, out), html);

const urls = Object.keys(paginas).filter((a) => a !== '404.html').map((a) => `${S.url}/${a === 'index.html' ? '' : a.replace(/\.html$/, '')}`);
await writeFile(new URL('sitemap.xml', out), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}\n</urlset>\n`);
await writeFile(new URL('robots.txt', out), `User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: ${S.url}/sitemap.xml\n`);

console.log(`Listo: ${Object.keys(paginas).length} páginas · ${notas.length} noticias · ${videos.length} videos.`);
