/**
 * Test de humo del juego.
 *
 * Abre el juego en Chromium y lo maneja por la API de override de inputs,
 * verificando que la física, las pistas, los rivales, los poderes y el
 * cronómetro hagan lo que tienen que hacer. No reemplaza probarlo a mano, pero
 * atrapa las regresiones grandes sin que haya que jugar.
 *
 * La simulación se avanza a mano con `game.step(dt)` en lugar de esperar al
 * requestAnimationFrame: así el test es determinista, no depende de los FPS y
 * corre en segundos incluso donde el render es por software.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist');
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
};
const PORT = 4173;
const CHARACTERS = ['futbol', 'gaming', 'bloques', 'rosa', 'puerto', 'miami'];

const results = [];
function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));
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

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

/** Carga una partida y deja instalados los helpers que usa el test. */
async function open(query) {
  await page.goto(`http://localhost:${PORT}/?${query}&autostart=1`);
  await page.waitForFunction(() => window.__kart !== undefined, null, { timeout: 30000 });
  await page.evaluate(() => {
    const g = window.__kart;
    g.stop(); // a partir de acá el test maneja el reloj
    g.resetClock();

    // Entre que la página carga y el test toma el control, el juego corrió
    // bajo requestAnimationFrame una cantidad de tiempo que depende de la
    // máquina. Volvemos a la parrilla para que cada corrida arranque igual.
    g.director.phase = 'countdown';
    g.director.countdown = 3.5;
    g.director.clock = 0;
    g.racers.forEach((racer, i) => {
      const start = g.path.startTransform(i);
      racer.physics.position.copy(start.position);
      racer.physics.yaw = start.yaw;
      racer.physics.velocity.set(0, 0, 0);
      racer.physics.boostTime = 0;
      racer.physics.spinTime = 0;
      racer.physics.immuneTime = 0;
      racer.item = null;
      racer.laps.reset();
      racer.step(1 / 120, g.input.state, false);
      // Varios `sync` seguidos: la inclinación del modelo se suaviza con el
      // tiempo y arrastra lo que hubiera quedado de los frames que corrieron
      // antes de que el test tomara el reloj. Sin esto, la medición de la altura
      // de las ruedas da distinto según lo rápida que sea la máquina.
      for (let k = 0; k < 60; k++) racer.sync(1 / 120);
    });
    g.chase.snapTo(g.player.physics);

    window.__sim = (seconds, dt = 1 / 120) => {
      const steps = Math.round(seconds / dt);
      for (let i = 0; i < steps; i++) g.step(dt);
    };

    /**
     * Piloto automático para el kart del jugador: sigue la tangente del trazado
     * y se recentra. Lo usamos para llevarlo a una situación concreta sin que
     * se vaya al pasto, y para validar que el circuito es recorrible.
     */
    window.__auto = (seconds, extra = {}, dt = 1 / 120) => {
      const steps = Math.round(seconds / dt);
      let offTrackSteps = 0;
      let maxSpeedKmh = 0;
      const player = g.player;
      for (let i = 0; i < steps; i++) {
        const p = player.physics;
        const proj = p.projection;
        const fwd = p.forward;
        // El volante va con signo cambiado respecto del error de rumbo: en la
        // convención de three.js el yaw crece girando hacia la izquierda.
        const heading = Math.atan2(fwd.x, fwd.z);
        const desired = Math.atan2(proj.tangent.x, proj.tangent.z);
        let err = desired - heading;
        while (err > Math.PI) err -= Math.PI * 2;
        while (err < -Math.PI) err += Math.PI * 2;
        const toTangent = -err;
        const centering = -proj.lateral / Math.max(proj.halfWidth, 1);
        const steer = Math.max(-1, Math.min(1, toTangent * 2.6 + centering * 0.7));
        const throttle = Math.max(0.5, Math.min(1, 1 - Math.abs(proj.curvature) * 28));
        g.input.setOverride({ throttle, brake: 0, steer, drift: false, ...extra });
        g.step(dt);
        if (proj.offTrack) offTrackSteps++;
        maxSpeedKmh = Math.max(maxSpeedKmh, player.telemetry.speedKmh);
        if (player.laps.lap > 1 || player.finished) {
          return { finished: true, steps: i + 1, offTrackRatio: offTrackSteps / (i + 1), maxSpeedKmh };
        }
      }
      return { finished: false, steps, offTrackRatio: offTrackSteps / steps, maxSpeedKmh };
    };

    /** ¿Se está dibujando el asfalto bajo el kart? */
    window.__probeRoad = () => {
      const gl = g.renderer.domElement;
      const probe = document.createElement('canvas');
      probe.width = gl.width;
      probe.height = gl.height;
      const ctx = probe.getContext('2d');

      const sampleStrip = () => {
        g.render();
        ctx.drawImage(gl, 0, 0);
        const data = ctx.getImageData(
          Math.floor(gl.width * 0.35),
          Math.floor(gl.height * 0.86),
          Math.floor(gl.width * 0.3),
          1,
        ).data;
        const acc = [0, 0, 0];
        const n = data.length / 4;
        for (let i = 0; i < data.length; i += 4) {
          acc[0] += data[i];
          acc[1] += data[i + 1];
          acc[2] += data[i + 2];
        }
        return acc.map((v) => v / n);
      };

      const road = g.scene.getObjectByName('road');
      const withRoad = sampleStrip();
      road.visible = false;
      const withoutRoad = sampleStrip();
      road.visible = true;
      // Volvemos a renderizar: si no, el framebuffer queda con la última vista
      // sin la pista y cualquier captura posterior sale mal.
      g.render();

      return {
        sample: withRoad.map(Math.round),
        withoutRoad: withoutRoad.map(Math.round),
        delta: withRoad.reduce((sum, v, i) => sum + Math.abs(v - withoutRoad[i]), 0),
      };
    };

    window.__clearMessage = () => {
      const el = document.getElementById('hud-center-msg');
      el.classList.remove('show');
      el.style.display = 'none';
    };

    /** Retrato del kart desde adelante. Devuelve cuánto ocupa en el cuadro. */
    window.__portrait = () => {
      const cam = g.chase.camera;
      const saved = { pos: cam.position.clone(), quat: cam.quaternion.clone(), fov: cam.fov };
      const p = g.player.physics;
      const fwd = p.forward;
      const s = g.player.character.appearance.scale;
      const eye = p.position.clone();
      eye.x += fwd.x * 4.6 * s;
      eye.z += fwd.z * 4.6 * s;
      eye.y += 1.4 + 0.35 * s;
      cam.position.copy(eye);
      cam.up.set(0, 1, 0);
      cam.fov = 42;
      cam.updateProjectionMatrix();
      cam.lookAt(p.position.x, p.position.y + 0.35 + 0.35 * s, p.position.z);
      document.getElementById('hud').classList.add('hidden');

      const gl = g.renderer.domElement;
      const probe = document.createElement('canvas');
      probe.width = gl.width;
      probe.height = gl.height;
      const ctx = probe.getContext('2d');
      const sampleCenter = () => {
        g.render();
        ctx.drawImage(gl, 0, 0);
        return ctx.getImageData(
          Math.floor(gl.width * 0.38),
          Math.floor(gl.height * 0.4),
          Math.floor(gl.width * 0.24),
          Math.floor(gl.height * 0.35),
        ).data;
      };

      const withKart = sampleCenter();
      g.player.view.group.visible = false;
      const withoutKart = sampleCenter();
      g.player.view.group.visible = true;
      g.render();

      // Sumamos los tres canales: en el tema oscuro el kart y el fondo se
      // diferencian poco en cada canal por separado, pero el total sí cambia.
      let changed = 0;
      for (let i = 0; i < withKart.length; i += 4) {
        const diff =
          Math.abs(withKart[i] - withoutKart[i]) +
          Math.abs(withKart[i + 1] - withoutKart[i + 1]) +
          Math.abs(withKart[i + 2] - withoutKart[i + 2]);
        if (diff > 18) changed++;
      }

      window.__restorePortrait = () => {
        cam.position.copy(saved.pos);
        cam.quaternion.copy(saved.quat);
        cam.fov = saved.fov;
        cam.updateProjectionMatrix();
        document.getElementById('hud').classList.remove('hidden');
      };

      return changed / (withKart.length / 4);
    };
  });
}

const drive = (state) => page.evaluate((s) => window.__kart.input.setOverride(s), state);
const sim = (seconds) => page.evaluate((s) => window.__sim(s), seconds);
const auto = (seconds, extra = {}) =>
  page.evaluate(([s, e]) => window.__auto(s, e), [seconds, extra]);
const read = () =>
  page.evaluate(() => {
    const g = window.__kart;
    const p = g.player;
    const t = p.telemetry;
    return {
      speedKmh: t.speedKmh,
      offTrack: t.offTrack,
      lateral: t.projection.lateral,
      halfWidth: t.projection.halfWidth,
      grounded: t.grounded,
      wrongWay: t.wrongWay,
      spinning: t.spinning,
      immune: t.immune,
      boosting: t.boostTime,
      driftActive: t.drift.active,
      driftCharge: t.drift.charge,
      driftTier: t.drift.tier,
      yaw: p.physics.yaw,
      y: p.physics.position.y,
      item: p.item,
      position: p.position,
      lap: p.laps.lap,
      progress: p.laps.totalProgress,
      bestLap: p.laps.bestLapTime,
      finished: p.finished,
      phase: g.director.phase,
      racers: g.racers.length,
      countdown: g.director.countdown,
      raceTime: p.laps.raceTime,
      trackName: g.trackName,
      trackLength: g.path.totalLength,
      theme: g.path.spec.theme,
      character: g.player.character.id,
      number: g.player.character.kart.number,
    };
  });

// ===========================================================================
// Parte 1 — manejo, sobre una contrarreloj (sin rivales que molesten)
// ===========================================================================
await open('c=futbol&mode=contrarreloj&laps=3');

const initial = await read();
check('Arranca en cuenta regresiva', initial.phase === 'countdown');
check('La contrarreloj corre en solitario', initial.racers === 1, `${initial.racers} kart`);
check('El kart arranca sobre el asfalto', !initial.offTrack, `lateral ${initial.lateral.toFixed(2)} m`);
check('El kart arranca apoyado en el piso', initial.grounded);

// --- Las ruedas tocan el piso ---------------------------------------------
const ride = await page.evaluate(() => {
  const g = window.__kart;
  const p = g.player.physics;
  const surface = p.projection.surfaceY;
  // El punto más bajo del modelo del kart, en coordenadas del mundo. Sólo
  // cuentan las piezas visibles: el aura del rayo y la llama del turbo están
  // ocultas pero su caja llega bastante más abajo que las ruedas.
  let lowest = Infinity;
  g.player.view.group.updateMatrixWorld(true);
  g.player.view.group.traverse((obj) => {
    if (!obj.isMesh || !obj.visible) return;
    let node = obj;
    while (node) {
      if (!node.visible) return;
      node = node.parent;
    }
    if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
    const bb = obj.geometry.boundingBox.clone();
    bb.applyMatrix4(obj.matrixWorld);
    lowest = Math.min(lowest, bb.min.y);
  });
  return { surface, lowest, gap: lowest - surface };
});
check(
  'Las ruedas apoyan en el asfalto y no flotan',
  ride.gap > -0.25 && ride.gap < 0.2,
  `separación ${ride.gap.toFixed(3)} m`,
);

// --- Aceleración ----------------------------------------------------------
// Primero dejamos correr la cuenta regresiva entera y recién después medimos,
// en vez de medir dentro de la misma ventana: así el número no depende de
// cuántas décimas queden de cuenta.
await sim(4);
const launched = await read();
check('La carrera arranca sola al terminar la cuenta', launched.phase === 'racing');
check(
  'El reloj de vuelta no corre durante la cuenta regresiva',
  launched.raceTime < 1,
  `${launched.raceTime.toFixed(2)} s de carrera tras ${initial.countdown.toFixed(2)} s de cuenta`,
);

await drive({ throttle: 1, brake: 0, steer: 0, drift: false });
await sim(1);
check(
  'El kart acelera',
  (await read()).speedKmh > 60,
  `${(await read()).speedKmh.toFixed(0)} km/h en un segundo`,
);

// Velocidad punta: a fondo, sin levantar el pie en las curvas. Así se mide el
// tope real del motor; en esa vuelta el kart se abre y eso está bien.
const cruise = await auto(7, { throttle: 1 });
check('Alcanza velocidad punta', cruise.maxSpeedKmh > 135, `máx ${cruise.maxSpeedKmh.toFixed(0)} km/h`);

// Y por separado, manejando de verdad (levantando el pie en las curvas), el
// kart tiene que quedarse sobre el asfalto.
await page.evaluate(() => window.__kart.player.physics.respawn());
const clean = await auto(8);
const cruising = await read();
check(
  'Se mantiene sobre el asfalto',
  !cruising.offTrack && clean.offTrackRatio < 0.1,
  `lateral ${cruising.lateral.toFixed(1)} m, ${(clean.offTrackRatio * 100).toFixed(1)} % fuera`,
);

// --- Frenado --------------------------------------------------------------
await drive({ throttle: 0, brake: 1, steer: 0, drift: false });
await sim(1.5);
const braked = await read();
check(
  'El freno detiene el kart',
  braked.speedKmh < cruising.speedKmh * 0.6,
  `${cruising.speedKmh.toFixed(0)} → ${braked.speedKmh.toFixed(0)} km/h`,
);

// --- Dirección ------------------------------------------------------------
await page.evaluate(() => window.__kart.player.physics.respawn());
await drive({ throttle: 1, brake: 0, steer: 0, drift: false });
await sim(2.5);
const beforeTurn = (await read()).yaw;
await drive({ throttle: 1, brake: 0, steer: 1, drift: false });
await sim(1.2);
check(
  'El volante cambia el rumbo',
  Math.abs((await read()).yaw - beforeTurn) > 0.3,
  `Δyaw ${((await read()).yaw - beforeTurn).toFixed(2)} rad`,
);

// --- Derrape y mini turbo -------------------------------------------------
await page.evaluate(() => window.__kart.player.physics.respawn());
await auto(3);
await drive({ throttle: 1, brake: 0, steer: 1, drift: true });
await sim(3.6);
const drifting = await read();
check('Se activa el derrape', drifting.driftActive);
check(
  'El derrape carga el mini turbo',
  drifting.driftTier >= 2,
  `nivel ${drifting.driftTier}, carga ${drifting.driftCharge.toFixed(2)} s`,
);
const speedBeforeBoost = drifting.speedKmh;
await drive({ throttle: 1, brake: 0, steer: 0, drift: false });
await sim(0.2);
check('Soltar el derrape otorga turbo', (await read()).boosting);
await sim(0.9);
check(
  'El turbo acelera al kart',
  (await read()).speedKmh > speedBeforeBoost,
  `${speedBeforeBoost.toFixed(0)} → ${(await read()).speedKmh.toFixed(0)} km/h`,
);

// --- Fuera de pista y barrera ---------------------------------------------
await page.evaluate(() => window.__kart.player.physics.respawn());
await auto(4);
const onTrackSpeed = (await read()).speedKmh;
// Comparamos la velocidad de equilibrio a fondo sobre el asfalto contra la del
// pasto, manteniendo el kart clavado a una distancia lateral fija en cada paso.
// Medir "antes y después" de salirse no sirve: el "antes" depende del tramo en
// el que venía el kart y las dos cifras terminan comparando cosas distintas.
const grass = await page.evaluate(() => {
  const g = window.__kart;
  const p = g.player.physics;

  const settle = (lateral, seconds) => {
    let offSteps = 0;
    const steps = Math.round(120 * seconds);
    for (let i = 0; i < steps; i++) {
      const proj = p.projection;
      p.position.addScaledVector(proj.right, lateral - proj.lateral);
      g.input.setOverride({ throttle: 1, brake: 0, steer: 0, drift: false });
      g.step(1 / 120);
      if (g.player.telemetry.offTrack) offSteps++;
    }
    return { speed: g.player.telemetry.speedKmh, offRatio: offSteps / steps };
  };

  const onTrack = settle(0, 4);
  const offTrack = settle(p.projection.halfWidth + 3, 4);
  return { before: onTrack.speed, after: offTrack.speed, offRatio: offTrack.offRatio };
});
check(
  'El costado se detecta como fuera de pista',
  grass.offRatio > 0.9,
  `${(grass.offRatio * 100).toFixed(0)} % de los pasos fuera de pista`,
);
check(
  'Salirse frena al kart',
  grass.after < grass.before * 0.9,
  `${grass.before.toFixed(0)} → ${grass.after.toFixed(0)} km/h`,
);
void onTrackSpeed;

// Salirse tiene que costar, pero no dejarte a pie: desde el pasto se tiene que
// poder maniobrar y volver a la pista en pocos segundos.
const recovery = await page.evaluate(() => {
  const g = window.__kart;
  const p = g.player.physics;
  const proj0 = p.projection;
  p.position.addScaledVector(proj0.right, proj0.halfWidth + 6 - proj0.lateral);
  p.velocity.set(0, 0, 0);
  window.__sim(0.2);
  const speedOnGrass = [];
  let stepsBack = null;
  for (let i = 0; i < 120 * 8; i++) {
    const proj = p.projection;
    // Acelerar y girar hacia la pista, que es lo que haría el jugador.
    const steer = Math.max(-1, Math.min(1, -proj.lateral / Math.max(proj.halfWidth, 1)));
    g.input.setOverride({ throttle: 1, brake: 0, steer, drift: false });
    g.step(1 / 120);
    if (proj.offTrack) speedOnGrass.push(g.player.telemetry.speedKmh);
    else if (stepsBack === null) stepsBack = i;
  }
  return {
    seconds: stepsBack === null ? null : stepsBack / 120,
    topOnGrass: speedOnGrass.length ? Math.max(...speedOnGrass) : 0,
  };
});
check(
  'Desde el pasto se puede volver a la pista',
  recovery.seconds !== null && recovery.seconds < 5,
  recovery.seconds === null
    ? 'no volvió en 8 s'
    : `volvió en ${recovery.seconds.toFixed(1)} s`,
);
check(
  'En el pasto se sigue avanzando a ritmo razonable',
  recovery.topOnGrass > 70,
  `máximo ${recovery.topOnGrass.toFixed(0)} km/h fuera de pista`,
);

// Fuera de pista el terreno baja; el kart tiene que bajar con él y no quedar
// flotando sobre el plano del asfalto prolongado.
const grassRide = await page.evaluate(() => {
  const g = window.__kart;
  const p = g.player.physics;
  // Bien adentro del pasto, donde la banquina ya bajó bastante. Posición
  // lateral absoluta, para que no dependa de dónde venía el kart.
  // Sin acelerador y reponiendo la posición lateral en cada paso: lo que se
  // mide es la altura de apoyo, no el manejo, y con el kart libre el tramo de
  // pista en que termina —y por lo tanto la pendiente de la banquina— cambia
  // según lo que hubiera quedado en el override anterior.
  p.velocity.set(0, 0, 0);
  for (let i = 0; i < 120; i++) {
    const proj = p.projection;
    p.position.addScaledVector(proj.right, proj.halfWidth + 12 - proj.lateral);
    g.input.setOverride({ throttle: 0, brake: 0, steer: 0, drift: false });
    g.step(1 / 120); // que caiga y se asiente
  }
  let lowest = Infinity;
  g.player.view.group.updateMatrixWorld(true);
  g.player.view.group.traverse((obj) => {
    if (!obj.isMesh || !obj.visible) return;
    let node = obj;
    while (node) {
      if (!node.visible) return;
      node = node.parent;
    }
    if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
    const bb = obj.geometry.boundingBox.clone();
    bb.applyMatrix4(obj.matrixWorld);
    lowest = Math.min(lowest, bb.min.y);
  });
  const proj = p.projection;
  return {
    gap: lowest - proj.surfaceY,
    offsetFromEdge: Math.abs(proj.lateral) - proj.halfWidth,
    drop: proj.surfaceY - g.path.sampleAt(proj.index).position.y,
  };
});
check(
  'Fuera de pista el kart apoya en la banquina, no flota',
  grassRide.gap > -0.3 && grassRide.gap < 0.25,
  `a ${grassRide.offsetFromEdge.toFixed(1)} m del borde, separación ${grassRide.gap.toFixed(3)} m, terreno ${grassRide.drop.toFixed(2)} m más bajo`,
);

await page.evaluate(() => {
  const p = window.__kart.player.physics;
  p.position.addScaledVector(p.projection.right, 200);
});
await sim(0.5);
const barrier = await read();
check(
  'La barrera exterior devuelve el kart al escenario',
  Math.abs(barrier.lateral) < barrier.halfWidth + 30,
  `lateral ${barrier.lateral.toFixed(1)} m`,
);

// --- Contramano -----------------------------------------------------------
await page.evaluate(() => {
  const p = window.__kart.player.physics;
  p.respawn();
  p.yaw += Math.PI;
});
await drive({ throttle: 1, brake: 0, steer: 0, drift: false });
await sim(1.5);
check('Detecta que el kart va en contramano', (await read()).wrongWay);

// --- El volante dobla para el lado correcto --------------------------------
// Se mide contra la PANTALLA, no contra los vectores internos: comprobar que el
// kart se mueve hacia su propio vector "derecha" no prueba nada si ese vector
// está invertido, que es exactamente lo que pasaba. Acá se proyecta la posición
// del kart con la cámara del jugador y se mira de qué lado del cuadro termina.
const steering = await page.evaluate(() => {
  const g = window.__kart;
  const p = g.player.physics;
  const start = g.path.startTransform(0);
  const out = {};
  for (const [name, steer] of [['derecha', 1], ['izquierda', -1]]) {
    p.position.copy(start.position);
    p.yaw = start.yaw;
    p.velocity.set(0, 0, 0);
    g.director.phase = 'racing';
    g.step(1 / 120);
    g.chase.snapTo(p);
    // Cámara congelada en la pose del instante en que se aprieta la flecha.
    const cam = g.chase.camera.clone();
    cam.updateMatrixWorld(true);
    for (let i = 0; i < 120 * 1.2; i++) {
      g.input.setOverride({ throttle: 1, brake: 0, steer: 0, drift: false });
      g.step(1 / 120);
    }
    const before = p.position.clone().project(cam).x;
    for (let i = 0; i < 120; i++) {
      g.input.setOverride({ throttle: 1, brake: 0, steer, drift: false });
      g.step(1 / 120);
    }
    out[name] = p.position.clone().project(cam).x - before;
  }
  return out;
});
check(
  'La flecha derecha lleva el kart a la derecha de la pantalla',
  steering.derecha > 0.05,
  `desplazamiento en pantalla ${steering.derecha.toFixed(3)}`,
);
check(
  'La flecha izquierda lleva el kart a la izquierda de la pantalla',
  steering.izquierda < -0.05,
  `desplazamiento en pantalla ${steering.izquierda.toFixed(3)}`,
);

// --- Rampas y cajas -------------------------------------------------------
const pickupRun = await page.evaluate(() => {
  const g = window.__kart;
  const player = g.player;
  player.physics.respawn();
  player.item = null;
  let boosted = false;
  let gotItem = null;
  let shards = 0;
  // Una vuelta entera pasa por las tres rampas y los dos grupos de cajas.
  for (let i = 0; i < 120 * 90; i++) {
    window.__auto(1 / 120);
    if (player.telemetry.boostTime) boosted = true;
    if (player.item && gotItem === null) {
      gotItem = player.item;
      // Los pedazos de la caja recién rota, antes de que se apaguen.
      shards = g.items.pickups.shardCount;
    }
    if (boosted && gotItem) break;
  }
  return {
    boosted,
    gotItem,
    shards,
    pads: g.items.pickups.pads.length,
    boxes: g.items.pickups.boxes.length,
  };
});
check('Hay 3 rampas de turbo en la pista', pickupRun.pads === 3, `${pickupRun.pads} rampas`);
check(
  'La caja estalla en pedazos al agarrarla',
  pickupRun.shards > 0,
  `${pickupRun.shards} pedazos en el aire al momento de agarrarla`,
);
check('Hay cajas de poder en 2 puntos', pickupRun.boxes === 6, `${pickupRun.boxes} cajas (3 por punto)`);
check('Pisar una rampa da turbo', pickupRun.boosted);
check('Las cajas entregan un poder', pickupRun.gotItem !== null, `salió ${pickupRun.gotItem}`);
check(
  'En contrarreloj la caja da siempre el rayo',
  pickupRun.gotItem === 'rayo',
  `salió ${pickupRun.gotItem}`,
);

// ===========================================================================
// Parte 2 — carrera con rivales y poderes
// ===========================================================================
await open('c=bloques&mode=carrera&racers=4&dif=normal&laps=2');

const raceStart = await read();
check('La carrera larga con los karts pedidos', raceStart.racers === 4, `${raceStart.racers} karts`);

const gridCheck = await page.evaluate(() => {
  const g = window.__kart;
  const positions = g.racers.map((r) => r.physics.position.clone());
  let minDist = Infinity;
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      minDist = Math.min(minDist, positions[i].distanceTo(positions[j]));
    }
  }
  const names = g.racers.map((r) => r.name);
  const numbers = g.racers.map((r) => r.character.kart.number);
  return { minDist, names, unique: new Set(names).size, numbers };
});
check(
  'Los karts largan separados, sin encimarse',
  gridCheck.minDist > 1.8,
  `mínimo ${gridCheck.minDist.toFixed(2)} m entre karts`,
);
check(
  'Cada kart tiene su nombre',
  gridCheck.unique === gridCheck.names.length,
  gridCheck.names.join(', '),
);

// --- Los karts no pueden ocupar el mismo lugar -----------------------------
const collisions = await page.evaluate(() => {
  const g = window.__kart;
  g.director.phase = 'racing';
  const [a, b] = g.racers;

  // Los apilamos exactamente en el mismo punto: el caso más duro, porque no hay
  // dirección de separación definida.
  b.physics.position.copy(a.physics.position);
  a.physics.velocity.set(0, 0, 0);
  b.physics.velocity.set(0, 0, 0);
  window.__sim(0.5);
  const separated = a.physics.position.distanceTo(b.physics.position);

  // Ahora un alcance por detrás: el de atrás llega más rápido y tiene que
  // empujar al de adelante, no atravesarlo.
  const fwd = a.physics.forward.clone();
  b.physics.position.copy(a.physics.position).addScaledVector(fwd, 3.4);
  b.physics.velocity.set(0, 0, 0);
  b.physics.yaw = a.physics.yaw;
  a.physics.velocity.copy(fwd).multiplyScalar(22);
  const targetBefore = b.physics.velocity.length();
  let minGap = Infinity;
  for (let i = 0; i < 120 * 1.2; i++) {
    window.__sim(1 / 120);
    minGap = Math.min(minGap, a.physics.position.distanceTo(b.physics.position));
  }
  return {
    separated,
    minGap,
    targetBefore,
    targetAfter: b.physics.velocity.length(),
  };
});
check(
  'Dos karts en el mismo punto se separan',
  collisions.separated > 2,
  `quedan a ${collisions.separated.toFixed(2)} m`,
);
check(
  'Un kart no atraviesa a otro',
  collisions.minGap > 2,
  `acercamiento mínimo ${collisions.minGap.toFixed(2)} m`,
);
check(
  'El que choca por detrás empuja al de adelante',
  collisions.targetAfter > collisions.targetBefore + 2,
  `el de adelante pasa de ${collisions.targetBefore.toFixed(1)} a ${collisions.targetAfter.toFixed(1)} m/s`,
);

// --- Los rivales corren de verdad ------------------------------------------
await page.evaluate(() => window.__auto(6));
const aiMoved = await page.evaluate(() => {
  const g = window.__kart;
  const before = g.racers.map((r) => r.laps.totalProgress);
  window.__auto(8);
  const after = g.racers.map((r) => r.laps.totalProgress);
  return {
    advanced: after.map((v, i) => v - before[i]),
    offTrack: g.racers.filter((r) => r.telemetry.offTrack).length,
  };
});
check(
  'Todos los rivales avanzan por la pista',
  aiMoved.advanced.every((d) => d > 60),
  aiMoved.advanced.map((d) => `${Math.round(d)} m`).join(' · '),
);
check(
  'Los rivales se mantienen en pista',
  aiMoved.offTrack <= 1,
  `${aiMoved.offTrack} de 4 fuera en ese instante`,
);

// --- Posiciones -------------------------------------------------------------
const standings = await page.evaluate(() => {
  const g = window.__kart;
  g.director.updateStandings();
  const byProgress = [...g.racers].sort((a, b) => b.laps.totalProgress - a.laps.totalProgress);
  return {
    positions: g.racers.map((r) => r.position).sort((a, b) => a - b),
    leaderIsFirst: byProgress[0].position === 1,
  };
});
check(
  'Las posiciones son 1..N sin repetir',
  standings.positions.join(',') === [1, 2, 3, 4].join(','),
  standings.positions.join(', '),
);
check('El que más avanzó va primero', standings.leaderIsFirst);

// --- Poderes ---------------------------------------------------------------
const items = await page.evaluate(() => {
  const g = window.__kart;
  const player = g.player;
  const victim = g.racers.find((r) => !r.isPlayer);
  const out = {};

  // Banana: se deja atrás y hace trompear al que la pisa.
  player.item = 'banana';
  g.items.use(player, g.racers);
  out.hazardAfterBanana = g.items.group.children.length;
  // Ponemos a la víctima encima de la banana.
  const banana = g.items.group.children[g.items.group.children.length - 1];
  victim.physics.position.copy(banana.position);
  window.__sim(0.05);
  out.victimSpinning = victim.telemetry.spinning;

  // Rayo: velocidad e inmunidad.
  player.item = 'rayo';
  g.items.use(player, g.racers);
  window.__sim(0.05);
  out.playerImmune = player.telemetry.immune;
  out.playerBoosting = player.telemetry.boostTime;
  // Estando inmune, un golpe no debe afectarlo.
  out.hitWhileImmune = player.physics.applyHit();

  return out;
});
check('La banana queda en la pista', items.hazardAfterBanana > 0);
check('Pisar la banana hace trompear', items.victimSpinning);
check('El rayo da velocidad', items.playerBoosting);
check('El rayo da inmunidad', items.playerImmune);
check('Con el rayo, ningún poder lo afecta', items.hitWhileImmune === false);

const missile = await page.evaluate(() => {
  const g = window.__kart;
  const player = g.player;

  // El misil apunta al que va adelante en la CLASIFICACIÓN, no al que está más
  // cerca. Así que armamos la clasificación a mano: colocamos a cada kart en un
  // punto conocido del trazado y dejamos a uno solo por delante del jugador.
  const placeAt = (racer, t, lateral = 0) => {
    const s = g.path.sampleAtT(t);
    racer.physics.position.copy(s.position).addScaledVector(s.right, lateral);
    racer.physics.position.addScaledVector(s.up, 0.05);
    racer.physics.yaw = Math.atan2(s.tangent.x, s.tangent.z);
    racer.physics.velocity.set(0, 0, 0);
    racer.physics.immuneTime = 0;
    racer.physics.spinTime = 0;
    racer.physics.boostTime = 0;
  };

  const rivals = g.racers.filter((r) => !r.isPlayer);
  placeAt(player, 0.3);
  placeAt(rivals[0], 0.33); // el único adelante: debería ser el objetivo
  rivals.slice(1).forEach((r, i) => placeAt(r, 0.1 - i * 0.03));

  window.__sim(1 / 60);
  g.director.updateStandings();
  const target = rivals[0];

  player.item = 'misil';
  g.items.use(player, g.racers);
  for (let i = 0; i < 120 * 4; i++) {
    window.__sim(1 / 120);
    if (target.telemetry.spinning) {
      return { hit: true, seconds: i / 120, targetPos: target.position, playerPos: player.position };
    }
  }
  return { hit: false, targetPos: target.position, playerPos: player.position };
});
check(
  'El misil alcanza al kart de adelante',
  missile.hit,
  missile.hit
    ? `en ${missile.seconds.toFixed(2)} s (objetivo ${missile.targetPos}º, jugador ${missile.playerPos}º)`
    : `no lo alcanzó (objetivo ${missile.targetPos}º, jugador ${missile.playerPos}º)`,
);

// El misil tiene que SEGUIR EL RECORRIDO, no cortar camino en línea recta: con
// el objetivo del otro lado de una curva, apuntarle derecho lo mandaba contra el
// muro exterior. Medimos cuánto se aparta del asfalto durante todo el vuelo.
const missilePath = await page.evaluate(() => {
  const g = window.__kart;
  const player = g.player;
  const rivals = g.racers.filter((r) => !r.isPlayer);

  // Buscamos el tramo más cerrado del circuito y largamos justo antes.
  let tightest = 0;
  for (let i = 0; i < g.path.samples.length; i++) {
    if (Math.abs(g.path.samples[i].curvature) > Math.abs(g.path.samples[tightest].curvature)) {
      tightest = i;
    }
  }
  const startT = (tightest / g.path.samples.length + 0.97) % 1;

  const placeAt = (racer, t) => {
    const s = g.path.sampleAtT(t);
    racer.physics.position.copy(s.position).addScaledVector(s.up, 0.05);
    racer.physics.yaw = Math.atan2(s.tangent.x, s.tangent.z);
    racer.physics.velocity.set(0, 0, 0);
    racer.physics.immuneTime = 0;
    racer.physics.spinTime = 0;
    racer.physics.boostTime = 0;
  };

  placeAt(player, startT);
  placeAt(rivals[0], (startT + 0.06) % 1);
  rivals.slice(1).forEach((r, i) => placeAt(r, (startT - 0.2 - i * 0.03 + 1) % 1));
  // El jugador queda quieto: acá se mide el vuelo del misil, no su manejo.
  g.input.setOverride({ throttle: 0, brake: 0, steer: 0, drift: false });
  window.__sim(1 / 60);
  g.director.updateStandings();

  const target = rivals[0];
  player.item = 'misil';
  g.items.use(player, g.racers);

  let worstOutside = 0;
  let hit = false;
  const frozen = target.physics.position.clone();
  for (let i = 0; i < 120 * 5; i++) {
    // El objetivo queda clavado sobre la línea central: lo que se mide es el
    // vuelo del misil, no si la IA se fue al pasto persiguiendo su trazada.
    target.physics.position.copy(frozen);
    target.physics.velocity.set(0, 0, 0);
    window.__sim(1 / 120);
    for (const s of g.items.hazardStates) {
      if (s.kind !== 'misil') continue;
      const proj = g.path.project(s.position);
      worstOutside = Math.max(worstOutside, Math.abs(proj.lateral) - proj.halfWidth);
    }
    if (target.telemetry.spinning) {
      hit = true;
      break;
    }
  }
  return { hit, worstOutside, explosions: g.items.explosions.activeCount };
});
check(
  'El misil sigue el trazado en vez de cortar camino',
  missilePath.hit && missilePath.worstOutside < 8,
  `${missilePath.hit ? 'acertó' : 'no acertó'}, se apartó ${missilePath.worstOutside.toFixed(1)} m del asfalto`,
);
check(
  'El impacto del misil hace una explosión',
  missilePath.explosions > 0,
  `${missilePath.explosions} explosiones vivas`,
);

const fireball = await page.evaluate(() => {
  const g = window.__kart;
  const player = g.player;
  const target = g.racers.find((r) => !r.isPlayer);
  // La bola de fuego va derecho, así que hay que medirla en una recta: en una
  // horquilla, 22 m "hacia adelante" caen fuera de la pista y el ensayo dejaría
  // de probar el poder para probar dónde quedó cada kart.
  let straightest = 0;
  for (let i = 0; i < g.path.samples.length; i++) {
    if (Math.abs(g.path.samples[i].curvature) < Math.abs(g.path.samples[straightest].curvature)) {
      straightest = i;
    }
  }
  const s = g.path.sampleAt(straightest);
  g.input.setOverride({ throttle: 0, brake: 0, steer: 0, drift: false });
  player.physics.position.copy(s.position).addScaledVector(s.up, 0.05);
  player.physics.yaw = Math.atan2(s.tangent.x, s.tangent.z);
  player.physics.velocity.set(0, 0, 0);
  window.__sim(1 / 60);

  // Justo enfrente y en línea recta.
  const spot = player.physics.position
    .clone()
    .addScaledVector(player.physics.forward, 22);
  target.physics.immuneTime = 0;
  target.physics.spinTime = 0;
  player.physics.velocity.set(0, 0, 0);

  player.item = 'fuego';
  g.items.use(player, g.racers);
  for (let i = 0; i < 120 * 2; i++) {
    // El blanco queda quieto: acá se prueba la bola de fuego, no la esquiva.
    target.physics.position.copy(spot);
    target.physics.velocity.set(0, 0, 0);
    window.__sim(1 / 120);
    if (target.telemetry.spinning) return { hit: true, seconds: i / 120 };
  }
  return { hit: false };
});
check(
  'La bola de fuego golpea derecho adelante',
  fireball.hit,
  fireball.hit ? `en ${fireball.seconds.toFixed(2)} s` : 'no acertó',
);

// --- Dificultad ------------------------------------------------------------
const pace = {};
for (const dif of ['facil', 'dificil']) {
  await open(`c=bloques&mode=carrera&racers=4&dif=${dif}&laps=2`);
  pace[dif] = await page.evaluate(() => {
    const g = window.__kart;
    // 40 s: los primeros segundos son cuenta regresiva y aceleración, donde
    // todas las dificultades van parecido. La diferencia se abre después.
    // Sólo corren los rivales; el jugador queda quieto para no influir.
    for (let i = 0; i < 120 * 40; i++) g.step(1 / 120);
    const rivals = g.racers.filter((r) => !r.isPlayer);
    return rivals.reduce((sum, r) => sum + r.laps.totalProgress, 0) / rivals.length;
  });
}
check(
  'Los rivales difíciles corren más que los fáciles',
  pace.dificil > pace.facil * 1.1,
  `fácil ${Math.round(pace.facil)} m · difícil ${Math.round(pace.dificil)} m en 40 s`,
);

// --- Terminar una carrera ---------------------------------------------------
await open('c=rosa&mode=carrera&racers=4&dif=facil&laps=2');
const finish = await page.evaluate(() => {
  const g = window.__kart;
  for (let i = 0; i < 120 * 300; i++) {
    window.__auto(1 / 120);
    if (g.director.phase === 'finished') {
      return {
        finished: true,
        seconds: i / 120,
        results: g.director.results().map((r) => ({ p: r.position, name: r.name, me: r.isPlayer })),
      };
    }
  }
  return { finished: false, lap: g.player.laps.lap };
});
check(
  'Se puede terminar una carrera de 2 vueltas',
  finish.finished,
  finish.finished
    ? `${finish.seconds.toFixed(0)} s simulados, puesto ${finish.results.find((r) => r.me).p}`
    : `quedó en la vuelta ${finish.lap}`,
);
if (finish.finished) {
  check(
    'La clasificación final lista a todos una vez',
    finish.results.length === 4 &&
      new Set(finish.results.map((r) => r.p)).size === 4,
    finish.results.map((r) => `${r.p}. ${r.name}`).join(' · '),
  );
}

// ===========================================================================
// Parte 3 — las cuatro pistas
// ===========================================================================
for (const id of CHARACTERS) {
  await open(`c=${id}&mode=contrarreloj&laps=3`);
  const info = await read();

  check(
    `[${id}] el personaje carga su pista`,
    info.character === id && info.trackLength > 500,
    `${info.trackName} (${info.theme}), ${Math.round(info.trackLength)} m, kart #${info.number}`,
  );

  const lap = await auto(240);
  const lapInfo = await read();
  check(
    `[${id}] se puede completar una vuelta`,
    lap.finished,
    lap.finished
      ? `${lapInfo.bestLap.toFixed(1)} s simulados`
      : `sólo ${Math.round(lapInfo.progress)} m de ${Math.round(lapInfo.trackLength)}`,
  );
  if (lap.finished) {
    check(
      `[${id}] el trazado se recorre sin salirse`,
      lap.offTrackRatio < 0.2,
      `${(lap.offTrackRatio * 100).toFixed(1)} % fuera de pista`,
    );
  }

  const probe = await page.evaluate(() => {
    const g = window.__kart;
    // Desde la línea de largada y a marcha corta: la medición tiene que ser
    // siempre desde el mismo lugar, o una falla puede significar tanto "no se
    // dibuja el asfalto" como "el kart terminó en el pasto".
    const start = g.path.startTransform(0);
    const p = g.player.physics;
    p.position.copy(start.position);
    p.yaw = start.yaw;
    p.velocity.set(0, 0, 0);
    g.player.laps.lap = 1;
    window.__auto(2.2, { throttle: 0.35 });
    const result = window.__probeRoad();
    result.offTrack = g.player.telemetry.offTrack;
    window.__clearMessage();
    return result;
  });
  check(
    `[${id}] el asfalto se dibuja bajo el kart`,
    probe.delta > 25 && !probe.offTrack,
    probe.offTrack
      ? 'el kart no estaba sobre el asfalto al medir'
      : `rgb(${probe.sample.join(', ')}) con pista vs rgb(${probe.withoutRoad.join(', ')}) sin ella`,
  );
  await page.screenshot({ path: `test/pista-${id}.png` });

  // El minimapa tiene que dibujar el circuito y marcar al jugador encima.
  const map = await page.evaluate(() => {
    const g = window.__kart;
    g.hud.update(1 / 60, g.player, g.director, g.racers.length, g.racers, g.items);
    const canvas = document.getElementById('hud-map');
    const ctx = canvas.getContext('2d');
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let painted = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 20) painted++;

    // El puntito del jugador tiene que caer sobre el trazado dibujado.
    const dpr = canvas.width / parseFloat(canvas.style.width);
    const p = g.hud.minimap.project(g.player);
    const px = Math.round(p.x * dpr);
    const py = Math.round(p.y * dpr);
    const at = ctx.getImageData(px - 2, py - 2, 5, 5).data;
    let solid = 0;
    for (let i = 3; i < at.length; i += 4) if (at[i] > 60) solid++;

    return {
      ratio: painted / (canvas.width * canvas.height),
      inside: px > 0 && py > 0 && px < canvas.width && py < canvas.height,
      solid,
    };
  });
  check(
    `[${id}] el minimapa dibuja el circuito y al jugador`,
    map.ratio > 0.04 && map.ratio < 0.6 && map.inside && map.solid > 10,
    `${(map.ratio * 100).toFixed(1)} % del mapa pintado, ${map.solid}/25 píxeles bajo el jugador`,
  );

  // Los elementos animados del escenario tienen que existir y moverse.
  const animated = await page.evaluate(() => {
    const g = window.__kart;
    const props = g.animations.group.children;
    const before = props.map((p) => JSON.stringify(dump(p)));
    g.animations.update(0.6);
    const after = props.map((p) => JSON.stringify(dump(p)));
    let moved = 0;
    for (let i = 0; i < props.length; i++) if (before[i] !== after[i]) moved++;
    return { count: props.length, moved };

    /** Posición y rotación de un objeto y de todos sus hijos. */
    function dump(obj) {
      return [
        obj.position.toArray().map((v) => +v.toFixed(4)),
        obj.rotation.toArray().slice(0, 3).map((v) => +v.toFixed(4)),
        obj.scale.toArray().map((v) => +v.toFixed(4)),
        obj.children.map(dump),
      ];
    }
  });
  check(
    `[${id}] el escenario tiene elementos animados`,
    animated.count >= 8 && animated.moved === animated.count,
    `${animated.moved} de ${animated.count} se mueven`,
  );

  const portrait = await page.evaluate(() => window.__portrait());
  check(
    `[${id}] el kart y el piloto se dibujan de frente`,
    portrait > 0.25,
    `${(portrait * 100).toFixed(0)} % del cuadro central lo ocupa el kart`,
  );
  await page.screenshot({ path: `test/kart-${id}.png` });
  await page.evaluate(() => window.__restorePortrait());
}

// ===========================================================================
// Parte 4 — controles: esquema de teclado, opciones en carrera y táctil
// ===========================================================================
await open('c=futbol&mode=contrarreloj&laps=3');

const keyboard = await page.evaluate(async () => {
  const g = window.__kart;
  g.director.phase = 'racing';
  g.input.setOverride(null);

  const press = (code, type) =>
    window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true }));

  const measure = (code) => {
    g.player.physics.respawn();
    press(code, 'keydown');
    for (let i = 0; i < 120; i++) g.step(1 / 120);
    press(code, 'keyup');
    const speed = g.player.telemetry.speedKmh;
    for (let i = 0; i < 6; i++) g.step(1 / 120);
    return speed;
  };

  g.input.setLayout('flechas');
  const flechas = { arriba: measure('ArrowUp'), w: measure('KeyW') };
  g.input.setLayout('wasd');
  const wasd = { arriba: measure('ArrowUp'), w: measure('KeyW') };
  g.input.setLayout('flechas');

  return { flechas, wasd, layouts: Object.keys(g.__layouts ?? {}) };
});
check(
  'Con el esquema de flechas acelera la flecha y no la W',
  keyboard.flechas.arriba > 40 && keyboard.flechas.w < 5,
  `↑ ${keyboard.flechas.arriba.toFixed(0)} km/h · W ${keyboard.flechas.w.toFixed(0)} km/h`,
);
check(
  'Con el esquema WASD acelera la W y no la flecha',
  keyboard.wasd.w > 40 && keyboard.wasd.arriba < 5,
  `W ${keyboard.wasd.w.toFixed(0)} km/h · ↑ ${keyboard.wasd.arriba.toFixed(0)} km/h`,
);

const touch = await page.evaluate(() => {
  const g = window.__kart;
  g.director.phase = 'racing';
  g.input.setOverride(null);

  // Encendemos los botones en pantalla como lo hace la opción "Siempre".
  const controls = document.getElementById('touch-controls');
  const present = Boolean(controls);
  controls?.classList.remove('hidden');

  const state = { throttle: 0, brake: 0, steer: 0, drift: false, use: false };
  g.input.setTouchSource(state);

  g.player.physics.respawn();
  state.throttle = 1;
  for (let i = 0; i < 120; i++) g.step(1 / 120);
  const accelerated = g.player.telemetry.speedKmh;

  const yawBefore = g.player.physics.yaw;
  state.steer = 1;
  for (let i = 0; i < 60; i++) g.step(1 / 120);
  const turned = g.player.physics.yaw - yawBefore;

  g.input.setTouchSource(null);
  controls?.classList.add('hidden');

  return {
    present,
    buttons: controls ? controls.querySelectorAll('button').length : 0,
    accelerated,
    turned,
  };
});
check(
  'Hay botones táctiles para manejar desde la pantalla',
  touch.present && touch.buttons === 6,
  `${touch.buttons} botones`,
);
check(
  'El botón de acelerar del táctil mueve el kart',
  touch.accelerated > 40,
  `${touch.accelerated.toFixed(0)} km/h en un segundo`,
);
check(
  'El botón de doblar del táctil cambia el rumbo',
  touch.turned < -0.15,
  `Δyaw ${touch.turned.toFixed(2)} rad`,
);

const esc = () =>
  page.evaluate(() =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'Escape', bubbles: true, cancelable: true }),
    ),
  );

await page.evaluate(() => window.__kart.start());
await esc();
const pause = await page.evaluate(() => {
  const panel = document.getElementById('options');
  return {
    visible: panel ? !panel.classList.contains('hidden') : false,
    chips: panel ? panel.querySelectorAll('.chip').length : 0,
    running: window.__kart.isRunning,
    layoutChip: panel?.querySelector('.chip.selected')?.textContent ?? '',
  };
});
check(
  'Esc abre las opciones en plena carrera',
  pause.visible && pause.chips >= 7,
  `${pause.chips} opciones (4 teclados + 3 de táctil), teclado "${pause.layoutChip}"`,
);
check('Las opciones pausan la carrera', pause.running === false);
await page.screenshot({ path: 'test/opciones.png' });

// Cambiar el teclado desde las opciones tiene que aplicarse al instante.
const liveSwap = await page.evaluate(() => {
  const chips = [...document.querySelectorAll('#options .chip')];
  const wasd = chips.find((c) => c.textContent === 'WASD');
  wasd?.click();
  return window.__kart.input.layoutId;
});
check(
  'Cambiar el teclado en las opciones se aplica en el acto',
  liveSwap === 'wasd',
  `esquema activo: ${liveSwap}`,
);

await esc();
const resumed = await page.evaluate(() => {
  const running = window.__kart.isRunning;
  window.__kart.stop();
  window.__kart.input.setLayout('flechas');
  return running;
});
check('Cerrar las opciones reanuda la carrera', resumed === true);

// ===========================================================================
// Parte 5 — presentación, fotos reales y figuras del menú
// ===========================================================================
await page.goto(`http://localhost:${PORT}/`);
await page.waitForSelector('#intro.showing', { timeout: 30000 });

const intro = await page.evaluate(() => {
  const root = document.getElementById('intro');
  const cast = [...root.querySelectorAll('.cast-member')];
  const fleet = [...root.querySelectorAll('.intro-fleet img')];
  return {
    title: root.querySelector('.intro-title h1')?.textContent?.replace(/\s+/g, ' ').trim(),
    racers: cast.length,
    names: cast.map((r) => r.querySelector('figcaption')?.textContent),
    // Cada corredor entra con su propio retardo: es lo que hace que se lea como
    // un reparto llegando y no como seis imágenes apareciendo juntas.
    delays: cast.map((r) => r.style.animationDelay),
    portraits: cast.filter((r) =>
      r.querySelector('.cast-portrait')?.src.startsWith('data:image/webp')).length,
    // La cuña: la distancia al centro de cada uno gobierna su tamaño y su
    // profundidad. Sin eso son seis retratos en fila, que es un catálogo.
    depths: cast.map((r) => Number(r.style.getPropertyValue('--depth'))),
    fleet: fleet.length,
    // El navegador devuelve la url entrecomillada: `url("data:...")`.
    backdrop: /^url\(["']?data:image\/webp/.test(root.style.backgroundImage),
    credit: root.querySelector('.intro-credit span')?.textContent ?? '',
    creditMark: root.querySelector('.intro-credit img')?.src.startsWith('data:image/webp') ?? false,
  };
});
check(
  'La portada lleva la firma del autor',
  /creado por/i.test(intro.credit) && intro.creditMark,
  intro.creditMark ? intro.credit : 'falta el logo',
);
check('La presentación se llama Family Kart', intro.title === 'FAMILY KART', intro.title);
check(
  'La presentación muestra a los seis con su foto real',
  intro.racers === 6 && intro.portraits === 6,
  `${intro.racers} en el reparto, ${intro.portraits} con retrato: ${intro.names.join(', ')}`,
);
check(
  'El reparto va en cuña, no en fila pareja',
  Math.min(...intro.depths) === 0 && Math.max(...intro.depths) === 1
    && intro.depths.join() === [...intro.depths].reverse().join()
    && intro.depths[0] > intro.depths[1] && intro.depths[1] > intro.depths[2],
  `profundidades ${intro.depths.join(' · ')}`,
);
check(
  'La presentación muestra los seis vehículos',
  intro.fleet === 6,
  `${intro.fleet} vehículos en el friso`,
);
check(
  'Los corredores entran escalonados',
  new Set(intro.delays).size === 6,
  intro.delays.join(' · '),
);
check('La presentación tiene el fondo renderizado', intro.backdrop);

// Las imágenes tienen que estar realmente pintadas, no ser imágenes rotas.
const figuresPainted = await page.evaluate(async () => {
  const imgs = [...document.querySelectorAll('.cast-portrait, .intro-fleet img')];
  await Promise.all(
    imgs.map((img) => (img.complete ? null : new Promise((r) => (img.onload = r)))),
  );
  return imgs.filter((img) => img.naturalWidth > 200 && img.naturalHeight > 200).length;
});
check(
  'Las imágenes de la presentación se cargan',
  figuresPainted === 12,
  `${figuresPainted} de 12 decodificadas`,
);

await page.click('#intro-start');
await page.waitForTimeout(700);
const afterIntro = await page.evaluate(() => ({
  gone: document.getElementById('intro') === null,
  menuVisible: !document.getElementById('menu').classList.contains('hidden'),
  lineup: document.querySelectorAll('.menu-lineup img').length,
}));
check('La presentación se cierra y deja el menú', afterIntro.gone && afterIntro.menuVisible);
check(
  'Las figuras quedan en el menú',
  afterIntro.lineup === 6,
  `${afterIntro.lineup} vehículos en la parrilla del menú`,
);
await page.screenshot({ path: 'test/menu-modo.png' });

// Las tarjetas de piloto llevan la foto real y el render del vehículo.
await page.click('#menu-next');
await page.waitForTimeout(400);
const cards = await page.evaluate(() => {
  const list = [...document.querySelectorAll('.char-card')];
  return {
    total: list.length,
    photos: list.filter((c) => c.querySelector('.char-avatar')?.src.startsWith('data:image/webp')).length,
    figures: list.filter((c) => c.querySelector('.char-figure')?.src.startsWith('data:image/webp')).length,
  };
});
check(
  'Cada piloto se elige con su foto real',
  cards.total === 6 && cards.photos === 6,
  `${cards.photos} de ${cards.total} tarjetas con foto`,
);
check(
  'Cada tarjeta muestra su vehículo',
  cards.figures === 6,
  `${cards.figures} de ${cards.total} tarjetas con render`,
);
await page.screenshot({ path: 'test/menu-piloto.png' });

// Y en pista, la cara del kart tiene que ser la foto, no el dibujo.
await open('c=puerto&mode=contrarreloj&laps=3');
const raceFace = await page.evaluate(() => {
  const face = window.__kart.player.view.group.getObjectByName('driver-face');
  const map = face?.material?.map;
  const src = map?.image?.src ?? '';
  return { hasPhoto: src.startsWith('data:image/webp'), width: map?.image?.naturalWidth ?? 0 };
});
check(
  'En pista el piloto lleva su foto real',
  raceFace.hasPhoto && raceFace.width >= 512,
  raceFace.hasPhoto ? `textura de ${raceFace.width} px` : 'sigue con la cara dibujada',
);

// --- Identidad de la aplicación -------------------------------------------
// El ícono y la vista previa del link no se ven jugando, así que no hay forma de
// notar que se rompieron: un `href` mal escrito deja la pestaña con el ícono
// genérico y el link compartido sin imagen, y nadie se entera hasta que alguien
// manda una invitación y del otro lado llega un rectángulo gris.

const head = await page.evaluate(async () => {
  const get = (sel, attr) => document.querySelector(sel)?.getAttribute(attr) ?? '';
  const reachable = async (url) => {
    try {
      const res = await fetch(new URL(url, location.href));
      return res.ok;
    } catch {
      return false;
    }
  };
  const icon = get('link[rel="icon"][sizes="any"]', 'href');
  const apple = get('link[rel="apple-touch-icon"]', 'href');
  const manifestUrl = get('link[rel="manifest"]', 'href');
  let manifest = null;
  try {
    manifest = await (await fetch(new URL(manifestUrl, location.href))).json();
  } catch {
    /* lo reporta el check */
  }
  return {
    icon: await reachable(icon),
    apple: await reachable(apple),
    manifest,
    icons: manifest?.icons?.length ?? 0,
    ogImage: get('meta[property="og:image"]', 'content'),
    ogTitle: get('meta[property="og:title"]', 'content'),
    card: get('meta[name="twitter:card"]', 'content'),
  };
});

check(
  'La pestaña y el acceso directo tienen su ícono',
  head.icon && head.apple,
  head.icon && head.apple ? 'favicon y apple-touch-icon' : 'falta alguno de los dos',
);
check(
  'El manifiesto deja instalar el juego',
  head.manifest?.name === 'Family Kart' && head.icons >= 2,
  `${head.icons} tamaños, display ${head.manifest?.display ?? '—'}`,
);
check(
  'El link compartido lleva imagen y título',
  /^https:\/\/.+\/invitacion\.jpg$/.test(head.ogImage) &&
    head.ogTitle.includes('Family Kart') &&
    head.card === 'summary_large_image',
  head.ogImage,
);

// --- Invitar por WhatsApp --------------------------------------------------
await page.goto(`http://localhost:${PORT}/?sala=prueba9&local=1`);
await page.waitForSelector('#lobby:not(.hidden)', { timeout: 30000 });
const share = await page.evaluate(() => {
  const btn = document.querySelector('.whatsapp-btn');
  return {
    label: btn?.textContent?.trim() ?? '',
    link: document.querySelector('.lobby-link input')?.value ?? '',
    copy: Boolean(document.querySelector('.copy-btn')),
  };
});
check(
  'La sala ofrece invitar por WhatsApp',
  /whatsapp/i.test(share.label) && share.copy,
  share.label,
);
check(
  'El link de la sala lleva el código',
  share.link.includes('sala=prueba9'),
  share.link,
);

// El mensaje se arma en el módulo, así que se verifica ahí y no abriendo
// WhatsApp: abrirlo saldría a internet y dependería de una sesión iniciada.
const invite = await page.evaluate(() => {
  const url = new URL(window.__inviteFor('prueba9'));
  const text = url.searchParams.get('text') ?? '';
  return { host: url.host, text, last: text.trim().split('\n').pop() };
});
check(
  'El mensaje de invitación termina en el link',
  invite.host === 'wa.me' &&
    /family kart/i.test(invite.text) &&
    invite.last.includes('sala=prueba9'),
  invite.last,
);

// --- Sin errores de runtime -----------------------------------------------
check('Sin errores en consola', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
server.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} verificaciones pasaron`);
process.exit(failed.length === 0 ? 0 : 1);
