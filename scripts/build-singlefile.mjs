/**
 * Genera una versión del juego en un único archivo HTML, con el CSS y el JS
 * incrustados. Sirve para publicarlo donde no se pueden servir assets sueltos
 * (un artifact, un adjunto, un pendrive) sin cambiar nada del proyecto.
 *
 * Uso: npm run build && node scripts/build-singlefile.mjs [salida.html]
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const DIST = 'dist';
const out = process.argv[2] ?? 'dist/kart-royale-standalone.html';

let html = await readFile(join(DIST, 'index.html'), 'utf8');
const assets = await readdir(join(DIST, 'assets'));

const cssFile = assets.find((f) => f.endsWith('.css'));
const jsFile = assets.find((f) => f.endsWith('.js'));
if (!cssFile || !jsFile) throw new Error('No se encontraron los assets del build');

const css = await readFile(join(DIST, 'assets', cssFile), 'utf8');
const js = await readFile(join(DIST, 'assets', jsFile), 'utf8');

html = html
  .replace(/<link[^>]+rel="stylesheet"[^>]*>/, `<style>${css}</style>`)
  .replace(/<script[^>]+src="[^"]*\.js"[^>]*><\/script>/, () => {
    // El cierre de script dentro del bundle rompería el HTML.
    return `<script type="module">${js.replace(/<\/script>/gi, '<\\/script>')}</script>`;
  });

await writeFile(out, html);
console.log(`${out} — ${(html.length / 1024).toFixed(0)} kB`);
