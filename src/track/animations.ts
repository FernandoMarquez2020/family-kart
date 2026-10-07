import * as THREE from 'three';
import type { TrackPath } from './TrackPath';
import { makeRng, shoulderLift } from './TrackSpec';
import type { SceneryKind, ThemePalette } from './themes';
import { makeBallTexture } from './textures';

/**
 * Elementos animados del escenario, repartidos al azar por el circuito.
 *
 * Son pocos y cada uno se mueve distinto, así que van como mallas sueltas con
 * su propia función de animación —no como InstancedMesh, que sirve para cientos
 * de copias quietas pero no para esto—. La semilla del circuito decide qué
 * aparece y dónde, de modo que cada pista tiene siempre la misma escenografía.
 */

interface AnimatedProp {
  object: THREE.Object3D;
  /** `time` es el reloj acumulado de la escena, en segundos. */
  update(time: number): void;
}

/** Fábrica de un elemento animado, ya colocado en el origen y mirando a +Z. */
type PropFactory = (palette: ThemePalette, rng: () => number) => AnimatedProp;

const lambert = (color: number, flat = true) =>
  new THREE.MeshLambertMaterial({ color, flatShading: flat });
const glow = (color: number) => new THREE.MeshBasicMaterial({ color });

function pick(colors: number[], rng: () => number): number {
  return colors[Math.floor(rng() * colors.length)];
}

// --- Estadio ---------------------------------------------------------------

/** Pelota gigante que pica contra el piso. */
const bouncingBall: PropFactory = (_palette, rng) => {
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(1.7, 16, 14),
    new THREE.MeshLambertMaterial({ map: makeBallTexture() }),
  );
  ball.castShadow = true;
  const group = new THREE.Group();
  group.add(ball);
  const phase = rng() * Math.PI * 2;
  const speed = 1.6 + rng() * 0.8;

  return {
    object: group,
    update(time) {
      // Valor absoluto de un seno: sube redondeado y frena seco contra el piso,
      // que es como pica una pelota.
      const t = Math.abs(Math.sin(time * speed + phase));
      ball.position.y = 1.7 + t * 5.5;
      // Se achata un poco al tocar el piso.
      const squash = 1 - (1 - t) * 0.25;
      ball.scale.set(1 / squash, squash, 1 / squash);
      ball.rotation.x += 0.01;
    },
  };
};

/** Bandera que ondea en su mástil. */
const wavingFlag: PropFactory = (palette, rng) => {
  const group = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 7, 6), lambert(0x9aa2ae));
  pole.position.y = 3.5;
  group.add(pole);

  // La bandera son varios paños: desfasando su balanceo se lee como una onda
  // recorriéndola, sin necesidad de deformar vértices.
  const color = pick([...palette.sceneryColors], rng);
  const panels: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.44, 1.3, 0.06), lambert(color, false));
    panel.position.set(0.32 + i * 0.44, 6, 0);
    group.add(panel);
    panels.push(panel);
  }
  const phase = rng() * Math.PI * 2;

  return {
    object: group,
    update(time) {
      panels.forEach((panel, i) => {
        const wave = Math.sin(time * 4 - i * 0.9 + phase);
        panel.position.z = wave * 0.16 * (i + 1) * 0.5;
        panel.rotation.y = wave * 0.22;
      });
    },
  };
};

// --- Neón ------------------------------------------------------------------

/** Cubo de píxeles flotando y girando. */
const floatingCube: PropFactory = (palette, rng) => {
  const cube = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 2.4), glow(pick([...palette.sceneryColors], rng)));
  const group = new THREE.Group();
  group.add(cube);
  const phase = rng() * Math.PI * 2;
  const base = 4 + rng() * 4;

  return {
    object: group,
    update(time) {
      cube.position.y = base + Math.sin(time * 1.3 + phase) * 1.6;
      cube.rotation.set(time * 0.5 + phase, time * 0.8, 0);
    },
  };
};

/** Anillo de luz que gira y late. */
const pulsingRing: PropFactory = (palette, rng) => {
  const color = pick([...palette.sceneryColors], rng);
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.28, 8, 28), material);
  ring.position.y = 5;
  const group = new THREE.Group();
  group.add(ring);
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 5, 0.3), lambert(0x171b28));
  post.position.y = 2.5;
  group.add(post);
  const phase = rng() * Math.PI * 2;

  return {
    object: group,
    update(time) {
      ring.rotation.z = time * 0.9 + phase;
      const pulse = 0.55 + Math.abs(Math.sin(time * 2.2 + phase)) * 0.45;
      material.opacity = pulse;
      ring.scale.setScalar(0.9 + pulse * 0.18);
    },
  };
};

// --- Bloques ---------------------------------------------------------------

/** Torre de cubos que saltan uno tras otro. */
const hoppingBlocks: PropFactory = (palette, rng) => {
  const group = new THREE.Group();
  const cubes: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 2),
      lambert(pick([...palette.sceneryColors], rng)),
    );
    cube.position.set((i - 1.5) * 2.6, 1, 0);
    cube.castShadow = true;
    group.add(cube);
    cubes.push(cube);
  }
  const phase = rng() * Math.PI * 2;

  return {
    object: group,
    update(time) {
      cubes.forEach((cube, i) => {
        const t = Math.sin(time * 2.4 - i * 0.7 + phase);
        cube.position.y = 1 + Math.max(0, t) * 2.2;
        cube.rotation.y = Math.max(0, t) * 0.6;
      });
    },
  };
};

/** Molino de bloques que gira. */
const blockWindmill: PropFactory = (palette, rng) => {
  const group = new THREE.Group();
  const mast = new THREE.Mesh(new THREE.BoxGeometry(1.4, 11, 1.4), lambert(0xe8e2d0));
  mast.position.y = 5.5;
  mast.castShadow = true;
  group.add(mast);

  const blades = new THREE.Group();
  blades.position.set(0, 10.5, 1);
  const color = pick([...palette.sceneryColors], rng);
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(1.1, 5, 0.4), lambert(color));
    blade.position.y = 2.5;
    const arm = new THREE.Group();
    arm.rotation.z = (i / 4) * Math.PI * 2;
    arm.add(blade);
    blades.add(arm);
  }
  group.add(blades);
  const speed = 0.8 + rng() * 0.7;

  return {
    object: group,
    update(time) {
      blades.rotation.z = time * speed;
    },
  };
};

// --- Mundo rosa ------------------------------------------------------------

/** Globo atado que sube, baja y se mece. */
const bobbingBalloon: PropFactory = (palette, rng) => {
  const group = new THREE.Group();
  const string = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 6, 5), lambert(0xfff4fa, false));
  string.position.y = 3;
  group.add(string);

  const balloon = new THREE.Mesh(
    new THREE.SphereGeometry(1.3, 14, 12),
    lambert(pick([...palette.sceneryColors], rng), false),
  );
  balloon.scale.y = 1.2;
  balloon.position.y = 7;
  balloon.castShadow = true;
  group.add(balloon);
  const phase = rng() * Math.PI * 2;

  return {
    object: group,
    update(time) {
      const bob = Math.sin(time * 1.1 + phase);
      balloon.position.y = 7 + bob * 1.1;
      group.rotation.z = Math.sin(time * 0.7 + phase) * 0.12;
    },
  };
};

/** Flor gigante que se mece y abre los pétalos. */
const swayingFlower: PropFactory = (palette, rng) => {
  const group = new THREE.Group();
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 4.5, 8), lambert(0x62c46a));
  stem.position.y = 2.25;
  group.add(stem);

  const head = new THREE.Group();
  head.position.y = 4.6;
  const color = pick([...palette.sceneryColors], rng);
  const petals: THREE.Mesh[] = [];
  for (let i = 0; i < 6; i++) {
    const petal = new THREE.Mesh(new THREE.SphereGeometry(0.85, 10, 8), lambert(color, false));
    const angle = (i / 6) * Math.PI * 2;
    petal.position.set(Math.cos(angle) * 1.1, 0, Math.sin(angle) * 1.1);
    petal.scale.set(1, 0.55, 1);
    head.add(petal);
    petals.push(petal);
  }
  const center = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 8), lambert(0xffd93d, false));
  head.add(center);
  group.add(head);
  const phase = rng() * Math.PI * 2;

  return {
    object: group,
    update(time) {
      group.rotation.z = Math.sin(time * 0.9 + phase) * 0.14;
      head.rotation.y = time * 0.4 + phase;
      const open = 1 + Math.sin(time * 1.6 + phase) * 0.12;
      petals.forEach((p) => p.scale.set(open, 0.55, open));
    },
  };
};

// --- Puerto ----------------------------------------------------------------

/** Grúa de muelle: el carro corre por la pluma y el contenedor cuelga y oscila. */
const dockCrane: PropFactory = (palette, rng) => {
  const group = new THREE.Group();
  const yellow = lambert(0xf0b429);
  const steel = lambert(0x5a6069);

  for (const z of [-3.5, 3.5]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.9, 16, 0.9), yellow);
    leg.position.set(0, 8, z);
    leg.castShadow = true;
    group.add(leg);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 22), yellow);
  beam.position.set(0, 16.6, 3);
  beam.castShadow = true;
  group.add(beam);

  // Carro que recorre la pluma, con el cable y el contenedor colgando.
  const trolley = new THREE.Group();
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2, 1.4, 2.4), steel);
  cab.position.y = 15.6;
  trolley.add(cab);
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 8, 5), steel);
  cable.position.y = 10.9;
  trolley.add(cable);
  const load = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 2.4, 5.8),
    lambert(pick([...palette.sceneryColors], rng)),
  );
  load.position.y = 5.7;
  load.castShadow = true;
  trolley.add(load);
  group.add(trolley);

  const phase = rng() * Math.PI * 2;
  const speed = 0.35 + rng() * 0.25;

  return {
    object: group,
    update(time) {
      // El carro va y viene por la pluma; la carga se atrasa y queda pendulando,
      // que es lo que hace que se lea el peso.
      const travel = Math.sin(time * speed + phase);
      trolley.position.z = 3 + travel * 9;
      const swing = Math.sin(time * speed + phase - 0.6) * 0.14;
      load.rotation.x = swing;
      load.position.z = Math.sin(swing) * 5.7;
      load.position.y = 5.7 + Math.cos(swing) * 0.2 - 0.2;
    },
  };
};

/** Buque amarrado que cabecea con el oleaje. */
const mooredShip: PropFactory = (palette, rng) => {
  const group = new THREE.Group();
  const boat = new THREE.Group();

  const hull = new THREE.Mesh(new THREE.BoxGeometry(9, 4.2, 34), lambert(0x2b3a4a));
  hull.position.y = 2.1;
  hull.castShadow = true;
  boat.add(hull);
  const waterline = new THREE.Mesh(new THREE.BoxGeometry(9.3, 0.9, 34), lambert(0x8f2f24));
  waterline.position.y = 0.6;
  boat.add(waterline);
  const tower = new THREE.Mesh(new THREE.BoxGeometry(6.6, 4, 7), lambert(0xd8dbe0));
  tower.position.set(0, 6.2, -11);
  tower.castShadow = true;
  boat.add(tower);
  const funnel = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 3.4, 8), lambert(0xf0b429));
  funnel.position.set(0, 9.9, -13);
  boat.add(funnel);
  for (let i = 0; i < 3; i++) {
    const stack = new THREE.Mesh(
      new THREE.BoxGeometry(6.8, 2.4, 8),
      lambert(pick([...palette.sceneryColors], rng)),
    );
    stack.position.set(0, 5.4 + (i % 2) * 2.5, 4 + i * 8.5);
    boat.add(stack);
  }
  group.add(boat);

  const phase = rng() * Math.PI * 2;

  return {
    object: group,
    update(time) {
      // Cabeceo y balanceo lentos y desfasados: un barco amarrado no se mueve
      // como un péndulo, se mece.
      boat.rotation.x = Math.sin(time * 0.35 + phase) * 0.018;
      boat.rotation.z = Math.sin(time * 0.27 + phase * 1.7) * 0.026;
      boat.position.y = Math.sin(time * 0.4 + phase) * 0.28;
    },
  };
};

// --- Miami -----------------------------------------------------------------

/** Palmera cuyas hojas se mueven con la brisa. */
const swayingPalm: PropFactory = (_palette, rng) => {
  const group = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 7.5, 8), lambert(0xa8845a));
  trunk.position.y = 3.75;
  trunk.castShadow = true;
  group.add(trunk);

  const crown = new THREE.Group();
  crown.position.y = 7.4;
  const fronds: THREE.Mesh[] = [];
  for (let i = 0; i < 8; i++) {
    const frond = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 3.8), lambert(0x2f9c55));
    frond.position.z = 1.9;
    const pivot = new THREE.Group();
    pivot.rotation.y = (i / 8) * Math.PI * 2;
    pivot.rotation.x = -0.4;
    pivot.add(frond);
    crown.add(pivot);
    fronds.push(frond);
  }
  const coco = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6), lambert(0x9c7b3a));
  crown.add(coco);
  group.add(crown);

  const phase = rng() * Math.PI * 2;

  return {
    object: group,
    update(time) {
      const breeze = Math.sin(time * 1.1 + phase);
      trunk.rotation.z = breeze * 0.035;
      crown.rotation.z = breeze * 0.09;
      crown.position.x = breeze * 0.16;
      fronds.forEach((f, i) => {
        f.rotation.x = Math.sin(time * 2.2 + phase + i) * 0.13;
      });
    },
  };
};

/** Cartel de neón de la costanera: gira despacio y titila. */
const neonSign: PropFactory = (palette, rng) => {
  const group = new THREE.Group();
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 8, 0.4), lambert(0x3a3f4a));
  post.position.y = 4;
  post.castShadow = true;
  group.add(post);

  const colorA = pick([...palette.sceneryColors], rng);
  const colorB = pick([...palette.sceneryColors], rng);
  const board = new THREE.Group();
  board.position.y = 7.4;
  const panel = new THREE.Mesh(new THREE.BoxGeometry(4.6, 2.6, 0.3), lambert(0xfff2e2));
  board.add(panel);
  const tubeA = new THREE.Mesh(new THREE.BoxGeometry(4, 0.4, 0.45), glow(colorA));
  tubeA.position.set(0, 0.7, 0.05);
  const tubeB = new THREE.Mesh(new THREE.BoxGeometry(3, 0.4, 0.45), glow(colorB));
  tubeB.position.set(0, -0.5, 0.05);
  board.add(tubeA, tubeB);
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(2.9, 0.16, 6, 22),
    glow(colorA),
  );
  halo.position.z = 0.1;
  board.add(halo);
  group.add(board);

  const phase = rng() * Math.PI * 2;
  const matA = tubeA.material as THREE.MeshBasicMaterial;
  const matB = tubeB.material as THREE.MeshBasicMaterial;
  matA.transparent = true;
  matB.transparent = true;

  return {
    object: group,
    update(time) {
      board.rotation.y = time * 0.5 + phase;
      // Titileo alterno: un cartel de neón nunca está encendido del todo.
      matA.opacity = 0.55 + Math.abs(Math.sin(time * 3 + phase)) * 0.45;
      matB.opacity = 0.55 + Math.abs(Math.sin(time * 3 + phase + 1.6)) * 0.45;
    },
  };
};

const FACTORIES: Record<SceneryKind, PropFactory[]> = {
  estadio: [bouncingBall, wavingFlag, wavingFlag],
  neon: [floatingCube, pulsingRing, floatingCube],
  bloques: [hoppingBlocks, blockWindmill, hoppingBlocks],
  dulce: [bobbingBalloon, swayingFlower, bobbingBalloon],
  puerto: [dockCrane, mooredShip, dockCrane],
  miami: [swayingPalm, neonSign, swayingPalm],
};

/** Cuántos elementos animados se reparten por circuito. */
const PROP_COUNT = 12;

export class ThemeAnimations {
  readonly group = new THREE.Group();
  private readonly props: AnimatedProp[] = [];
  private time = 0;

  constructor(path: TrackPath, palette: ThemePalette) {
    this.group.name = 'theme-animations';
    const rng = makeRng(`${path.spec.seed}:animaciones`);
    const factories = FACTORIES[palette.scenery];

    for (let i = 0; i < PROP_COUNT; i++) {
      const factory = factories[Math.floor(rng() * factories.length)];
      const prop = factory(palette, rng);

      // Repartidos por toda la vuelta, con una separación mínima para que no se
      // amontonen dos en el mismo sitio.
      const t = (i + rng() * 0.7) / PROP_COUNT;
      const sample = path.sampleAtT(t);
      const side = rng() < 0.5 ? -1 : 1;
      const offset = 9 + rng() * 13;

      prop.object.position
        .copy(sample.position)
        .addScaledVector(sample.right, side * (sample.halfWidth + offset))
        .addScaledVector(sample.up, shoulderLift(offset));
      prop.object.rotation.y = rng() * Math.PI * 2;

      this.group.add(prop.object);
      this.props.push(prop);
    }
  }

  update(dt: number): void {
    this.time += dt;
    for (const prop of this.props) prop.update(this.time);
  }
}
