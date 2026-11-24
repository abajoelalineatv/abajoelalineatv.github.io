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
// Secciones, programas y publicidad se editan desde el administrador (carpeta content/)
const leerJSON = async (archivo) => JSON.parse((await readFile(new URL(archivo, root), 'utf8')).replace(/^﻿/, ''));
const leerLista = async (archivo) => {
  try { const l = await leerJSON(archivo); return Array.isArray(l) ? l : []; }
  catch (e) { if (e.code !== 'ENOENT') console.warn(`⚠ No se pudo leer ${archivo}: ${e.message}`); return []; }
};
cfg.categorias = (await leerLista('content/secciones.json')).filter((c) => c.id && c.nombre).map((c) => ({ palabras: [], ...c, palabras: (c.palabras || []).filter(Boolean) }));
cfg.programas = (await leerLista('content/programas.json')).filter((p) => p.id && p.nombre).map((p) => ({ ...p, palabras: (p.palabras || []).filter(Boolean) }));
const anuncios = await leerLista('content/publicidad.json');
// Textos editables desde el administrador ("Textos del sitio") → content/textos.json
let T = {};
try { T = await leerJSON('content/textos.json'); } catch (e) { console.warn(`⚠ No se pudo leer content/textos.json: ${e.message}`); }
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
// Enlace canónico de un Reel de Instagram (o undefined si la fuente no es un Reel).
const reelUrl = (u = '') => { const c = (String(u).match(/instagram\.com\/(?:[\w.]+\/)?reels?\/([\w-]+)/) || [])[1]; return c ? `https://www.instagram.com/reel/${c}/` : undefined; };

// ---------- noticias ----------
// Fuente de las noticias:
//  - Si existe la variable PANEL_URL (ej. https://panel.abajoelalinea.cl), se leen desde el CMS Payload.
//  - Si no, desde los archivos content/noticias/*.md (sistema anterior, Pages CMS).
const notas = [];
const PANEL = (process.env.PANEL_URL || '').replace(/\/$/, '');
const textoPlano = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
if (PANEL) {
  const abs = (u) => (!u ? '' : /^https?:/.test(u) ? u : PANEL + u);
  const medio = (m) => (m && typeof m === 'object' ? m : null);
  let pagina = 1, total = 0;
  do {
    const r = await fetch(`${PANEL}/api/noticias?limit=100&page=${pagina}&depth=2&sort=-fechaPublicacion&where[_status][equals]=published`);
    if (!r.ok) throw new Error(`El panel respondió ${r.status} al pedir las noticias (${PANEL}).`);
    const j = await r.json();
    total = j.totalPages;
    for (const n of j.docs) {
      const img = medio(n.imagen);
      const sec = typeof n.seccion === 'object' && n.seccion ? n.seccion.slug : '';
      const html = n.contenidoHTML || '';
      const texto = textoPlano(html);
      const autorNombre = n.firma || (typeof n.autor === 'object' && n.autor ? n.autor.nombre : '') || S.nombre;
      notas.push({
        slug: n.slug, url: `/noticias/${n.slug}`,
        titulo: String(n.titulo).trim(),
        bajada: String(n.bajada || texto.slice(0, 180)).trim(),
        fecha: new Date(n.fechaPublicacion),
        categoria: cats[sec] ? sec : n.tipo === 'columna' && cats.opinion ? 'opinion' : cfg.categorias[0].id,
        imagen: abs(img?.sizes?.ancho?.url || img?.url),
        proporcion: img?.width && img?.height ? img.height / img.width : null,
        pie: n.pieImagen || '',
        autor: autorNombre,
        autorFoto: abs(medio(n.firmaFoto)?.sizes?.miniatura?.url || medio(n.firmaFoto)?.url),
        autorCargo: n.firmaCargo || (typeof n.autor === 'object' && n.autor ? n.autor.cargo || '' : ''),
        destacada: !!n.destacada,
        video: ytId(n.video),
        fuente: n.instagram?.enlace || '',
        galeria: (n.galeria || []).map((g) => abs(medio(g)?.sizes?.ancho?.url || medio(g)?.url)).filter(Boolean),
        // Etiquetas del panel: ámbito geográfico y temáticas (filtros de Noticias).
        etiquetas: (n.etiquetas || []).filter((e) => e && typeof e === 'object' && e.slug).map((e) => ({ slug: e.slug, nombre: e.nombre, grupo: e.grupo === 'ambito' ? 'ambito' : 'tema' })),
        html,
        minutos: Math.max(1, Math.round(texto.split(' ').length / 200)),
      });
    }
    pagina++;
  } while (pagina <= total);
  console.log(`Noticias leídas desde el panel: ${notas.length}`);
}
const dirNotas = new URL('content/noticias/', root);
let archivos = [];
if (!PANEL) { try { archivos = (await readdir(dirNotas)).filter((f) => f.endsWith('.md')); } catch { /* sin notas aún */ } }
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
    autorFoto: d.autor_foto || '',
    autorCargo: d.autor_cargo || '',
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
// Las columnas de opinión no compiten por la portada de noticias: tienen su propio bloque.
const OPINION = 'opinion';
const informativas = notas.filter((n) => n.categoria !== OPINION);
const lead = informativas.find((n) => n.destacada && n.fecha > (informativas[0]?.fecha || 0) - 7 * 864e5) || informativas[0];

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
    <div class="front-txt">${tag(principal.categoria)}<h3>${esc(principal.titulo)}</h3><p>${esc(principal.bajada)}</p><time>${fecha(principal.fecha, 'larga')} · ${esc(principal.autor)}</time><span class="read">Leer la nota</span></div>
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
      <div><h2>${esc(titulo)}</h2>${desc ? `<p>${esc(desc)}</p>` : ''}</div>
      ${link ? `<a class="more" href="${link}">${esc(linkTxt)}</a>` : ''}
    </header>
    ${cuerpo}
  </div>
</section>`;

const grid = (items, fn = card) => items.length ? `<div class="grid">${items.map((x) => fn(x)).join('')}</div>` : `<p class="empty">Pronto habrá contenido en esta sección.</p>`;
const ngrid = (items, opts) => items.length ? `<div class="grid grid-n${items.length === 5 ? ' row5' : ''}">${items.map((n) => ncard(n, opts)).join('')}</div>` : `<p class="empty">Todavía no hay noticias en esta sección.</p>`;
// Videos: los Shorts van aparte en su fila vertical
const largos = (l) => l.filter((v) => !v.short);
const cortos = (l) => l.filter((v) => v.short);

const enviaNota = S.whatsapp ? `https://wa.me/${S.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent('Hola, quiero mandarles una nota:')}` : `mailto:${S.email}?subject=${encodeURIComponent('Nota para Abajo’e la Línea')}`;

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
      <span><strong>Abajo’e la Línea</strong><small>TV comunitaria · Temuco</small></span>
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
    <a class="cat" href="/noticias"${activo === 'noticias' ? ' aria-current="page"' : ''}>Noticias</a>
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

// ---------- publicidad ----------
// Espacios: portada-superior, portada-media, secciones, nota-lateral, nota-inferior.
// Si hay varios avisos activos en el mismo espacio, se muestra uno al azar en cada visita.
const hoy = new Date();
const vigente = (a) => a.activo !== false && a.imagen && (!a.desde || aFecha(a.desde) <= hoy) && (!a.hasta || aFecha(String(a.hasta).slice(0, 10) + 'T23:59') >= hoy);
const espacio = (nombre) => {
  const lista = anuncios.filter((a) => vigente(a) && (a.ubicacion === nombre || (Array.isArray(a.ubicacion) && a.ubicacion.includes(nombre))));
  if (!lista.length) return '';
  return `<aside class="ad ad-${nombre}" aria-label="Publicidad"><span class="ad-label">Publicidad</span>${lista.map((a, i) => {
    const pic = `<picture>${a.imagen_movil ? `<source media="(max-width: 720px)" srcset="${esc(a.imagen_movil)}">` : ''}<img src="${esc(a.imagen)}" alt="${esc(a.nombre || 'Publicidad')}" loading="lazy"></picture>`;
    return `<div class="ad-item"${i ? ' hidden' : ''}>${a.enlace ? `<a href="${esc(a.enlace)}" target="_blank" rel="sponsored noopener">${pic}</a>` : pic}</div>`;
  }).join('')}</aside>`;
};

// ---------- columnas de opinión ----------
const avatar = (n, cls = 'avatar') => n.autorFoto
  ? `<img class="${cls}" src="${esc(n.autorFoto)}" alt="" loading="lazy">`
  : `<span class="${cls} avatar-ini">${esc((n.autor || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase())}</span>`;
const colcard = (n) => `
<a class="colcard" href="${n.url}">
  ${avatar(n)}
  <div><span class="col-autor">${esc(n.autor)}${n.autorCargo ? ` <small>· ${esc(n.autorCargo)}</small>` : ''}</span><h3>${esc(n.titulo)}</h3><p>${esc(n.bajada)}</p><time datetime="${n.fecha.toISOString()}">${fecha(n.fecha, 'larga')}</time></div>
</a>`;
const colgrid = (lista) => `<div class="colgrid">${lista.map(colcard).join('')}</div>`;

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
// Sin etiquetas pequeñas sobre los títulos de sección ("eyebrows"): el título ya lo dice.
const add = (archivo, opts) => { paginas[archivo] = pagina({ ...opts, cuerpo: opts.cuerpo.replace(/<span class="kicker">[^<]*<\/span>/g, '') }); };

// ---------- Inicio ----------
{
  const secundarias = informativas.filter((n) => n !== lead).slice(0, 4);
  const usadas = new Set([lead, ...secundarias]);
  const masNoticias = informativas.filter((n) => !usadas.has(n)).slice(0, 5);
  masNoticias.forEach((n) => usadas.add(n));
  const insta = cfg.redes.beholdFeedId
    ? `<behold-widget feed-id="${esc(cfg.redes.beholdFeedId)}"></behold-widget><script type="module" src="https://w.behold.so/widget.js"></script>`
    : `<a class="insta-cta" href="${cfg.redes.instagram}" target="_blank" rel="noopener">${icon.ig}<div><strong>@${esc(cfg.redes.instagramUsuario)}</strong><span>${esc(tx('instagram_texto', 'Síguenos en Instagram.'))}</span></div><span class="more">Seguir en Instagram</span></a>`;

  const bloqueCat = (c) => {
    const ns = notCat(c.id).filter((n) => !usadas.has(n)).slice(0, 5);
    const vs = largos(vidCat(c.id)).slice(0, 4);
    if (!ns.length && !vs.length) return '';
    if (c.id === OPINION) return seccion({ kicker: 'Columnas', titulo: c.nombre, desc: c.descripcion, link: `/${c.id}`, cuerpo: colgrid(ns.slice(0, 4)), clase: 'alt' });
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
        <button class="unmute" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>Activar sonido</button>
        <div class="live-msg" hidden><strong>Señal en pausa</strong><span>No pudimos cargar la transmisión en este momento. Intenta de nuevo en unos minutos o sintoniza el canal ${esc(S.canalTvd)}.</span><button class="retry">Reintentar</button></div>
      </div>
      ${T.lema_imagen ? `
      <h1 class="lema-img"><img src="${esc(T.lema_imagen)}" alt="${esc(S.lema)}" width="2000" height="667"></h1>` : `
      <div class="live-info">
        <div><span class="kicker">${esc(tx('etiqueta_envivo', 'Señal en vivo'))}</span><h1${S.lema.length > 48 ? ' class="largo"' : ''}>${esc(S.lema)}</h1></div>
        <div class="channel-badge"><span>TVD</span><strong>${esc(S.canalTvd)}</strong><small>Temuco</small></div>
      </div>`}
    </div>
    <aside class="hero-side">
      <h2 class="side-title">Últimas noticias</h2>
      <div class="side-list">${notas.slice(0, 5).map(nrow).join('')}</div>
      <a class="more" href="/noticias">Ver todas las noticias</a>
    </aside>
  </div>
</section>

<div class="guarda" aria-hidden="true"></div>
${espacio('portada-superior') ? `<div class="wrap ad-wrap">${espacio('portada-superior')}</div>` : ''}

${seccion({ kicker: 'Portada', titulo: 'Noticias', link: '/noticias', linkTxt: 'Ver todas', clase: 'front-block', cuerpo: leadBlock(lead, secundarias) + (masNoticias.length ? `<div class="more-news">${ngrid(masNoticias)}</div>` : '') })}

${espacio('portada-media') ? `<div class="wrap ad-wrap">${espacio('portada-media')}</div>` : ''}

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
// Paginación: 12 noticias por página (/noticias, /noticias/pagina/2, …). Cada página trae solo sus 12.
const POR_PAGINA = 12;
const rutaPagina = (base, n) => (n === 1 ? base : `${base}/pagina/${n}`);
/** Botones Anterior · 1 2 3 … · Siguiente, con los mismos chips del sitio. */
const paginacion = (base, actual, total) => {
  if (total <= 1) return '';
  const nums = [...new Set([1, actual - 1, actual, actual + 1, total])].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const items = [];
  nums.forEach((n, i) => {
    if (i && n - nums[i - 1] > 1) items.push('<span class="chip" aria-hidden="true">…</span>');
    items.push(n === actual
      ? `<a class="chip on" href="${rutaPagina(base, n)}" aria-current="page">${n}</a>`
      : `<a class="chip" href="${rutaPagina(base, n)}">${n}</a>`);
  });
  const ant = actual > 1 ? `<a class="chip" href="${rutaPagina(base, actual - 1)}" rel="prev">← Anterior</a>` : '';
  const sig = actual < total ? `<a class="chip" href="${rutaPagina(base, actual + 1)}" rel="next">Siguiente →</a>` : '';
  return `<nav class="wrap chips paginacion" aria-label="Páginas de noticias">${ant}${items.join('')}${sig}</nav>`;
};
// Filtros por etiqueta (ámbito geográfico y temática), debajo de los de sección. Solo las que tienen noticias.
const etiquetasUsadas = (() => {
  const m = new Map();
  for (const n of notas) for (const e of n.etiquetas || []) m.set(e.slug, { ...e, total: (m.get(e.slug)?.total || 0) + 1 });
  return [...m.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
})();
const ORDEN_AMBITO = ['local', 'regional', 'nacional', 'internacional'];
const filtrosEtiquetas = (activo) => {
  const fila = (grupo, titulo, lista) => lista.length
    ? `<div class="chips filtros-etiquetas" aria-label="${titulo}"><span class="filtro-titulo">${titulo}</span>${lista.map((e) => `<a class="chip${activo === e.slug ? ' on' : ''}" href="/noticias/tema/${e.slug}"${activo === e.slug ? ' aria-current="page"' : ''}>${esc(e.nombre)}</a>`).join('')}</div>`
    : '';
  const ambitos = etiquetasUsadas.filter((e) => e.grupo === 'ambito').sort((a, b) => (ORDEN_AMBITO.indexOf(a.slug) + 99) % 99 - (ORDEN_AMBITO.indexOf(b.slug) + 99) % 99);
  return fila('ambito', 'Ámbito', ambitos) + fila('tema', 'Temática', etiquetasUsadas.filter((e) => e.grupo === 'tema'));
};
const cabezaNoticias = (activoSeccion, activoEtiqueta, h1 = 'Lo que pasa en el territorio') => `
<section class="page-head"><div class="wrap"><span class="kicker">Noticias</span><h1>${esc(h1)}</h1><p>Noticias de Temuco y La Araucanía contadas desde las organizaciones, los barrios y las comunidades.</p>${filtros(activoSeccion)}${filtrosEtiquetas(activoEtiqueta)}</div></section>`;

{
  const lista = lead ? [lead, ...informativas.filter((n) => n !== lead)] : informativas;
  const total = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
  for (let p = 1; p <= total; p++) {
    const trozo = lista.slice((p - 1) * POR_PAGINA, p * POR_PAGINA);
    const ruta = rutaPagina('/noticias', p);
    // Página 1: igual que antes (nota principal + 4 secundarias), y el resto de sus 12 en la grilla.
    const cuerpoNotas = p === 1
      ? `${seccion({ titulo: 'Portada', cuerpo: leadBlock(trozo[0], trozo.slice(1, 5)) })}
${seccion({ titulo: 'Todas las noticias', cuerpo: ngrid(trozo.slice(5), { bajada: true }), clase: 'alt' })}`
      : seccion({ titulo: `Todas las noticias · página ${p} de ${total}`, cuerpo: ngrid(trozo, { bajada: true }), clase: 'alt' });
    add(`${ruta.slice(1)}.html`, {
      ruta, titulo: p === 1 ? 'Noticias' : `Noticias · página ${p}`, activo: 'noticias',
      desc: `Noticias de Temuco y La Araucanía desde los territorios: ${cfg.categorias.map((c) => c.nombre).join(', ')}.`,
      cuerpo: `${cabezaNoticias('todas', '')}
${cuerpoNotas}
${paginacion('/noticias', p, total)}
${p === 1 && notCat(OPINION).length ? seccion({ kicker: 'Columnas', titulo: catNombre(OPINION), link: `/${OPINION}`, cuerpo: colgrid(notCat(OPINION).slice(0, 4)) }) : ''}`,
    });
  }
}

// Una lista paginada por etiqueta: /noticias/tema/politica, /noticias/tema/politica/pagina/2, …
for (const e of etiquetasUsadas) {
  const base = `/noticias/tema/${e.slug}`;
  const lista = notas.filter((n) => n.etiquetas?.some((x) => x.slug === e.slug));
  const total = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
  for (let p = 1; p <= total; p++) {
    const ruta = rutaPagina(base, p);
    add(`${ruta.slice(1)}.html`, {
      ruta, titulo: `${e.nombre} · Noticias${p > 1 ? ` · página ${p}` : ''}`, activo: 'noticias',
      desc: `Noticias de ${e.nombre} en Abajo’e la Línea TV.`,
      cuerpo: `${cabezaNoticias('', e.slug, e.nombre)}
${seccion({ titulo: `${lista.length} noticia${lista.length === 1 ? '' : 's'}${total > 1 ? ` · página ${p} de ${total}` : ''}`, cuerpo: ngrid(lista.slice((p - 1) * POR_PAGINA, p * POR_PAGINA), { bajada: true }), clase: 'alt' })}
${paginacion(base, p, total)}`,
    });
  }
}

// ---------- Cada nota ----------
for (const n of notas) {
  const rel = notCat(n.categoria).filter((x) => x !== n).slice(0, 5);
  const recientes = notas.filter((x) => x !== n).slice(0, 5);
  const share = encodeURIComponent(S.url + n.url);
  // Reel original: reproductor oficial de Instagram. Sin el script (o si falla), queda el enlace al Reel.
  const reel = reelUrl(n.fuente);
  const bloqueReel = reel ? `<section class="article-reel" aria-label="Video original en Instagram">
      <h2>Video original en Instagram</h2>
      <blockquote class="instagram-media" data-instgrm-permalink="${esc(reel)}?utm_source=ig_embed" data-instgrm-version="14"><a href="${esc(reel)}" target="_blank" rel="noopener">${icon.ig}<span>Ver el video en Instagram</span></a></blockquote>
    </section>
    <script async src="https://www.instagram.com/embed.js"></script>` : '';
  const ld = { '@context': 'https://schema.org', '@type': 'NewsArticle', headline: n.titulo, description: n.bajada, datePublished: n.fecha.toISOString(), author: { '@type': 'Organization', name: n.autor }, publisher: { '@type': 'Organization', name: S.nombre, logo: { '@type': 'ImageObject', url: `${S.url}/assets/img/logo.png` } }, ...(n.imagen ? { image: [S.url + n.imagen] } : {}), mainEntityOfPage: S.url + n.url };
  add(`noticias/${n.slug}.html`, {
    ruta: n.url, titulo: n.titulo, desc: n.bajada, activo: n.categoria, imagen: n.imagen,
    extraHead: `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`,
    cuerpo: `
<article class="article wrap">
  <div class="article-main">
    <nav class="crumbs"><a href="/noticias">Noticias</a> / <a href="/${n.categoria}">${esc(catNombre(n.categoria))}</a></nav>
    ${n.categoria === OPINION ? tag(OPINION, 'Columna de opinión') : tag(n.categoria)}
    <h1>${esc(n.titulo)}</h1>
    <p class="lede">${esc(n.bajada)}</p>
    ${n.categoria === OPINION
      ? `<div class="byline byline-col">${avatar(n, 'avatar avatar-lg')}<div><strong>${esc(n.autor)}</strong>${n.autorCargo ? `<span>${esc(n.autorCargo)}</span>` : ''}<time datetime="${n.fecha.toISOString()}">${fecha(n.fecha, 'larga')} · ${n.minutos} min de lectura</time></div></div>`
      : `<div class="byline"><span>Por <strong>${esc(n.autor)}</strong></span><time datetime="${n.fecha.toISOString()}">${fecha(n.fecha, 'larga')}</time><span>${n.minutos} min de lectura</span></div>`}
    ${n.imagen ? `<figure class="article-img"><img src="${esc(n.imagen)}" alt="${esc(n.pie || '')}">${n.pie ? `<figcaption>${esc(n.pie)}</figcaption>` : ''}</figure>` : ''}
    ${n.video ? `<div class="article-video"><iframe src="https://www.youtube-nocookie.com/embed/${n.video}?rel=0" title="${esc(n.titulo)}" loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>` : ''}
    ${bloqueReel}
    <div class="prose article-body">${n.html}</div>
    ${n.galeria?.length ? `<div class="galeria">${n.galeria.map((g) => `<a href="${esc(g)}" target="_blank" rel="noopener"><img src="${esc(g)}" alt="" loading="lazy"></a>`).join('')}</div>` : ''}
    ${n.categoria === OPINION ? `<p class="source">Las opiniones expresadas en esta columna son responsabilidad de quien la firma y no representan necesariamente la línea editorial de ${esc(S.nombre)}.</p>` : ''}
    ${n.fuente ? `<p class="source">Publicado originalmente en <a href="${esc(n.fuente)}" target="_blank" rel="noopener">${/instagram/.test(n.fuente) ? 'nuestro Instagram' : 'esta fuente'}</a>.</p>` : ''}
    <div class="share"><span>Compartir</span>
      <a href="https://wa.me/?text=${encodeURIComponent(n.titulo + ' ')}${share}" target="_blank" rel="noopener" aria-label="Compartir en WhatsApp">${icon.wa}</a>
      <a href="https://www.facebook.com/sharer/sharer.php?u=${share}" target="_blank" rel="noopener" aria-label="Compartir en Facebook">${icon.fb}</a>
      <a href="https://twitter.com/intent/tweet?url=${share}&text=${encodeURIComponent(n.titulo)}" target="_blank" rel="noopener" aria-label="Compartir en X">${icon.x}</a>
      <button class="copy" data-url="${S.url + n.url}">Copiar enlace</button>
    </div>
    ${espacio('nota-inferior')}
  </div>
  <aside class="article-side">
    <a class="side-live" href="/#envivo"><span class="onair"><span class="dot"></span>EN VIVO</span><strong>Mira la señal en vivo</strong><span>Canal ${esc(S.canalTvd)} · TV abierta e internet</span></a>
    ${espacio('nota-lateral')}
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
${espacio('secciones') ? `<div class="wrap ad-wrap">${espacio('secciones')}</div>` : ''}
${!ns.length ? '' : c.id === OPINION
    ? seccion({ titulo: 'Columnas', cuerpo: colgrid(ns) })
    : seccion({ titulo: 'Noticias', cuerpo: leadBlock(ns[0], ns.slice(1, 5)) + (ns.length > 5 ? `<div class="more-news">${ngrid(ns.slice(5))}</div>` : '') })}
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
{
  // «Quiénes somos»: especial documental. Cada bloque aparece solo si tiene contenido en «Textos del sitio».
  // GSAP (local, solo en esta página) agrega el movimiento; sin JavaScript o con movimiento reducido, todo se lee igual.
  const lista = (k) => (Array.isArray(T[k]) ? T[k] : []);
  const md = (k) => (tx(k, '') ? marked.parse(tx(k, '')) : '');
  const img = (src, alt = '', extra = '') => `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" decoding="async"${extra}>`;
  const titulo = tx('nosotros_titulo', 'Quiénes somos');
  const palabras = titulo.split(/\s+/);
  const corteTit = Math.ceil(palabras.length / 2);
  const lineasTitulo = [palabras.slice(0, corteTit).join(' '), palabras.slice(corteTit).join(' ')].filter(Boolean);
  const portada = tx('nosotros_portada', '');
  const portadaMovil = tx('nosotros_portada_movil', '');
  const hitos = lista('nosotros_hitos').filter((h) => h.titulo || h.texto);
  const archivo = lista('nosotros_galeria').filter((g) => g.imagen);
  const temas = lista('nosotros_temas').filter((t) => t.nombre);
  const valores = lista('nosotros_valores').filter(Boolean);
  const video = ytId(tx('nosotros_video', ''));
  const cierreImg = tx('nosotros_cierre_imagen', '');
  const ultima = informativas[0];

  // Capítulo 1: cada párrafo enfoca una parte de la portada real del periódico de 2002.
  const focos = ['todo', 'todo', 'cabecera', 'linea', 'todo'];
  let iFoco = 0;
  const historia = md('nosotros_historia_texto').replace(/<p>/g, () => `<p class="ab-paso" data-foco="${focos[iFoco++] || 'todo'}">`);

  const estacion = (n, id, h2) => `<header class="ab-estacion"><span class="ab-parada" aria-hidden="true">${n}</span><h2 id="${id}-t">${esc(h2)}</h2></header>`;
  const riel = '<div class="ab-riel" aria-hidden="true"><span class="ab-riel-luz"></span></div>';
  const capitulos = [
    ['el-barrio', 'El barrio'], ['la-linea', 'La línea'], ['la-senal', 'La señal'], ['archivo', 'Archivo'], ['el-territorio', 'El territorio'],
  ];

  const ld = {
    '@context': 'https://schema.org', '@type': 'TelevisionStation', name: S.nombre, url: S.url, logo: `${S.url}/assets/img/logo.png`,
    description: tx('nosotros_bajada', S.descripcion), foundingDate: '2002',
    address: { '@type': 'PostalAddress', addressLocality: 'Temuco', addressRegion: 'La Araucanía', addressCountry: 'CL' },
    sameAs: [cfg.redes.instagram, cfg.redes.facebook, cfg.redes.youtube].filter(Boolean),
  };

  // Esquema del territorio (no es un mapa): centro arriba, línea del tren, barrios populares y río Cautín abajo.
  const esquema = `
  <figure class="ab-corte">
    <div class="ab-corte-svg">
    <svg class="c-ancho" viewBox="0 14 960 286" role="img" aria-labelledby="corte-t corte-d">
      <title id="corte-t">Por qué «Abajo ’e la Línea»</title>
      <desc id="corte-d">Corte esquemático de Temuco: el centro de la ciudad en la parte alta, la línea del tren en el borde, y más abajo los barrios populares que crecieron hasta la ribera del río Cautín.</desc>
      <path class="c-suelo" d="M0 110 H330 C380 110 400 190 450 196 H780 C820 196 830 232 860 236 H960 V300 H0 Z"/>
      <path class="c-rio" d="M845 232 C870 238 900 238 960 236 V300 H845 Z"/>
      <g class="c-edif"><rect x="40" y="62" width="34" height="48"/><rect x="82" y="44" width="40" height="66"/><rect x="130" y="70" width="30" height="40"/><rect x="168" y="52" width="38" height="58"/><rect x="214" y="76" width="30" height="34"/><rect x="252" y="60" width="34" height="50"/></g>
      <g class="c-casas"><path d="M480 196v-20l14-12 14 12v20z"/><path d="M522 196v-16l12-10 12 10v16z"/><path d="M562 196v-22l15-12 15 12v22z"/><path d="M608 196v-16l12-10 12 10v16z"/><path d="M648 196v-20l14-12 14 12v20z"/><path d="M692 196v-16l12-10 12 10v16z"/><path d="M732 196v-18l13-11 13 11v18z"/></g>
      <g class="c-via"><line x1="300" y1="110" x2="372" y2="110"/><line x1="306" y1="104" x2="306" y2="116"/><line x1="318" y1="104" x2="318" y2="116"/><line x1="330" y1="104" x2="330" y2="116"/><line x1="342" y1="104" x2="342" y2="116"/><line x1="354" y1="104" x2="354" y2="116"/><line x1="366" y1="104" x2="366" y2="116"/></g>
      <line class="c-frontera" x1="372" y1="20" x2="372" y2="290" pathLength="1"/>
      <text class="c-tit" x="40" y="146">Centro de Temuco</text>
      <text class="c-tit c-rojo" x="384" y="38">Línea del tren</text>
      <text class="c-sub" x="384" y="58">frontera simbólica</text>
      <text class="c-tit" x="480" y="232">Barrios populares</text>
      <text class="c-sub" x="480" y="252">Santa Rosa, población Paredes</text>
      <text class="c-tit c-azul" x="855" y="274">Río Cautín</text>
    </svg>
    <svg class="c-movil" viewBox="0 0 400 300" aria-hidden="true">
      <path class="c-suelo" d="M0 120 H140 C165 120 175 196 205 200 H320 C340 200 345 236 360 240 H400 V300 H0 Z"/>
      <path class="c-rio" d="M352 236 C365 242 380 242 400 240 V300 H352 Z"/>
      <g class="c-edif"><rect x="14" y="78" width="22" height="42"/><rect x="42" y="62" width="26" height="58"/><rect x="74" y="84" width="20" height="36"/><rect x="100" y="70" width="24" height="50"/></g>
      <g class="c-casas"><path d="M212 200v-16l11-9 11 9v16z"/><path d="M244 200v-13l9-8 9 8v13z"/><path d="M272 200v-17l11-9 11 9v17z"/><path d="M302 200v-13l9-8 9 8v13z"/></g>
      <g class="c-via"><line x1="118" y1="120" x2="150" y2="120"/><line x1="122" y1="115" x2="122" y2="125"/><line x1="132" y1="115" x2="132" y2="125"/><line x1="142" y1="115" x2="142" y2="125"/></g>
      <line class="c-frontera" x1="150" y1="16" x2="150" y2="284" pathLength="1"/>
      <text class="c-tit" x="12" y="150">Centro</text>
      <text class="c-tit c-rojo" x="158" y="34">Línea del tren</text>
      <text class="c-sub" x="158" y="52">frontera simbólica</text>
      <text class="c-tit" x="200" y="232">Barrios populares</text>
      <text class="c-sub" x="200" y="250">Santa Rosa, Paredes</text>
      <text class="c-tit c-azul c-fin" x="394" y="286">Río Cautín</text>
    </svg>
    </div>
    ${tx('nosotros_corte_pie', '') ? `<figcaption>${esc(tx('nosotros_corte_pie', ''))}</figcaption>` : ''}
  </figure>`;

  add('nosotros.html', {
    ruta: '/nosotros', titulo: 'Quiénes somos', activo: 'nosotros',
    desc: tx('nosotros_bajada', S.descripcion),
    imagen: portada || undefined,
    extraHead: `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
<script>if(!matchMedia('(prefers-reduced-motion: reduce)').matches)document.documentElement.classList.add('ab-mov')</script>
${portada ? `<link rel="preload" as="image" href="${esc(portada)}"${portadaMovil ? ` imagesrcset="${esc(portadaMovil)} 800w, ${esc(portada)} 1280w" imagesizes="100vw"` : ''}>` : ''}`,
    cuerpo: `
<div class="ab-especial">
<section class="ab-portada" aria-labelledby="ab-titulo">
  ${portada ? `<img class="ab-portada-img" src="${esc(portada)}"${portadaMovil ? ` srcset="${esc(portadaMovil)} 800w, ${esc(portada)} 1280w" sizes="100vw"` : ''} width="1280" height="720" alt="${esc(tx('nosotros_portada_pie', ''))}" fetchpriority="high">` : ''}
  <div class="wrap ab-portada-txt">
    <h1 id="ab-titulo">${lineasTitulo.map((l) => `<span class="ab-lin"><span>${esc(l)}</span></span>`).join(' ')}</h1>
    <p class="ab-bajada">${esc(tx('nosotros_bajada', S.descripcion))}</p>
  </div>
  ${tx('nosotros_portada_pie', '') ? `<p class="ab-credito">${esc(tx('nosotros_portada_pie', ''))}</p>` : ''}
</section>

<nav class="ab-indice" aria-label="Capítulos de esta página"><div class="wrap">
  <ol>${capitulos.map(([id, nom]) => `<li><a href="#${id}">${esc(nom)}</a></li>`).join('')}</ol>
  <span class="ab-avance" aria-hidden="true"></span>
</div></nav>

<section class="ab-intro"><div class="wrap">
  <div class="ab-intro-txt">${md('nosotros_texto')}</div>
  <dl class="ab-ficha">${lista('nosotros_datos').map((d) => `
    <div><dt>${esc(d.etiqueta || '')}</dt><dd>${esc(d.valor || '')}</dd></div>`).join('')}
  </dl>
</div></section>

${historia ? `
<section class="ab-cap ab-cap-papel" id="el-barrio" aria-labelledby="el-barrio-t"><div class="wrap">
  ${riel}
  ${estacion(1, 'el-barrio', tx('nosotros_historia_titulo', ''))}
  <div class="ab-barrio">
    <div class="ab-barrio-txt prose">${historia}</div>
    <figure class="ab-doc">
      <div class="ab-doc-marco">${img(tx('nosotros_historia_imagen', ''), tx('nosotros_historia_pie', ''), ' width="720" height="1010"')}</div>
      ${tx('nosotros_historia_pie', '') ? `<figcaption>${esc(tx('nosotros_historia_pie', ''))}</figcaption>` : ''}
    </figure>
  </div>
</div></section>` : ''}

<section class="ab-cap ab-cap-linea" id="la-linea" aria-labelledby="la-linea-t"><div class="wrap">
  ${riel}
  ${estacion(2, 'la-linea', 'Por qué «Abajo ’e la Línea»')}
  ${esquema}
</div></section>

${md('nosotros_senal_texto') || hitos.length ? `
<section class="ab-cap" id="la-senal" aria-labelledby="la-senal-t"><div class="wrap">
  ${riel}
  ${estacion(3, 'la-senal', tx('nosotros_senal_titulo', ''))}
  <div class="prose ab-col">${md('nosotros_senal_texto')}</div>
  ${hitos.length ? `
  <ol class="ab-crono" aria-label="Cronología">${hitos.map((h) => `
    <li class="ab-hito${h.imagen ? '' : ' ab-hito-sinfoto'}">
      <span class="ab-hito-punto" aria-hidden="true"></span>
      <div class="ab-hito-txt"><p class="ab-hito-etq">${esc(h.etiqueta || '')}</p><h3>${esc(h.titulo || '')}</h3><p>${esc(h.texto || '')}</p></div>
      ${h.imagen ? `<figure>${img(h.imagen, h.pie || '')}${h.pie ? `<figcaption>${esc(h.pie)}</figcaption>` : ''}</figure>` : ''}
    </li>`).join('')}
  </ol>` : ''}
</div></section>` : ''}

${archivo.length ? `
<section class="ab-cap ab-cap-archivo" id="archivo" aria-labelledby="archivo-t"><div class="wrap">
  ${riel}
  <header class="ab-estacion ab-archivo-cab">
    <h2 id="archivo-t">${esc(tx('nosotros_galeria_titulo', 'Archivo'))}</h2>${tx('nosotros_galeria_texto', '') ? `<p>${esc(tx('nosotros_galeria_texto', ''))}</p>` : ''}
  </header>
  <div class="ab-archivo">
    <figure class="ab-escena">
      <a class="ab-escena-foto" href="${esc(archivo[0].imagen)}" aria-label="Ver en pantalla completa">${img(archivo[0].imagen, archivo[0].pie || '')}</a>
      <figcaption>
        <p class="ab-escena-pie">${esc(archivo[0].pie || '')}</p>
        <p class="ab-escena-meta">${[archivo[0].fecha, archivo[0].fuente].filter(Boolean).map(esc).join('. ')}</p>
        <div class="ab-escena-ctrl" hidden>
          <button type="button" class="ab-btn" data-mover="-1" aria-label="Foto anterior">‹</button>
          <span class="ab-contador" aria-live="polite">1 de ${archivo.length}</span>
          <button type="button" class="ab-btn" data-mover="1" aria-label="Foto siguiente">›</button>
        </div>
      </figcaption>
    </figure>
    <ul class="ab-miniaturas" aria-label="Todas las piezas del archivo">${archivo.map((g, i) => `
      <li><a class="ab-mini" href="${esc(g.imagen)}" data-i="${i}"${i === 0 ? ' aria-current="true"' : ''}>${img(g.imagen, g.pie || '')}</a></li>`).join('')}
    </ul>
  </div>
  <script type="application/json" id="ab-archivo-datos">${JSON.stringify(archivo.map((g) => ({ src: g.imagen, pie: g.pie || '', meta: [g.fecha, g.fuente].filter(Boolean).join('. ') }))).replace(/</g, '\\u003c')}</script>
</div>
<dialog class="ab-visor" aria-label="Fotografía ampliada">
  <figure><img alt=""><figcaption><span class="ab-visor-pie"></span><span class="ab-visor-meta"></span></figcaption></figure>
  <button type="button" class="ab-btn ab-visor-ant" aria-label="Foto anterior">‹</button>
  <button type="button" class="ab-btn ab-visor-sig" aria-label="Foto siguiente">›</button>
  <button type="button" class="ab-btn ab-visor-cerrar" aria-label="Cerrar">✕</button>
</dialog>
</section>` : ''}

${video ? `
<section class="ab-video"><div class="wrap">
  <a class="ab-video-card" href="https://www.youtube.com/watch?v=${video}" data-yt="${video}" data-title="${esc(tx('nosotros_video_titulo', 'Video'))}">
    <img src="${thumb(video, 'maxresdefault')}" alt="" loading="lazy" width="1280" height="720">
    <span class="ab-video-play" aria-hidden="true">▶</span>
    <span class="ab-video-tit">${esc(tx('nosotros_video_titulo', 'Ver video'))}</span>
  </a>
</div></section>` : ''}

${md('nosotros_territorio_texto') ? `
<section class="ab-cap" id="el-territorio" aria-labelledby="el-territorio-t"><div class="wrap">
  ${riel}
  ${estacion(4, 'el-territorio', tx('nosotros_territorio_titulo', ''))}
  <div class="ab-territorio">
    <div class="prose">${md('nosotros_territorio_texto')}
      ${temas.length ? `<ul class="ab-temas" aria-label="Temas">${temas.map((t) => `<li>${t.seccion && cats[t.seccion] ? `<a class="chip chip-${esc(t.seccion)}" href="/${esc(t.seccion)}">${esc(t.nombre)}</a>` : `<span class="chip ab-chip-txt">${esc(t.nombre)}</span>`}</li>`).join('')}</ul>` : ''}
    </div>
    ${tx('nosotros_territorio_imagen', '') ? `<figure class="ab-foto-territorio"><div class="ab-paralaje">${img(tx('nosotros_territorio_imagen', ''), tx('nosotros_territorio_pie', ''))}</div>${tx('nosotros_territorio_pie', '') ? `<figcaption>${esc(tx('nosotros_territorio_pie', ''))}</figcaption>` : ''}</figure>` : ''}
  </div>
  ${cfg.programas.length ? `<h3 class="ab-h3">Nuestros programas</h3><div class="progs">${cfg.programas.map(progCard).join('')}</div>` : ''}
</div></section>` : ''}

${md('nosotros_derecho_texto') ? `
<section class="ab-manifiesto" aria-labelledby="manifiesto-t"><div class="wrap">
  <h2 id="manifiesto-t">${esc(tx('nosotros_derecho_titulo', '')).replace(/\b(derecho)\b/i, '<span class="ab-acento">$1</span>')}</h2>
  <div class="prose ab-col">${md('nosotros_derecho_texto')}</div>
  ${valores.length ? `<ul class="ab-valores">${valores.map((v) => `<li>${esc(v)}</li>`).join('')}</ul>` : ''}
</div></section>` : ''}

<section class="ab-final" aria-labelledby="invitacion-t">
  ${tx('nosotros_cierre', '') ? `
  <figure class="ab-final-foto">
    ${cierreImg ? img(cierreImg, tx('nosotros_cierre_pie', '')) : ''}
    <figcaption class="wrap">
      <blockquote><p>${esc(tx('nosotros_cierre', ''))}</p>${tx('nosotros_cierre_texto', '') ? `<footer>${esc(tx('nosotros_cierre_texto', ''))}</footer>` : ''}</blockquote>
      ${cierreImg && tx('nosotros_cierre_pie', '') ? `<p class="ab-credito-cierre">Foto: ${esc(tx('nosotros_cierre_pie', ''))}</p>` : ''}
    </figcaption>
  </figure>` : ''}
  <div class="wrap ab-invitacion">
  <h2 id="invitacion-t">${esc(tx('nosotros_invitacion_titulo', 'Nuestra historia sigue escribiéndose'))}</h2>
  <p>${esc(tx('nosotros_invitacion_texto', 'Conoce lo que estamos contando hoy.'))}</p>
  <ul class="ab-accesos">
    <li><a href="/noticias"><strong>Ver noticias</strong>${ultima ? `<span>Lo último: ${esc(ultima.titulo)}</span>` : ''}</a></li>
    ${cats.comunidad ? `<li><a href="/comunidad"><strong>Comunidad</strong><span>${esc(cats.comunidad.descripcion || '')}</span></a></li>` : ''}
    <li><a href="/programas"><strong>Conocer nuestros programas</strong><span>${cfg.programas.map((p) => esc(p.nombre)).join(', ')}</span></a></li>
    <li><a class="ab-acceso-vivo" href="/#envivo"><strong>Ver señal en vivo</strong><span>Canal ${esc(S.canalTvd)} en TV abierta y por internet</span></a></li>
    <li><a href="${enviaNota}"><strong>${esc(tx('envia_boton', 'Envía tu nota'))}</strong><span>${esc(tx('envia_texto', ''))}</span></a></li>
  </ul>
  </div>
</section>
</div>
${sintoniaBlock('alt', true)}
<script src="/assets/vendor/gsap/gsap.min.js" defer></script>
<script src="/assets/vendor/gsap/ScrollTrigger.min.js" defer></script>
<script src="/assets/nosotros.js" defer></script>`,
  });
}

add('404.html', {
  ruta: '/404', titulo: 'Página no encontrada',
  cuerpo: `<section class="page-head"><div class="wrap"><span class="kicker">Error 404</span><h1>Esta página no existe</h1><p>Puede que la hayamos movido. <a href="/">Vuelve al inicio</a> para ver la señal en vivo y lo último.</p></div></section>`,
});

// ---------- escribir ----------
await rm(out, { recursive: true, force: true });
await mkdir(new URL('noticias/pagina/', out), { recursive: true });
await cp(new URL('assets/', root), new URL('assets/', out), { recursive: true });
for (const [archivo, html] of Object.entries(paginas)) {
  const destino = new URL(archivo, out);
  await mkdir(new URL('./', destino), { recursive: true }); // carpetas como noticias/tema/politica/pagina/
  await writeFile(destino, html);
}

const urls = Object.keys(paginas).filter((a) => a !== '404.html').map((a) => `${S.url}/${a === 'index.html' ? '' : a.replace(/\.html$/, '')}`);
await writeFile(new URL('sitemap.xml', out), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}\n</urlset>\n`);
await writeFile(new URL('robots.txt', out), `User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: ${S.url}/sitemap.xml\n`);

console.log(`Listo: ${Object.keys(paginas).length} páginas · ${notas.length} noticias · ${videos.length} videos.`);
