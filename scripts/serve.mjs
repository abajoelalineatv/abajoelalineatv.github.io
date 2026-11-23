// Vista previa local: node scripts/serve.mjs  →  http://localhost:4321
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

const dir = new URL('../public/', import.meta.url);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain' };
const port = Number(process.env.PORT) || 4321;

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  if (path.includes('..')) { res.writeHead(400).end(); return; }
  if (!path) path = 'index.html';
  if (!extname(path)) path += '.html';
  try {
    const body = await readFile(new URL(path, dir));
    res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404, { 'content-type': types['.html'] }).end(await readFile(new URL('404.html', dir)).catch(() => 'No encontrado'));
  }
}).listen(port, () => console.log(`Vista previa en http://localhost:${port}`));
