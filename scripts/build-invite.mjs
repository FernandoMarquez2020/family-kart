/**
 * Renderiza la imagen que se ve al compartir el link de una sala.
 *
 * Cuando alguien manda el link por WhatsApp, lo que llega del otro lado no es el
 * link: es una tarjeta con una imagen, un título y una línea de texto. Esa
 * tarjeta la arma WhatsApp leyendo las etiquetas Open Graph de la página, y la
 * imagen tiene que existir como archivo en el servidor —no alcanza con que el
 * juego la dibuje al abrirse, porque el que previsualiza el link nunca abre el
 * juego—. Por eso se renderiza acá, una vez, y queda en `public/`.
 *
 * La imagen es el propio motor del juego: se arma una carrera de cuatro karts,
 * se los acomoda en formación y se los fotografía desde adelante y abajo, que es
 * el ángulo que los hace ver rápidos. Una captura cualquiera de la cámara de
 * juego no sirve: va desde atrás del jugador, así que lo que se ve es una nuca y
 * tres puntos lejanos.
 *
 * Uso: npm run build && node scripts/build-invite.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const OUT = join(ROOT, 'public', 'invitacion.jpg');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const PORT = 4197;

// Medida de la tarjeta de WhatsApp, Telegram, Facebook y Twitter: 1200×630.
// Fuera de esa proporción la imagen se recorta sola y el recorte nunca cae donde
// uno quiere.
const WIDTH = 1200;
const HEIGHT = 630;

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
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
  ],
});
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
page.on('pageerror', (e) => console.error('page:', e.message));

await page.goto(
  `http://localhost:${PORT}/?autostart=1&racers=4&c=miami&track=miami&dif=normal`,
  { waitUntil: 'networkidle' },
);
await page.waitForFunction(() => window.__kart !== undefined, null, { timeout: 60000 });
// Un par de segundos de carrera: los karts se separan un poco y las ruedas
// quedan giradas. Parados en la grilla se ven como un catálogo.
await page.waitForTimeout(2600);

const posed = await page.evaluate(
  ({ width, height }) => {
    const game = window.__kart;
    game.stop();

    // --- Formación -----------------------------------------------------------
    // Rombo: dos adelante, dos atrás escalonados. Es la formación que más karts
    // deja ver sin que ninguno tape a otro.
    // El punto de referencia se copia ANTES de mover a nadie: si se lee del kart
    // que ya se movió, cada uno se acomoda respecto del anterior y la formación
    // se va caminando sola fuera del cuadro.
    const lead = game.racers[0].physics;
    const origin = { x: lead.position.x, y: lead.position.y, z: lead.position.z };
    const heading = lead.yaw;
    const forward = { x: Math.sin(heading), z: Math.cos(heading) };
    const right = { x: forward.z, z: -forward.x };
    // Dos adelante y dos atrás, cada uno en el hueco que dejan los de adelante:
    // en fila india el de atrás desaparece, y en línea recta los cuatro se leen
    // como una fila de autitos quietos.
    const slots = [
      [-1.9, 0],
      [2.0, -0.5],
      [-5.4, -3.2],
      [5.6, -3.8],
    ];
    game.racers.forEach((racer, i) => {
      const [side, back] = slots[i] ?? [0, -6];
      const p = racer.physics;
      p.position.set(
        origin.x + right.x * side + forward.x * back,
        origin.y,
        origin.z + right.z * side + forward.z * back,
      );
      p.yaw = heading + (i === 2 ? 0.08 : i === 3 ? -0.07 : 0);
      racer.sync(0.016);
    });

    // --- Cámara --------------------------------------------------------------
    // Adelante del grupo, baja y mirando hacia atrás: el contrapicado es lo que
    // los hace ver grandes y rápidos. Desde la altura de la cámara de juego el
    // mismo grupo se ve como cuatro juguetes sobre una alfombra.
    const cam = game.chase.camera;
    const AHEAD = 8.6;
    const HIGH = 2.45;
    cam.position.set(
      origin.x + forward.x * AHEAD,
      origin.y + HIGH,
      origin.z + forward.z * AHEAD,
    );
    cam.lookAt(
      origin.x - forward.x * 2.4,
      origin.y + 0.5,
      origin.z - forward.z * 2.4,
    );
    cam.fov = 52;
    cam.aspect = width / height;
    cam.updateProjectionMatrix();

    game.renderer.render(game.scene, cam);

    // El HUD y el botón de salir no son parte de la invitación.
    for (const id of ['hud', 'back-btn', 'options-btn', 'options']) {
      document.getElementById(id)?.classList.add('hidden');
    }
    for (const el of document.querySelectorAll('.options-toggle, #options-open')) {
      el.classList.add('hidden');
    }
    return { karts: game.racers.length };
  },
  { width: WIDTH, height: HEIGHT },
);

// --- Rótulo ------------------------------------------------------------------
// La tarjeta se ve chica y entre muchos mensajes. Sin el nombre encima, es una
// foto de cuatro autitos; con el nombre, es una invitación.
await page.evaluate(() => {
  const band = document.createElement('div');
  band.id = 'invite-band';
  band.innerHTML = `
    <div class="invite-mark">
      <h1><span>FAMILY</span> <b>KART</b></h1>
      <p>Carrera online &middot; ¡te invitaron a correr!</p>
    </div>
  `;
  const css = document.createElement('style');
  css.textContent = `
    #invite-band {
      position: fixed; inset: auto 0 0 0; z-index: 99;
      padding: 48px 56px 40px;
      background: linear-gradient(to top, rgba(6,9,18,0.92) 12%, rgba(6,9,18,0.55) 55%, transparent);
      font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
      display: flex; align-items: flex-end;
    }
    #invite-band h1 {
      margin: 0; font-size: 78px; line-height: 0.92; letter-spacing: -2px;
      font-weight: 900; color: #fff; text-shadow: 0 8px 36px rgba(0,0,0,0.8);
    }
    #invite-band h1 b { color: #ffcc33; }
    #invite-band p {
      margin: 14px 0 0; font-size: 26px; letter-spacing: 1.5px;
      text-transform: uppercase; font-weight: 700; color: #cfe3ff;
      text-shadow: 0 4px 18px rgba(0,0,0,0.9);
    }
  `;
  document.head.append(css);
  document.getElementById('app')?.append(band);
});
await page.waitForTimeout(250);

await mkdir(join(ROOT, 'public'), { recursive: true });
const shot = await page.screenshot({ type: 'jpeg', quality: 88 });
await writeFile(OUT, shot);
console.log(`public/invitacion.jpg — ${posed.karts} karts, ${(shot.length / 1024).toFixed(0)} kB`);

await browser.close();
server.close();
