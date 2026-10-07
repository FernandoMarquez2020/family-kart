/**
 * Renderiza la portada del juego y la deja embebida en el bundle.
 *
 * Abre el juego en Chromium con `?showcase=1`, le pide a `Showcase.ts` los seis
 * vehículos recortados y la foto de grupo, y escribe `src/ui/figures.ts`.
 *
 * Se hace fuera de línea y no en el arranque del juego por dos razones: la
 * calidad que queremos para la portada (materiales PBR, reflejos de entorno,
 * sombras blandas, 900 px por figura) cuesta varios segundos, y justo al abrir
 * la página es cuando menos disponible está el navegador. Renderizado una vez,
 * la presentación aparece instantánea.
 *
 * Uso: npm run build && node scripts/build-figures.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
};
const PORT = 4191;

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = join(DIST, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((resolve) => server.listen(PORT, resolve));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.error('ERROR en la página:', String(e)));

await page.goto(`http://localhost:${PORT}/?showcase=1`);
await page.waitForFunction(() => window.__showcase !== undefined, null, { timeout: 60000 });

console.log('renderizando…');
const { figures, hero, names } = await page.evaluate(async () => {
  const out = await window.__showcase.renderShowcase(900);
  return { ...out, names: window.__showcase.showcaseNames() };
}, { timeout: 600000 });

await browser.close();
server.close();

const kb = (s) => `${Math.round(s.length / 1024)} KB`;
for (const [id, url] of Object.entries(figures)) console.log(`  ${id}: ${kb(url)}`);
console.log(`  portada: ${kb(hero)}`);

const file = `/**
 * Portada del juego: los seis vehículos renderizados y la foto de grupo.
 *
 * Generado por \`scripts/build-figures.mjs\`. No editar a mano.
 *
 * Son renders de la misma geometría que se usa en pista, pero con materiales
 * PBR, reflejos de un entorno de estudio y sombras blandas: el juego corre
 * liviano y la presentación se ve como una foto.
 */

/** Cada vehículo con su piloto, recortado sobre fondo transparente. */
export const FIGURES: Record<string, string> = ${JSON.stringify(figures, null, 2)};

/** Los seis juntos sobre el piso pulido. Es el fondo de la presentación. */
export const HERO = ${JSON.stringify(hero)};

/** Nombre por defecto de cada piloto, para rotular la presentación. */
export const FIGURE_NAMES: Record<string, string> = ${JSON.stringify(names, null, 2)};
`;

await writeFile(join(ROOT, 'src/ui/figures.ts'), file);
console.log('src/ui/figures.ts escrito');
