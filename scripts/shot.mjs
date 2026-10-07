/**
 * Captura una pantalla del juego tal como se ve, para revisarla.
 *
 * Uso: SCRATCH=/ruta node scripts/shot.mjs [query] [nombre] [ancho] [alto] [esperaMs]
 * Ej.: node scripts/shot.mjs '' afiche 1440 900 3200
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const OUT = process.env.SCRATCH ?? '/tmp';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const PORT = 4195;

const [query = '', name = 'shot', width = '1440', height = '900', wait = '3200'] =
  process.argv.slice(2);

const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    const file = join(DIST, normalize(path === '/' ? '/index.html' : path).replace(/^(\.\.[/\\])+/, ''));
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: Number(width), height: Number(height) },
});
page.on('pageerror', (e) => console.error('page:', e.message));
await page.goto(`http://localhost:${PORT}/${query}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(Number(wait));
await page.screenshot({ path: join(OUT, `${name}.png`) });
console.log(`${name}.png`);

await browser.close();
server.close();
