import * as THREE from 'three';
import type { KartLivery } from '../characters/CharacterSpec';

/**
 * Carrocerías.
 *
 * No todos los personajes manejan un kart: Fer va en un autoelevador y Vero en
 * un deportivo. En vez de meter condicionales por todo `KartView`, cada
 * carrocería se arma acá y devuelve siempre la misma ficha —dónde van las
 * ruedas, dónde se sienta el piloto, dónde se pegan las chapas del número y de
 * dónde sale la llama del turbo—, así el resto del juego no sabe ni le importa
 * qué está manejando cada uno.
 *
 * Todas comparten la física: esto es puramente el aspecto. Un autoelevador que
 * anduviera distinto sería un castigo para quien lo elija.
 */

export type ChassisKind = 'kart' | 'autoelevador' | 'deportivo';

export interface WheelSlot {
  x: number;
  z: number;
  radius: number;
  width: number;
  front: boolean;
}

export interface PanelSlot {
  position: [number, number, number];
  rotation: [number, number, number];
  size: [number, number];
}

export interface ChassisBuild {
  /** Carrocería sin ruedas; el pivote de balanceo la cuelga entera. */
  group: THREE.Group;
  wheels: WheelSlot[];
  /** Origen del piloto (cadera). El modelo del piloto se arma desde ahí. */
  driver: THREE.Vector3;
  panels: PanelSlot[];
  /** De dónde sale la llama del turbo. */
  exhaust: THREE.Vector3;
  /** Dónde saltan las chispas del derrape. */
  sparks: [THREE.Vector3, THREE.Vector3];
  /** Radio del aura del rayo: tiene que envolver todo el vehículo. */
  auraRadius: number;
  auraHeight: number;
}

const lambert = (color: number) => new THREE.MeshLambertMaterial({ color, flatShading: true });

export function buildChassis(kind: ChassisKind, livery: KartLivery): ChassisBuild {
  switch (kind) {
    case 'autoelevador':
      return buildForklift(livery);
    case 'deportivo':
      return buildSportsCar(livery);
    default:
      return buildKart(livery);
  }
}

// --- Kart --------------------------------------------------------------------

function buildKart(livery: KartLivery): ChassisBuild {
  const group = new THREE.Group();
  const bodyMat = lambert(livery.body);
  const accentMat = lambert(livery.accent);
  const trimMat = lambert(livery.trim);
  const darkMat = lambert(0x272b33);

  const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.42, 2.3), bodyMat);
  chassis.position.y = 0.46;
  chassis.castShadow = true;
  group.add(chassis);

  // Trompa achatada, para que se lea la dirección de frente.
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.26, 0.75), accentMat);
  nose.position.set(0, 0.36, 1.42);
  nose.castShadow = true;
  group.add(nose);

  for (const side of [-1, 1]) {
    const pod = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.32, 1.25), darkMat);
    pod.position.set(side * 0.86, 0.42, 0.05);
    group.add(pod);
  }

  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 0.42), trimMat);
  wing.position.set(0, 1.02, -1.16);
  group.add(wing);
  for (const side of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.42, 0.12), darkMat);
    strut.position.set(side * 0.55, 0.8, -1.16);
    group.add(strut);
  }

  return {
    group,
    wheels: [
      { x: -0.82, z: 1.0, radius: 0.42, width: 0.36, front: true },
      { x: 0.82, z: 1.0, radius: 0.42, width: 0.36, front: true },
      { x: -0.86, z: -0.95, radius: 0.42, width: 0.36, front: false },
      { x: 0.86, z: -0.95, radius: 0.42, width: 0.36, front: false },
    ],
    driver: new THREE.Vector3(0, 0, 0),
    panels: [
      { position: [-0.756, 0.48, 0.05], rotation: [0, -Math.PI / 2, 0], size: [0.62, 0.46] },
      { position: [0.756, 0.48, 0.05], rotation: [0, Math.PI / 2, 0], size: [0.62, 0.46] },
      { position: [0, 0.5, 1.42], rotation: [-Math.PI / 2, 0, 0], size: [0.66, 0.5] },
    ],
    exhaust: new THREE.Vector3(0, 0.5, -1.9),
    sparks: [new THREE.Vector3(-0.86, 0.3, -1.05), new THREE.Vector3(0.86, 0.3, -1.05)],
    auraRadius: 1.7,
    auraHeight: 0.8,
  };
}

// --- Autoelevador -------------------------------------------------------------

/**
 * Montacargas con uñas.
 *
 * Lo que lo hace reconocible de un vistazo es el mástil con las uñas adelante y
 * el techo de jaula sobre el conductor; el contrapeso trasero le da la silueta
 * pesada. Las ruedas delanteras son grandes y las traseras chicas, como en uno
 * de verdad, pero la física sigue siendo la misma del kart.
 */
function buildForklift(livery: KartLivery): ChassisBuild {
  const group = new THREE.Group();
  const bodyMat = lambert(livery.body);
  const accentMat = lambert(livery.accent);
  const darkMat = lambert(0x2a2e35);
  const steelMat = lambert(0x9aa2ae);

  // Cuerpo y contrapeso.
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.75, 1.9), bodyMat);
  body.position.set(0, 0.62, -0.25);
  body.castShadow = true;
  group.add(body);

  const counterweight = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.95, 0.75), darkMat);
  counterweight.position.set(0, 0.6, -1.3);
  counterweight.castShadow = true;
  group.add(counterweight);

  // Capó del motor, delante del asiento.
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 0.8), accentMat);
  hood.position.set(0, 1.2, -0.05);
  group.add(hood);

  // Mástil: dos guías verticales adelante, bien separadas. Si van juntas y
  // altas, desde la cámara tapan la cara del piloto, que es medio personaje.
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.5, 0.2), steelMat);
    rail.position.set(side * 0.62, 1.25, 1.16);
    rail.castShadow = true;
    group.add(rail);
  }
  const railTop = new THREE.Mesh(new THREE.BoxGeometry(1.44, 0.16, 0.22), steelMat);
  railTop.position.set(0, 2.45, 1.16);
  group.add(railTop);

  // Carro y uñas: lo que de verdad dice "autoelevador".
  const carriage = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.6, 0.16), darkMat);
  carriage.position.set(0, 0.5, 1.28);
  group.add(carriage);
  for (const side of [-1, 1]) {
    const fork = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.09, 1.5), steelMat);
    fork.position.set(side * 0.38, 0.22, 2.02);
    fork.castShadow = true;
    group.add(fork);
    const heel = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.42, 0.1), steelMat);
    heel.position.set(side * 0.38, 0.4, 1.32);
    group.add(heel);
  }

  // Cilindros hidráulicos, uno a cada lado y pegados a las guías: en el medio
  // quedarían justo delante de la cara.
  for (const side of [-1, 1]) {
    const ram = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.8, 8), lambert(0xc9ced6));
    ram.position.set(side * 0.44, 1.05, 1.1);
    group.add(ram);
  }

  // Techo de jaula sobre el conductor.
  for (const [x, z] of [
    [-0.66, 0.42],
    [0.66, 0.42],
    [-0.66, -1.0],
    [0.66, -1.0],
  ] as const) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.7, 0.1), darkMat);
    post.position.set(x, 2.35, z);
    group.add(post);
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 1.6), darkMat);
  roof.position.set(0, 3.75, -0.3);
  roof.castShadow = true;
  group.add(roof);
  // Barrotes del techo: se ven desde la cámara, que va por detrás y arriba.
  for (let i = -2; i <= 2; i++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.5), steelMat);
    bar.position.set(i * 0.3, 3.7, -0.3);
    group.add(bar);
  }

  // Baliza giratoria: detalle chico que lo hace inconfundible.
  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13, 0.13, 0.22, 8),
    new THREE.MeshBasicMaterial({ color: 0xffa62b }),
  );
  beacon.position.set(0.5, 3.9, -0.3);
  group.add(beacon);

  // Asiento.
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.16, 0.6), darkMat);
  seat.position.set(0, 1.02, -0.72);
  group.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.62, 0.14), darkMat);
  back.position.set(0, 1.35, -1.0);
  group.add(back);

  return {
    group,
    wheels: [
      { x: -0.78, z: 0.72, radius: 0.48, width: 0.4, front: true },
      { x: 0.78, z: 0.72, radius: 0.48, width: 0.4, front: true },
      { x: -0.68, z: -1.18, radius: 0.34, width: 0.32, front: false },
      { x: 0.68, z: -1.18, radius: 0.34, width: 0.32, front: false },
    ],
    // El piloto va sentado más alto que en un kart.
    driver: new THREE.Vector3(0, 0.5, -0.55),
    panels: [
      { position: [-0.762, 0.62, -0.3], rotation: [0, -Math.PI / 2, 0], size: [0.66, 0.5] },
      { position: [0.762, 0.62, -0.3], rotation: [0, Math.PI / 2, 0], size: [0.66, 0.5] },
      { position: [0, 0.62, -1.69], rotation: [0, Math.PI, 0], size: [0.7, 0.52] },
    ],
    exhaust: new THREE.Vector3(0, 0.75, -1.85),
    sparks: [new THREE.Vector3(-0.68, 0.3, -1.3), new THREE.Vector3(0.68, 0.3, -1.3)],
    auraRadius: 2.4,
    auraHeight: 1.3,
  };
}

// --- Deportivo -----------------------------------------------------------------

/**
 * Cupé deportivo.
 *
 * Bajo, ancho y con el parabrisas muy inclinado: la silueta del auto rápido. El
 * piloto asoma por el techo abierto —si fuera cerrado no se le vería la cara, y
 * la cara es medio personaje.
 */
function buildSportsCar(livery: KartLivery): ChassisBuild {
  const group = new THREE.Group();
  const bodyMat = lambert(livery.body);
  const accentMat = lambert(livery.accent);
  const trimMat = lambert(livery.trim);
  const darkMat = lambert(0x1e2128);
  const glassMat = new THREE.MeshLambertMaterial({
    color: 0x2b3b4a,
    transparent: true,
    opacity: 0.55,
    flatShading: true,
  });

  // Plataforma baja y ancha.
  const floor = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.34, 3.5), bodyMat);
  floor.position.y = 0.38;
  floor.castShadow = true;
  group.add(floor);

  // Trompa en cuña.
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.26, 1.1), bodyMat);
  nose.position.set(0, 0.34, 1.9);
  nose.castShadow = true;
  group.add(nose);
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.09, 0.5), darkMat);
  splitter.position.set(0, 0.17, 2.3);
  group.add(splitter);

  // Faros.
  for (const side of [-1, 1]) {
    const lamp = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.14, 0.12),
      new THREE.MeshBasicMaterial({ color: 0xfff4d8 }),
    );
    lamp.position.set(side * 0.52, 0.42, 2.42);
    group.add(lamp);
  }

  // Capó y aletas.
  const bonnet = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.2, 1.5), bodyMat);
  bonnet.position.set(0, 0.56, 1.3);
  group.add(bonnet);
  for (const side of [-1, 1]) {
    const fender = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.34, 1.2), bodyMat);
    fender.position.set(side * 0.78, 0.6, 1.2);
    group.add(fender);
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 1.9), darkMat);
    skirt.position.set(side * 0.9, 0.3, 0);
    group.add(skirt);
  }

  // Habitáculo: cuña de parabrisas y cola alta.
  const cowl = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.42, 0.34), bodyMat);
  cowl.position.set(0, 0.74, 0.62);
  group.add(cowl);
  const windscreen = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.52, 0.1), glassMat);
  windscreen.position.set(0, 1.0, 0.56);
  windscreen.rotation.x = 0.55;
  group.add(windscreen);

  const rear = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.55, 1.35), bodyMat);
  rear.position.set(0, 0.72, -1.05);
  rear.castShadow = true;
  group.add(rear);
  // Franja central, en dos tramos que siguen la altura de cada panel. Una sola
  // franja de punta a punta quedaba flotando como una tabla sobre el capó.
  const bonnetStripe = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.03, 2.4), accentMat);
  bonnetStripe.position.set(0, 0.67, 1.42);
  group.add(bonnetStripe);
  const rearStripe = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.03, 1.3), accentMat);
  rearStripe.position.set(0, 1.0, -1.05);
  group.add(rearStripe);

  // Alerón y salidas de escape.
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.09, 0.44), trimMat);
  wing.position.set(0, 1.18, -1.68);
  group.add(wing);
  for (const side of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 0.14), darkMat);
    strut.position.set(side * 0.66, 1.02, -1.68);
    group.add(strut);
    const pipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.11, 0.26, 8),
      lambert(0xc9ced6),
    );
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(side * 0.38, 0.34, -1.82);
    group.add(pipe);
  }

  // Asiento.
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.5, 0.16), darkMat);
  seat.position.set(0, 0.86, -0.42);
  group.add(seat);

  return {
    group,
    wheels: [
      { x: -0.9, z: 1.28, radius: 0.44, width: 0.38, front: true },
      { x: 0.9, z: 1.28, radius: 0.44, width: 0.38, front: true },
      { x: -0.94, z: -1.18, radius: 0.48, width: 0.46, front: false },
      { x: 0.94, z: -1.18, radius: 0.48, width: 0.46, front: false },
    ],
    // Hundido en el habitáculo: es un auto bajo.
    driver: new THREE.Vector3(0, -0.12, -0.22),
    panels: [
      { position: [-0.912, 0.62, 0.1], rotation: [0, -Math.PI / 2, 0], size: [0.66, 0.5] },
      { position: [0.912, 0.62, 0.1], rotation: [0, Math.PI / 2, 0], size: [0.66, 0.5] },
      // Sobre la trompa, por delante del capó: en el medio del capó chocaba con
      // la franja central y quedaban dos chapas blancas encimadas.
      { position: [0, 0.48, 1.95], rotation: [-Math.PI / 2, 0, 0], size: [0.7, 0.52] },
    ],
    exhaust: new THREE.Vector3(0, 0.34, -2.25),
    sparks: [new THREE.Vector3(-0.94, 0.3, -1.45), new THREE.Vector3(0.94, 0.3, -1.45)],
    auraRadius: 2,
    auraHeight: 0.7,
  };
}
