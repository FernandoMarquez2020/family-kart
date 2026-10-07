import * as THREE from 'three';
import type { TrackPath } from '../track/TrackPath';

/**
 * Elementos que se recogen sobre la pista: rampas de turbo y cajas de poder.
 *
 * Las posiciones se expresan en `t` (0..1 del trazado), así que valen para
 * cualquier circuito sin tener que colocarlas a mano en cada uno.
 */

/** Dónde van las rampas de turbo, en fracción de vuelta. */
const BOOST_PAD_T = [0.16, 0.5, 0.83];
/** Dónde van los grupos de cajas de poder. */
const ITEM_BOX_T = [0.32, 0.7];
/** Posiciones laterales de las cajas dentro de cada grupo, en fracción del ancho. */
const ITEM_BOX_LANES = [-0.5, 0, 0.5];

const PAD_HALF_LENGTH = 3.2;
const PAD_HALF_WIDTH = 2.8;
const BOX_RADIUS = 1.6;
const BOX_RESPAWN = 4;

export interface BoostPad {
  /** Distancia sobre el trazado, en metros. */
  distance: number;
  lateral: number;
  position: THREE.Vector3;
}

export interface ItemBox {
  distance: number;
  lateral: number;
  position: THREE.Vector3;
  /** Segundos que faltan para que vuelva a aparecer. 0 = disponible. */
  cooldown: number;
  mesh: THREE.Mesh;
}

/** Flecha luminosa del piso: la textura hace toda la lectura. */
function makePadTexture(): THREE.Texture {
  const W = 128;
  const H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#12306b';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#4ad6ff';
  // Tres galones apuntando hacia adelante (arriba del canvas).
  for (let i = 0; i < 3; i++) {
    const y = 96 - i * 34;
    ctx.beginPath();
    ctx.moveTo(14, y);
    ctx.lineTo(64, y - 26);
    ctx.lineTo(114, y);
    ctx.lineTo(114, y + 12);
    ctx.lineTo(64, y - 14);
    ctx.lineTo(14, y + 12);
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Caja de poder: cubo con un signo de pregunta en cada cara. */
function makeBoxTexture(): THREE.Texture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, S, S);
  grad.addColorStop(0, '#ffd93d');
  grad.addColorStop(1, '#ff9c20');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 8;
  ctx.strokeRect(6, 6, S - 12, S - 12);
  ctx.fillStyle = '#2a1a00';
  ctx.font = '900 84px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', S / 2, S / 2 + 6);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Un pedazo de caja volando tras el golpe. */
interface Shard {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  /** Segundos que le quedan de vida. */
  life: number;
  maxLife: number;
}

/** Destello del momento del impacto. */
interface Flash {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  life: number;
}

const SHARD_COUNT = 11;
const SHARD_LIFE = 0.85;
const SHARD_GRAVITY = 20;
const FLASH_LIFE = 0.2;

export class Pickups {
  readonly group = new THREE.Group();
  readonly pads: BoostPad[] = [];
  readonly boxes: ItemBox[] = [];

  private readonly path: TrackPath;
  private spin = 0;

  // --- Rotura de las cajas ---
  private readonly shards: Shard[] = [];
  private readonly flashes: Flash[] = [];
  private readonly shardGeo: THREE.BufferGeometry;
  private readonly shardMaterial: THREE.MeshLambertMaterial;
  private readonly flashGeo: THREE.BufferGeometry;
  /** Contador propio para que la rotura sea siempre igual dada la misma partida. */
  private shardSeed = 1;

  constructor(path: TrackPath) {
    this.path = path;
    this.group.name = 'pickups';

    const padMat = new THREE.MeshBasicMaterial({
      map: makePadTexture(),
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    const padGeo = new THREE.PlaneGeometry(PAD_HALF_WIDTH * 2, PAD_HALF_LENGTH * 2);

    for (const t of BOOST_PAD_T) {
      const sample = path.sampleAtT(t);
      const position = sample.position.clone().addScaledVector(sample.up, 0.05);
      const mesh = new THREE.Mesh(padGeo, padMat);
      mesh.position.copy(position);
      // La base tiene que ser derecha o la malla queda espejada y sus caras
      // terminan mirando hacia abajo.
      mesh.quaternion.setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(
          sample.right.clone(),
          sample.tangent.clone(),
          sample.up.clone(),
        ),
      );
      this.group.add(mesh);
      this.pads.push({ distance: sample.distance, lateral: 0, position });
    }

    const boxTexture = makeBoxTexture();
    const boxMat = new THREE.MeshLambertMaterial({ map: boxTexture });
    const boxGeo = new THREE.BoxGeometry(1.7, 1.7, 1.7);

    // Los pedazos llevan la misma textura que la caja, así se lee que es la
    // caja la que se rompió y no un efecto genérico.
    this.shardGeo = new THREE.BoxGeometry(0.42, 0.42, 0.42);
    this.shardMaterial = new THREE.MeshLambertMaterial({ map: boxTexture, flatShading: true });
    this.flashGeo = new THREE.SphereGeometry(1, 12, 10);

    for (const t of ITEM_BOX_T) {
      const sample = path.sampleAtT(t);
      for (const lane of ITEM_BOX_LANES) {
        const lateral = lane * sample.halfWidth;
        const position = sample.position
          .clone()
          .addScaledVector(sample.right, lateral)
          .addScaledVector(sample.up, 1.15);
        const mesh = new THREE.Mesh(boxGeo, boxMat);
        mesh.position.copy(position);
        mesh.castShadow = true;
        this.group.add(mesh);
        this.boxes.push({ distance: sample.distance, lateral, position, cooldown: 0, mesh });
      }
    }
  }

  /** Pedazos de caja actualmente en el aire. Lo usa el test de la animación. */
  get shardCount(): number {
    return this.shards.length;
  }

  /** Animación, reaparición de las cajas y efecto de rotura. */
  update(dt: number): void {
    this.spin += dt * 1.6;
    for (const box of this.boxes) {
      if (box.cooldown > 0) {
        box.cooldown = Math.max(0, box.cooldown - dt);
        if (box.cooldown === 0) {
          box.mesh.visible = true;
          box.mesh.scale.setScalar(0.01); // reaparece creciendo
        }
      }
      if (box.mesh.visible && box.mesh.scale.x < 1) {
        box.mesh.scale.setScalar(Math.min(1, box.mesh.scale.x + dt * 3.5));
      }
      box.mesh.rotation.set(this.spin * 0.6, this.spin, 0);
      box.mesh.position.y = box.position.y + Math.sin(this.spin * 1.4) * 0.12;
    }

    this.updateShards(dt);
  }

  private updateShards(dt: number): void {
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.group.remove(s.mesh);
        this.shards.splice(i, 1);
        continue;
      }
      s.velocity.y -= SHARD_GRAVITY * dt;
      s.mesh.position.addScaledVector(s.velocity, dt);
      s.mesh.rotation.x += s.spin.x * dt;
      s.mesh.rotation.y += s.spin.y * dt;
      s.mesh.rotation.z += s.spin.z * dt;
      // Se achican hasta desaparecer: evita tener que animar la opacidad, que
      // obligaría a un material por pedazo.
      s.mesh.scale.setScalar(Math.max(0.01, s.life / s.maxLife));
    }

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      if (f.life <= 0) {
        this.group.remove(f.mesh);
        f.material.dispose();
        this.flashes.splice(i, 1);
        continue;
      }
      const t = 1 - f.life / FLASH_LIFE;
      f.mesh.scale.setScalar(0.5 + t * 1.5);
      f.material.opacity = 0.85 * (1 - t) * (1 - t);
    }
  }

  /** Revienta una caja: pedazos que salen volando y un destello. */
  private burst(position: THREE.Vector3): void {
    const random = () => {
      this.shardSeed = (this.shardSeed * 1664525 + 1013904223) >>> 0;
      return this.shardSeed / 4294967296;
    };

    for (let i = 0; i < SHARD_COUNT; i++) {
      const mesh = new THREE.Mesh(this.shardGeo, this.shardMaterial);
      mesh.position.copy(position);
      mesh.castShadow = true;

      // Reparto esférico con sesgo hacia arriba, para que el estallido se vea
      // por encima del kart que acaba de pasar.
      const angle = (i / SHARD_COUNT) * Math.PI * 2 + random();
      const speed = 5 + random() * 5;
      const velocity = new THREE.Vector3(
        Math.cos(angle) * speed,
        3.5 + random() * 5,
        Math.sin(angle) * speed,
      );
      const spin = new THREE.Vector3(
        (random() - 0.5) * 24,
        (random() - 0.5) * 24,
        (random() - 0.5) * 24,
      );
      const life = SHARD_LIFE * (0.65 + random() * 0.6);
      this.group.add(mesh);
      this.shards.push({ mesh, velocity, spin, life, maxLife: life });
    }

    // Mezcla aditiva: el destello tiene que sumar luz, no taparle los pedazos
    // con una esfera opaca. Con mezcla normal se ve como una burbuja gris.
    const material = new THREE.MeshBasicMaterial({
      color: 0xffe9a0,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const flash = new THREE.Mesh(this.flashGeo, material);
    flash.position.copy(position);
    this.group.add(flash);
    this.flashes.push({ mesh: flash, material, life: FLASH_LIFE });
  }

  /**
   * ¿El kart pisó una rampa? Se compara sobre el trazado, no en 3D: es más
   * barato y no falla si el kart pasa muy rápido entre dos frames.
   */
  padHit(distance: number, lateral: number, previousDistance: number): boolean {
    for (const pad of this.pads) {
      if (Math.abs(lateral - pad.lateral) > PAD_HALF_WIDTH) continue;
      if (crossedOrInside(previousDistance, distance, pad.distance, PAD_HALF_LENGTH, this.path.totalLength)) {
        return true;
      }
    }
    return false;
  }

  /** Caja recogida, o null. Marca la caja como usada. */
  takeBox(distance: number, lateral: number, previousDistance: number): ItemBox | null {
    for (const box of this.boxes) {
      if (box.cooldown > 0) continue;
      if (Math.abs(lateral - box.lateral) > BOX_RADIUS) continue;
      if (crossedOrInside(previousDistance, distance, box.distance, BOX_RADIUS, this.path.totalLength)) {
        box.cooldown = BOX_RESPAWN;
        box.mesh.visible = false;
        this.burst(box.mesh.position.clone());
        return box;
      }
    }
    return null;
  }
}

/**
 * ¿El tramo recorrido entre dos frames tocó el punto marcado?
 *
 * Mirar sólo la posición actual dejaría pasar las rampas a 150 km/h: en un paso
 * de 1/120 s el kart avanza 35 cm, pero entre dos consultas del HUD puede
 * avanzar metros. Comparamos el intervalo recorrido, con el cuidado de que la
 * distancia da la vuelta al cerrar el circuito.
 */
function crossedOrInside(
  from: number,
  to: number,
  target: number,
  halfWidth: number,
  trackLength: number,
): boolean {
  let a = from;
  let b = to;
  if (b < a) b += trackLength; // cruzó la meta
  for (const t of [target, target + trackLength]) {
    if (b >= t - halfWidth && a <= t + halfWidth) return true;
  }
  return false;
}
