import * as THREE from 'three';
import type { TrackPath } from './TrackPath';
import { makeRng, shoulderLift } from './TrackSpec';
import type { SceneryKind, ThemePalette } from './themes';
import { makeBallTexture, makeNetTexture, makeStandTexture } from './textures';

/**
 * Decorados de los costados de la pista.
 *
 * Cada tema define un puñado de "props" (un arco, un árbol de bloques, una flor)
 * y acá se reparten a lo largo del trazado. Todo va en InstancedMesh: cientos de
 * objetos cuestan un par de draw calls, que es lo que permite poblar el
 * escenario sin que se caiga el framerate en un celular.
 */

interface PropPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** Si es true, cada instancia recibe un color de la paleta del tema. */
  tinted?: boolean;
  castShadow?: boolean;
}

interface PropDef {
  parts: PropPart[];
  /** Peso relativo con el que aparece frente a los otros props. */
  weight: number;
  /** Rango de distancia al borde del asfalto, en metros. */
  distance: [number, number];
  /** Rango de escala. */
  scale: [number, number];
}

interface Placement {
  position: THREE.Vector3;
  yaw: number;
  scale: number;
  color: THREE.Color;
}

const lambert = (color: number, flat = true) =>
  new THREE.MeshLambertMaterial({ color, flatShading: flat });
const basic = (color: number) => new THREE.MeshBasicMaterial({ color });

/** Caja apoyada en el piso (o elevada), con el origen en su base. */
function box(w: number, h: number, d: number, y = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, y + h / 2, 0);
  return g;
}

function cylinder(r: number, h: number, seg = 10, y = 0): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, h, seg);
  g.translate(0, y + h / 2, 0);
  return g;
}

function sphere(r: number, y: number, seg = 12): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, seg, seg);
  g.translate(0, y, 0);
  return g;
}

// --- Definiciones por tema --------------------------------------------------

function estadioProps(palette: ThemePalette): PropDef[] {
  const white = lambert(0xf4f4f4);
  const dark = lambert(0x363b45);
  const steel = lambert(0x9aa2ae);
  const tinted = lambert(0xffffff);

  const ball = new THREE.MeshLambertMaterial({ map: makeBallTexture() });
  const stand = new THREE.MeshLambertMaterial({ map: makeStandTexture(palette.sceneryColors) });
  const net = new THREE.MeshLambertMaterial({
    map: makeNetTexture(),
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  // La red va en un plano vertical entre los postes, con la textura repetida.
  const netGeo = new THREE.PlaneGeometry(7.8, 4.4);
  netGeo.translate(0, 2.2, -0.9);
  const netMap = net.map;
  if (netMap) netMap.repeat.set(8, 5);

  return [
    // Pelota de fútbol. Con la textura de parches deja de parecer de golf.
    {
      parts: [{ geometry: sphere(1.8, 1.8, 16), material: ball, castShadow: true }],
      weight: 0.2,
      distance: [8, 26],
      scale: [0.6, 1.1],
    },
    // Arco con red.
    {
      parts: [
        { geometry: box(0.24, 4.4, 0.24, 0), material: white, castShadow: true },
        { geometry: box(8.2, 0.24, 0.24, 4.4), material: white, castShadow: true },
        { geometry: netGeo, material: net },
      ],
      weight: 0.16,
      distance: [14, 26],
      scale: [0.95, 1.15],
    },
    // Banderas de colores: una hilera da el aire de torneo internacional.
    {
      parts: [
        { geometry: cylinder(0.08, 5.5, 6), material: steel },
        { geometry: box(1.5, 1.0, 0.07, 4.3), material: tinted, tinted: true },
      ],
      weight: 0.34,
      distance: [4, 14],
      scale: [0.85, 1.25],
    },
    // Torre de iluminación.
    {
      parts: [
        { geometry: box(0.7, 17, 0.7, 0), material: steel, castShadow: true },
        { geometry: box(5.5, 2.6, 0.5, 17), material: dark, castShadow: true },
        { geometry: box(5, 2.1, 0.7, 17.2), material: lambert(0xfff6d8, false) },
      ],
      weight: 0.12,
      distance: [30, 40],
      scale: [0.9, 1.15],
    },
    // Tribuna con gradas de hinchada.
    {
      parts: [
        { geometry: box(30, 3, 12, 0), material: dark, castShadow: true },
        // El frente inclinado con las butacas.
        { geometry: standTiers(), material: stand, castShadow: true },
        { geometry: box(32, 0.8, 13, 11.5), material: steel, castShadow: true },
      ],
      weight: 0.3,
      distance: [34, 44],
      scale: [0.95, 1.35],
    },
  ];
}

/**
 * Gradas: una escalera de cajas cada vez más altas y más atrás. Es más barato
 * que modelar filas de butacas y desde la pista se lee igual.
 */
function standTiers(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const g = new THREE.BoxGeometry(30, 1.6, 1.8);
    g.translate(0, 3 + i * 1.5, -i * 1.7);
    parts.push(g);
  }
  return mergeGeometries(parts);
}

/** Une varias geometrías con los mismos atributos en un solo buffer. */
function mergeGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = new THREE.BufferGeometry();
  const position: number[] = [];
  const normal: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  let offset = 0;

  for (const g of geometries) {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const t = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      position.push(p.getX(i), p.getY(i), p.getZ(i));
      normal.push(n.getX(i), n.getY(i), n.getZ(i));
      uv.push(t.getX(i), t.getY(i));
    }
    const idx = g.getIndex();
    if (idx) for (let i = 0; i < idx.count; i++) index.push(idx.getX(i) + offset);
    offset += p.count;
  }

  merged.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  merged.setIndex(index);
  merged.computeBoundingSphere();
  return merged;
}

function neonProps(): PropDef[] {
  const frame = lambert(0x171b28);
  const glow = basic(0xffffff);

  return [
    // Pilón luminoso.
    {
      parts: [
        { geometry: box(0.7, 8, 0.7, 0), material: frame, castShadow: true },
        { geometry: box(0.95, 0.5, 0.95, 8), material: glow, tinted: true },
        { geometry: box(0.35, 6.4, 0.35, 0.9), material: glow, tinted: true },
      ],
      weight: 0.36,
      distance: [5, 16],
      scale: [0.85, 1.35],
    },
    // Cubo de píxeles flotando.
    {
      parts: [{ geometry: box(2.2, 2.2, 2.2, 6.5), material: glow, tinted: true }],
      weight: 0.32,
      distance: [8, 30],
      scale: [0.7, 1.6],
    },
    // Panel tipo pantalla.
    {
      parts: [
        { geometry: box(0.5, 9, 0.5, 0), material: frame, castShadow: true },
        { geometry: box(5.2, 3.4, 0.5, 5.4), material: frame, castShadow: true },
        { geometry: box(4.6, 2.8, 0.7, 5.7), material: glow, tinted: true },
      ],
      weight: 0.18,
      distance: [18, 34],
      scale: [0.9, 1.25],
    },
    // Arco de luz sobre el borde.
    {
      parts: [{ geometry: box(0.45, 3.2, 0.45, 0), material: glow, tinted: true }],
      weight: 0.14,
      distance: [3.5, 6],
      scale: [0.8, 1.1],
    },
  ];
}

function bloquesProps(): PropDef[] {
  const trunk = lambert(0x8a5a32);
  const tinted = lambert(0xffffff);
  const roof = lambert(0x3c4149);

  return [
    // Árbol cúbico.
    {
      parts: [
        { geometry: box(1.1, 2.6, 1.1, 0), material: trunk, castShadow: true },
        { geometry: box(3.4, 3.4, 3.4, 2.4), material: lambert(0x3fbf4a), castShadow: true },
      ],
      weight: 0.38,
      distance: [6, 26],
      scale: [0.85, 1.5],
    },
    // Pila de cubos de colores.
    {
      parts: [
        { geometry: box(2.4, 2.4, 2.4, 0), material: tinted, tinted: true, castShadow: true },
        { geometry: box(1.8, 1.8, 1.8, 2.4), material: lambert(0xffffff), castShadow: true },
      ],
      weight: 0.3,
      distance: [5, 24],
      scale: [0.7, 1.4],
    },
    // Casita.
    {
      parts: [
        { geometry: box(6, 4.5, 6, 0), material: tinted, tinted: true, castShadow: true },
        { geometry: box(7, 1.8, 7, 4.5), material: roof, castShadow: true },
      ],
      weight: 0.2,
      distance: [22, 38],
      scale: [0.9, 1.3],
    },
    // Torre de bloques.
    {
      parts: [
        { geometry: box(3, 10, 3, 0), material: tinted, tinted: true, castShadow: true },
        { geometry: box(3.8, 1.2, 3.8, 10), material: lambert(0xffd93d), castShadow: true },
      ],
      weight: 0.12,
      distance: [26, 40],
      scale: [0.8, 1.2],
    },
  ];
}

function dulceProps(): PropDef[] {
  const stem = lambert(0x62c46a);
  const tinted = lambert(0xffffff);
  const white = lambert(0xfff4fa);

  const lollipop = new THREE.TorusGeometry(1.1, 0.34, 8, 16);
  lollipop.translate(0, 4.4, 0);

  return [
    // Flor gigante.
    {
      parts: [
        { geometry: cylinder(0.2, 3.4, 8), material: stem, castShadow: true },
        { geometry: sphere(1.35, 3.9), material: tinted, tinted: true, castShadow: true },
        { geometry: sphere(0.62, 3.9, 8), material: lambert(0xffd93d) },
      ],
      weight: 0.36,
      distance: [5, 22],
      scale: [0.8, 1.5],
    },
    // Piruleta.
    {
      parts: [
        { geometry: cylinder(0.16, 3.6, 8), material: white, castShadow: true },
        { geometry: lollipop, material: tinted, tinted: true, castShadow: true },
      ],
      weight: 0.26,
      distance: [6, 26],
      scale: [0.8, 1.35],
    },
    // Globo.
    {
      parts: [
        { geometry: cylinder(0.05, 5, 5), material: white },
        { geometry: sphere(1.15, 6.1), material: tinted, tinted: true },
      ],
      weight: 0.24,
      distance: [8, 30],
      scale: [0.75, 1.3],
    },
    // Castillito pastel.
    {
      parts: [
        { geometry: cylinder(2.6, 6, 10), material: tinted, tinted: true, castShadow: true },
        { geometry: new THREE.ConeGeometry(3.1, 3.4, 10).translate(0, 7.7, 0), material: white, castShadow: true },
      ],
      weight: 0.14,
      distance: [26, 40],
      scale: [0.9, 1.35],
    },
  ];
}

/**
 * Puerto de carga: contenedores apilados, grúas pórtico, bitas y, bien al
 * fondo, los buques mercantes amarrados al muelle.
 *
 * Los contenedores llevan la textura corrugada: sin ella, un cajón de color
 * plano se lee como un bloque de juguete y no como un contenedor.
 */
function puertoProps(palette: ThemePalette): PropDef[] {
  const steel = lambert(0x8a9099);
  const darkSteel = lambert(0x5a6069);
  const yellow = lambert(0xf0b429);
  const tinted = new THREE.MeshLambertMaterial({
    map: makeContainerTexture(),
    flatShading: true,
  });
  const hull = lambert(0x2b3a4a);
  const deck = lambert(0xd8dbe0);
  const red = lambert(0x8f2f24);

  return [
    // Contenedor suelto.
    {
      parts: [{ geometry: box(2.6, 2.6, 6.2, 0), material: tinted, tinted: true, castShadow: true }],
      weight: 0.3,
      distance: [6, 26],
      scale: [0.85, 1.1],
    },
    // Pila de tres contenedores.
    {
      parts: [
        { geometry: box(2.6, 2.6, 6.2, 0), material: tinted, tinted: true, castShadow: true },
        { geometry: box(2.6, 2.6, 6.2, 2.7), material: lambert(0xb0b5bc), castShadow: true },
        { geometry: box(2.6, 2.6, 6.2, 5.4), material: tinted, tinted: true, castShadow: true },
      ],
      weight: 0.26,
      distance: [14, 34],
      scale: [0.9, 1.25],
    },
    // Bita de amarre con su cabo.
    {
      parts: [
        { geometry: cylinder(0.45, 1.1, 10), material: darkSteel, castShadow: true },
        { geometry: sphere(0.5, 1.2, 8), material: darkSteel },
      ],
      weight: 0.14,
      distance: [3.5, 8],
      scale: [0.8, 1.2],
    },
    // Grúa pórtico: dos patas, el travesaño y la pluma que sale sobre el agua.
    {
      parts: [
        { geometry: box(1.1, 22, 1.1, 0), material: yellow, castShadow: true },
        { geometry: box(1.1, 22, 1.1, 0).translate(0, 0, -7), material: yellow, castShadow: true },
        { geometry: box(1.6, 1.6, 9, 22), material: yellow, castShadow: true },
        // Pluma hacia la pista, que es de donde se la va a mirar.
        { geometry: box(1.2, 1.2, 17, 21.5).translate(0, 0, 12), material: yellow, castShadow: true },
        { geometry: box(2.6, 2.2, 3, 18.6).translate(0, 0, 5), material: darkSteel, castShadow: true },
      ],
      weight: 0.14,
      distance: [30, 42],
      scale: [0.85, 1.1],
    },
    // Buque mercante con su superestructura y una pila de contenedores.
    {
      parts: [
        { geometry: box(11, 5, 46, 0), material: hull, castShadow: true },
        { geometry: box(11.4, 1.1, 46, 5), material: red },
        { geometry: box(8, 4.4, 9, 6).translate(0, 0, -16), material: deck, castShadow: true },
        { geometry: cylinder(0.9, 4, 8, 10.4).translate(0, 0, -18), material: yellow },
        { geometry: box(8.4, 2.6, 26, 6).translate(0, 0, 6), material: tinted, tinted: true },
        { geometry: box(8.4, 2.6, 26, 8.7).translate(0, 0, 6), material: lambert(0x2f6fb5) },
      ],
      weight: 0.1,
      distance: [44, 58],
      scale: [0.9, 1.15],
    },
    // Torre de luz del muelle.
    {
      parts: [
        { geometry: box(0.55, 13, 0.55, 0), material: steel, castShadow: true },
        { geometry: box(3, 0.5, 1, 13), material: darkSteel },
        { geometry: box(2.6, 0.7, 0.8, 13.1), material: lambert(0xfff2c8, false) },
      ],
      weight: 0.06,
      distance: [10, 22],
      scale: [0.9, 1.2],
    },
  ];
  void palette;
}

/**
 * Miami: del lado de la playa, palmeras, sombrillas y el puesto de guardavidas;
 * del lado de adentro, la zona céntrica con edificios art déco, marquesinas y
 * carteles de neón.
 */
function miamiProps(palette: ThemePalette): PropDef[] {
  const trunk = lambert(0xa8845a);
  const frond = lambert(0x2f9c55);
  const tinted = lambert(0xffffff);
  const pastel = lambert(0xfff2e2);
  const glass = new THREE.MeshLambertMaterial({ map: makeFacadeTexture(), flatShading: true });
  const neon = basic(0xffffff);
  const white = lambert(0xfff6ea);

  // Palma: un tronco apenas curvado y hojas en abanico.
  const palmFronds: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const angle = (i / 7) * Math.PI * 2;
    const g = new THREE.BoxGeometry(0.28, 0.14, 3.4);
    g.translate(0, 0, 1.7);
    g.rotateX(-0.42);
    g.rotateY(angle);
    g.translate(0, 6.4, 0);
    palmFronds.push(g);
  }

  return [
    // Palmera.
    {
      parts: [
        { geometry: cylinder(0.3, 6.4, 8), material: trunk, castShadow: true },
        { geometry: mergeGeometries(palmFronds), material: frond, castShadow: true },
        { geometry: sphere(0.42, 6.2, 8), material: lambert(0x9c7b3a) },
      ],
      weight: 0.32,
      distance: [5, 22],
      scale: [0.85, 1.4],
    },
    // Sombrilla y reposera.
    {
      parts: [
        { geometry: cylinder(0.09, 3, 6), material: white },
        { geometry: new THREE.ConeGeometry(2.1, 1, 10).translate(0, 3.3, 0), material: tinted, tinted: true, castShadow: true },
        { geometry: box(0.8, 0.16, 2, 0.45).translate(2.1, 0, 0), material: white },
      ],
      weight: 0.22,
      distance: [6, 20],
      scale: [0.8, 1.2],
    },
    // Puesto de guardavidas.
    {
      parts: [
        { geometry: box(0.22, 3.2, 0.22, 0).translate(-1.1, 0, -1.1), material: white },
        { geometry: box(0.22, 3.2, 0.22, 0).translate(1.1, 0, -1.1), material: white },
        { geometry: box(0.22, 3.2, 0.22, 0).translate(-1.1, 0, 1.1), material: white },
        { geometry: box(0.22, 3.2, 0.22, 0).translate(1.1, 0, 1.1), material: white },
        { geometry: box(3, 2.4, 3, 3.2), material: tinted, tinted: true, castShadow: true },
        { geometry: new THREE.ConeGeometry(2.6, 1.3, 4).translate(0, 6.3, 0), material: lambert(0xff5fa8), castShadow: true },
      ],
      weight: 0.12,
      distance: [10, 24],
      scale: [0.9, 1.2],
    },
    // Edificio art déco con marquesina y tira de neón.
    {
      parts: [
        { geometry: box(12, 16, 10, 0), material: glass, castShadow: true },
        // Los escalones del remate son la marca del art déco de la costanera.
        { geometry: box(9, 2.2, 8, 16), material: pastel, castShadow: true },
        { geometry: box(5.5, 1.6, 6, 18.2), material: pastel, castShadow: true },
        // Marquesina sobre la vereda.
        { geometry: box(13.5, 0.5, 3, 4.4).translate(0, 0, 5.6), material: tinted, tinted: true },
        { geometry: box(12.4, 0.5, 0.5, 4), material: neon, tinted: true },
        { geometry: box(12.4, 0.5, 0.5, 9.2), material: neon, tinted: true },
      ],
      weight: 0.22,
      distance: [26, 42],
      scale: [0.9, 1.35],
    },
    // Cartel vertical de neón, de esos que cuelgan sobre la vereda.
    {
      parts: [
        { geometry: box(0.5, 9, 0.5, 0), material: lambert(0x3a3f4a), castShadow: true },
        { geometry: box(2.2, 6, 0.4, 3.4), material: tinted, tinted: true },
        { geometry: box(1.6, 5.2, 0.6, 3.8), material: neon, tinted: true },
      ],
      weight: 0.12,
      distance: [20, 32],
      scale: [0.85, 1.2],
    },
  ];
  void palette;
}

/** Chapa corrugada con nervaduras: lo que hace que un cajón parezca contenedor. */
function makeContainerTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  for (let x = 0; x < 64; x += 8) ctx.fillRect(x, 0, 3, 64);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(0, 0, 64, 4);
  ctx.fillRect(0, 60, 64, 4);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Fachada con filas de ventanas, para los edificios del centro. */
function makeFacadeTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fdf3e4';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#8fd6e8';
  for (let y = 10; y < 118; y += 26) {
    for (let x = 12; x < 120; x += 26) ctx.fillRect(x, y, 16, 15);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  for (let y = 10; y < 118; y += 26) ctx.fillRect(0, y + 17, 128, 4);
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, 126, 126);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const PROP_BUILDERS: Record<SceneryKind, (palette: ThemePalette) => PropDef[]> = {
  estadio: estadioProps,
  neon: neonProps,
  bloques: bloquesProps,
  dulce: dulceProps,
  puerto: puertoProps,
  miami: miamiProps,
};

// --- Construcción -----------------------------------------------------------

export function buildScenery(path: TrackPath, palette: ThemePalette): THREE.Group {
  const group = new THREE.Group();
  group.name = 'scenery';

  const defs = PROP_BUILDERS[palette.scenery](palette);
  const rng = makeRng(`${path.spec.seed}:${palette.scenery}`);
  const totalWeight = defs.reduce((sum, d) => sum + d.weight, 0);

  const placements: Placement[][] = defs.map(() => []);
  const n = path.samples.length;

  for (let i = 0; i < n; i += 4) {
    const s = path.samples[i];
    for (const side of [-1, 1]) {
      if (rng() > palette.sceneryDensity) continue;

      // Elegimos el prop por ruleta ponderada.
      let pick = rng() * totalWeight;
      let index = 0;
      for (let d = 0; d < defs.length; d++) {
        pick -= defs[d].weight;
        if (pick <= 0) {
          index = d;
          break;
        }
      }
      const def = defs[index];

      const [dMin, dMax] = def.distance;
      const offset = dMin + rng() * (dMax - dMin);
      const dist = s.halfWidth + offset;
      const position = s.position
        .clone()
        .addScaledVector(s.right, side * dist)
        // Apoyados en la altura real de la banquina, no en una estimación.
        .addScaledVector(s.up, shoulderLift(offset));

      const [sMin, sMax] = def.scale;
      placements[index].push({
        position,
        // Los props grandes miran hacia la pista; los chicos, a cualquier lado.
        yaw:
          dist > 20
            ? Math.atan2(-side * s.right.x, -side * s.right.z)
            : rng() * Math.PI * 2,
        scale: sMin + rng() * (sMax - sMin),
        color: new THREE.Color(
          palette.sceneryColors[Math.floor(rng() * palette.sceneryColors.length)],
        ),
      });
    }
  }

  const dummy = new THREE.Object3D();
  defs.forEach((def, d) => {
    const list = placements[d];
    if (!list.length) return;

    for (const part of def.parts) {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, list.length);
      mesh.castShadow = part.castShadow ?? false;
      list.forEach((p, i) => {
        dummy.position.copy(p.position);
        dummy.rotation.set(0, p.yaw, 0);
        dummy.scale.setScalar(p.scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        if (part.tinted) mesh.setColorAt(i, p.color);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      group.add(mesh);
    }
  });

  return group;
}
