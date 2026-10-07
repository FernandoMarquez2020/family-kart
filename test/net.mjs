/**
 * Prueba del modo en red, con dos jugadores de verdad.
 *
 * Abre dos pestañas, las mete en la misma sala y verifica que lo que aprieta una
 * mueve su kart en la pantalla de la otra. Es la única forma de comprobar que la
 * red funciona: mirando una sola pestaña, un kart que se mueve puede ser
 * perfectamente la IA manejándolo, que es exactamente el error que uno quiere
 * que el test atrape.
 *
 * Usa el transporte entre pestañas (`?local=1`) y no WebRTC, a propósito. La
 * lógica de la partida —quién simula, qué se manda, cómo se corrige— es la misma
 * en los dos casos; lo único que cambia es el caño. Probando por acá, el test no
 * depende de que haya internet ni de que un broker externo esté vivo, y cuando
 * algo falle en una partida real se sabe de entrada si es la partida o la
 * conexión.
 *
 * Uso: npm run build && node test/net.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const PORT = 4197;
const ROOM = 'testsala';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
}

const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    const file = join(ROOT, normalize(path === '/' ? '/index.html' : path).replace(/^(\.\.[/\\])+/, ''));
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
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox',
    // Sin esto, la pestaña que queda atrás recibe un `requestAnimationFrame` por
    // segundo y su simulación prácticamente no avanza. En una partida de verdad
    // pasa lo mismo: el que minimiza el juego deja de simular. Para el anfitrión
    // eso sería fatal, así que conviene tenerlo presente.
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
  ],
});
// Las dos pestañas van en el MISMO contexto: `BroadcastChannel` sólo comunica
// páginas del mismo origen dentro del mismo perfil, así que en dos contextos
// aislados no se verían y el test fallaría por el motivo equivocado.
const context = await browser.newContext({ viewport: { width: 900, height: 600 } });

const errors = [];
const base = `http://localhost:${PORT}/?sala=${ROOM}&local=1`;

const host = await context.newPage();
host.on('pageerror', (e) => errors.push(`anfitrión: ${e}`));
await host.goto(base);
await host.waitForSelector('#lobby:not(.hidden)', { timeout: 30000 });

// Medio segundo para que la pestaña se declare anfitriona antes de que entre la
// segunda: si entran juntas, las dos creen que la sala es suya.
await host.waitForTimeout(900);

const guest = await context.newPage();
guest.on('pageerror', (e) => errors.push(`invitado: ${e}`));
await guest.goto(base);
await guest.waitForSelector('#lobby:not(.hidden)', { timeout: 30000 });
await guest.waitForTimeout(1500);

// Quién es anfitrión se mira por el botón de largar, que sólo él tiene. El
// texto de estado no sirve para distinguirlos: el del invitado también dice
// "anfitrión", porque lo está esperando.
const roles = {
  host: await host.evaluate(() => !document.querySelector('.lobby-start')?.classList.contains('hidden')),
  guest: await guest.evaluate(() => !document.querySelector('.lobby-start')?.classList.contains('hidden')),
};
check(
  'Uno solo puede largar la carrera',
  roles.host && !roles.guest,
  `anfitrión: ${roles.host} · invitado: ${roles.guest}`,
);

const seen = await host.evaluate(() => document.querySelectorAll('.lobby-players li').length);
check('El anfitrión ve al invitado en la sala', seen === 2, `${seen} jugadores en la lista`);

const link = await host.evaluate(() => document.querySelector('.lobby-link input')?.value ?? '');
check('La sala se comparte por un link', link.includes(`sala=${ROOM}`), link.slice(0, 60));

// --- La carrera -------------------------------------------------------------
await host.click('.lobby-start');
await host.waitForFunction(() => window.__kart !== undefined, null, { timeout: 30000 });
await guest.waitForFunction(() => window.__kart !== undefined, null, { timeout: 30000 });
check('Los dos entran a la carrera', true);

const assigned = await guest.evaluate(() => window.__kart.racers.length);
check('La parrilla tiene lugar para los dos', assigned >= 2, `${assigned} karts`);

const mine = {
  host: await host.evaluate(() => window.__kart.racers.findIndex((r) => r.isPlayer)),
  guest: await guest.evaluate(() => window.__kart.racers.findIndex((r) => r.isPlayer)),
};
check(
  'Cada uno maneja un kart distinto de la parrilla',
  mine.host === 0 && mine.guest > 0,
  `anfitrión: kart ${mine.host} · invitado: kart ${mine.guest}`,
);

/**
 * El reloj lo maneja el test, no el navegador.
 *
 * Las dos pestañas están en la misma ventana y sólo una puede estar adelante;
 * la de atrás recibe un `requestAnimationFrame` por segundo y su simulación
 * queda congelada. Avanzando los dos a mano, de a un paso cada uno, las dos
 * corren al mismo ritmo y la prueba deja de depender de cuál quedó visible.
 *
 * Entre paso y paso hay una ida y vuelta al navegador, que es justo lo que le
 * da al canal la oportunidad de entregar los mensajes: sin eso, la simulación
 * avanzaría sin que llegara nunca nada.
 */
for (const page of [host, guest]) {
  await page.evaluate(() => {
    window.__kart.stop();
    window.__kart.resetClock();
  });
}

async function advance(seconds) {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) {
    await host.evaluate(() => window.__kart.step(1 / 60));
    await guest.evaluate(() => window.__kart.step(1 / 60));
  }
}

// Que pase la cuenta regresiva.
await advance(4);

// El invitado acelera a fondo; el anfitrión no toca nada.
await guest.evaluate(() => {
  window.__kart.input.setOverride({ throttle: 1, brake: 0, steer: 0 });
});
await advance(2.5);

/**
 * En la pantalla del ANFITRIÓN, ¿se movió el kart del invitado?
 *
 * Se mide sobre el anfitrión a propósito: es quien simula, así que si ahí se
 * movió es porque las teclas viajaron de verdad por el canal. Midiéndolo en la
 * pestaña del invitado no probaría nada — ahí el kart se mueve por su propia
 * física, conectado o no.
 */
const moved = await host.evaluate(() => {
  const g = window.__kart;
  return g.racers.map((r) => ({ id: r.id, kmh: Math.round(r.telemetry.speedKmh) }));
});
const guestKart = moved.find((r) => r.id === mine.guest);
check(
  'Lo que aprieta el invitado mueve su kart en la pantalla del anfitrión',
  guestKart && guestKart.kmh > 30,
  `kart ${mine.guest} a ${guestKart?.kmh ?? '?'} km/h`,
);

// Y al revés: la posición que calcula el anfitrión tiene que llegarle al invitado.
const positions = await Promise.all([
  host.evaluate((id) => {
    const p = window.__kart.racers[id].physics.position;
    return [p.x, p.z];
  }, mine.guest),
  guest.evaluate((id) => {
    const p = window.__kart.racers[id].physics.position;
    return [p.x, p.z];
  }, mine.guest),
]);
const gap = Math.hypot(positions[0][0] - positions[1][0], positions[0][1] - positions[1][1]);
check(
  'Las dos pantallas muestran la carrera en el mismo lugar',
  gap < 12,
  `${gap.toFixed(1)} m de diferencia`,
);

// El kart del anfitrión, que nadie tocó, tiene que seguir quieto o casi: si se
// moviera, sería la IA manejándolo y el reparto de karts estaría mal.
const hostKart = moved.find((r) => r.id === 0);
check(
  'El kart del anfitrión no lo maneja la máquina',
  hostKart && hostKart.kmh < 12,
  `kart 0 a ${hostKart?.kmh ?? '?'} km/h`,
);

check('Sin errores en consola', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
server.close();

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} verificaciones pasaron`);
process.exit(passed === results.length ? 0 : 1);
