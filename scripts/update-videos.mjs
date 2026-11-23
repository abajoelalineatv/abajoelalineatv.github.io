// Trae los últimos videos del canal de YouTube (feed RSS público, sin claves)
// y los agrega a data/videos.json sin borrar los antiguos.
// Uso: node scripts/update-videos.mjs
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const config = JSON.parse(await readFile(new URL('config.json', root), 'utf8'));
const dataFile = new URL('data/videos.json', root);

const decode = (s = '') =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&amp;/g, '&').trim();

const pick = (block, tag) => {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? decode(m[1]) : '';
};

const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${config.redes.youtubeCanalId}`;
const res = await fetch(feedUrl);
if (!res.ok) {
  console.error(`No se pudo leer el feed de YouTube (${res.status}). No se cambió nada.`);
  process.exit(1);
}
const xml = await res.text();
const nuevos = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, b]) => ({
  id: pick(b, 'yt:videoId'),
  titulo: pick(b, 'title'),
  descripcion: pick(b, 'media:description').slice(0, 400),
  fecha: pick(b, 'published'),
  short: /\/shorts\//.test((b.match(/<link rel="alternate" href="([^"]+)"/) || [])[1] || ''),
})).filter((v) => v.id);

let actuales = [];
try { actuales = JSON.parse(await readFile(dataFile, 'utf8')); } catch { /* primera vez */ }

const porId = new Map(actuales.map((v) => [v.id, v]));
let agregados = 0;
for (const v of nuevos) {
  const previo = porId.get(v.id);
  if (!previo) agregados++;
  // Si alguien corrigió a mano programa/categoría/oculto, se respeta.
  porId.set(v.id, { ...v, ...(previo ? { programa: previo.programa, categoria: previo.categoria, oculto: previo.oculto } : {}) });
}

// Videos antiguos sin el dato: preguntar a YouTube si son Shorts (verticales)
for (const v of porId.values()) {
  if (typeof v.short === 'boolean') continue;
  try {
    const r = await fetch(`https://www.youtube.com/shorts/${v.id}`, { method: 'HEAD', redirect: 'manual' });
    v.short = r.status === 200;
  } catch { /* sin conexión: se reintenta la próxima vez */ }
}

// Videos que no están en el feed reciente: si YouTube ya no tiene su miniatura,
// el video fue borrado o es privado → se oculta (sin borrarlo del archivo).
const enFeed = new Set(nuevos.map((v) => v.id));
for (const v of porId.values()) {
  if (enFeed.has(v.id) || v.oculto) continue;
  try {
    const r = await fetch(`https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`, { method: 'HEAD' });
    if (r.status === 404) { v.oculto = true; console.log(`Oculto (ya no existe en YouTube): ${v.titulo}`); }
  } catch { /* sin conexión */ }
}

const lista = [...porId.values()]
  .map((v) => Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)))
  .sort((a, b) => b.fecha.localeCompare(a.fecha));

await writeFile(dataFile, JSON.stringify(lista, null, 2) + '\n');
console.log(`Feed: ${nuevos.length} videos · nuevos: ${agregados} · total guardado: ${lista.length}`);
