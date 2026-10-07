/**
 * Saca retratos de control de las cabezas y los deja como PNG en $SCRATCH.
 *
 * Es una herramienta de verificación, no parte del juego: sirve para mirar cómo
 * quedó cada cabeza de frente, de tres cuartos, de perfil y de atrás sin tener
 * que correr una carrera y perseguir al piloto con la cámara.
 *
 * Uso: npm run build && SCRATCH=/ruta node scripts/head-shots.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const OUT = process.env.SCRATCH ?? '/tmp';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const PORT = 4193;

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
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.error('page:', e.message));
await page.goto(`http://localhost:${PORT}/?showcase=1`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => Boolean(window.__showcase), null, { timeout: 60000 });

const shots = await page.evaluate(() => window.__showcase.renderHeadShots(340));

for (const [id, urls] of Object.entries(shots)) {
  for (const [i, url] of urls.entries()) {
    await writeFile(join(OUT, `head-${id}-${i}.webp`), Buffer.from(url.split(',')[1], 'base64'));
  }
}
console.log(`${Object.keys(shots).length} cabezas × 4 ángulos → ${OUT}`);

await browser.close();
server.close();
