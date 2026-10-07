import * as THREE from 'three';
import type { Racer } from '../race/Racer';
import { TUNING } from '../kart/KartPhysics';
import { ITEMS, rollItem, type ItemId } from './ItemTypes';
import { Pickups } from './Pickups';
import { Explosions, ProjectileAssets, Trail, buildFireball, buildMissile } from './Projectiles';
import type { TrackPath } from '../track/TrackPath';

const MISSILE_SPEED = 54;
const FIREBALL_SPEED = 56;
const PROJECTILE_LIFE = 8;
const BANANA_LIFE = 25;
/** Radio de impacto por tipo: la bola de fuego es mucho más grande que el misil. */
const HIT_RADIUS = { banana: 1.7, misil: 2.1, fuego: 2.6 } as const;
/** Giro máximo por segundo del misil teledirigido. */
const MISSILE_TURN = 3.4;
/** Altura a la que vuelan los proyectiles sobre la superficie, en metros. */
const FLIGHT_HEIGHT = { misil: 1.0, fuego: 0.75 } as const;

interface Banana {
  kind: 'banana';
  mesh: THREE.Object3D;
  position: THREE.Vector3;
  life: number;
  ownerId: number;
}

interface Projectile {
  kind: 'misil' | 'fuego';
  mesh: THREE.Object3D;
  trail: Trail;
  animate: (dt: number, life: number) => void;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  ownerId: number;
  targetId: number | null;
  /** Índice de la última muestra de pista cercana, para acelerar la proyección. */
  hint: number;
}

type Hazard = Banana | Projectile;

export interface ItemEvent {
  type: 'pickup' | 'use' | 'hit' | 'boost';
  racer: Racer;
  item?: ItemId;
}

/**
 * Cajas, rampas, poderes y proyectiles.
 *
 * Todo el estado del combate vive acá y avanza con el mismo paso fijo que la
 * física, así que las colisiones son deterministas: dos partidas con los mismos
 * inputs dan el mismo resultado, que es lo que hará falta para el online.
 */
export class ItemSystem {
  readonly group = new THREE.Group();
  readonly pickups: Pickups;
  readonly explosions: Explosions;

  /** Se dispara con cada suceso, para el HUD y los avisos. */
  onEvent: ((event: ItemEvent) => void) | null = null;

  private readonly path: TrackPath;
  private readonly assets = new ProjectileAssets();
  private readonly hazards: Hazard[] = [];
  private readonly previousDistance = new Map<number, number>();
  private readonly rng: () => number;
  private readonly bananaGeo: THREE.BufferGeometry;

  constructor(path: TrackPath, seed = 1) {
    this.group.name = 'items';
    this.path = path;
    this.pickups = new Pickups(path);
    this.explosions = new Explosions(this.assets);
    this.group.add(this.pickups.group, this.explosions.group);

    // PRNG propio para que el sorteo de poderes no dependa del reloj.
    let state = seed >>> 0 || 1;
    this.rng = () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };

    this.bananaGeo = new THREE.SphereGeometry(0.55, 10, 8);
    this.bananaGeo.scale(1.3, 0.55, 0.85);
  }

  /** Reparte cajas y rampas, y mueve los proyectiles. Un paso fijo. */
  step(dt: number, racers: Racer[]): void {
    this.pickups.update(dt);

    for (const racer of racers) {
      const proj = racer.physics.projection;
      const previous = this.previousDistance.get(racer.id) ?? proj.distance;
      this.previousDistance.set(racer.id, proj.distance);

      if (this.pickups.padHit(proj.distance, proj.lateral, previous)) {
        racer.physics.applyBoost(TUNING.padBoostDuration);
        this.onEvent?.({ type: 'boost', racer });
      }

      if (!racer.item && this.pickups.takeBox(proj.distance, proj.lateral, previous)) {
        if (racers.length === 1) {
          // En contrarreloj no hay a quién tirarle: las cajas dan siempre el
          // rayo, que es el único poder que sirve corriendo solo.
          racer.item = 'rayo';
        } else {
          const ratio = (racer.position - 1) / (racers.length - 1);
          racer.item = rollItem(this.rng, ratio);
        }
        this.onEvent?.({ type: 'pickup', racer, item: racer.item });
      }
    }

    this.stepHazards(dt, racers);
  }

  /** Efectos puramente visuales. Van con el reloj del render, no con el fijo. */
  updateVisuals(dt: number): void {
    this.explosions.update(dt);
    for (const h of this.hazards) {
      if (h.kind === 'banana') continue;
      h.animate(dt, h.life);
    }
  }

  /** Usa el poder que el kart tenga en mano. */
  use(racer: Racer, racers: Racer[]): void {
    const item = racer.item;
    if (!item) return;
    racer.item = null;
    this.onEvent?.({ type: 'use', racer, item });

    switch (item) {
      case 'rayo':
        racer.physics.applyStar();
        break;
      case 'banana':
        this.dropBanana(racer);
        break;
      case 'fuego':
        this.launch(racer, 'fuego', FIREBALL_SPEED, null);
        break;
      case 'misil': {
        // Apunta al que va inmediatamente adelante en la clasificación.
        const ahead = racers
          .filter((r) => r.id !== racer.id && r.position < racer.position)
          .sort((a, b) => b.position - a.position)[0];
        this.launch(racer, 'misil', MISSILE_SPEED, ahead ? ahead.id : null);
        break;
      }
    }
  }

  private dropBanana(racer: Racer): void {
    const back = racer.physics.forward.clone().multiplyScalar(-3.2);
    const position = racer.physics.position.clone().add(back);
    position.y += 0.3;

    const mesh = new THREE.Mesh(
      this.bananaGeo,
      new THREE.MeshLambertMaterial({ color: ITEMS.banana.color, flatShading: true }),
    );
    mesh.position.copy(position);
    mesh.rotation.y = this.rng() * Math.PI;
    mesh.castShadow = true;
    this.group.add(mesh);

    this.hazards.push({ kind: 'banana', mesh, position, life: BANANA_LIFE, ownerId: racer.id });
  }

  private launch(
    racer: Racer,
    kind: 'misil' | 'fuego',
    speed: number,
    targetId: number | null,
  ): void {
    const forward = racer.physics.forward.clone();
    const position = racer.physics.position.clone().addScaledVector(forward, 3.2);

    const built = kind === 'fuego' ? buildFireball(this.assets) : buildMissile(this.assets);
    const proj = this.path.project(position, racer.physics.projection.index);
    position.y = proj.surfaceY + FLIGHT_HEIGHT[kind];

    built.group.position.copy(position);
    built.trail.reset(position);
    this.group.add(built.group, built.trail.group);

    this.hazards.push({
      kind,
      mesh: built.group,
      trail: built.trail,
      animate: built.update,
      position,
      velocity: forward.multiplyScalar(speed),
      life: PROJECTILE_LIFE,
      ownerId: racer.id,
      targetId,
      hint: proj.index,
    });
  }

  /**
   * Rumbo del misil.
   *
   * No apunta al objetivo en línea recta: eso lo mandaba derecho contra el muro
   * exterior en cuanto había una curva de por medio, y el poder se sentía roto.
   * En lugar de eso el misil sigue el trazado —apunta a un punto de la línea
   * central por delante suyo, desplazado hacia el carril del objetivo— y sólo
   * cuando lo tiene cerca se tira de lleno sobre él.
   */
  private guideMissile(h: Projectile, dt: number, racers: Racer[]): void {
    const speed = h.velocity.length();
    const proj = this.path.project(h.position, h.hint);
    h.hint = proj.index;

    const target = h.targetId === null ? null : racers.find((r) => r.id === h.targetId);

    // Distancia que le falta SOBRE LA PISTA, no en línea recta.
    let gap = 24;
    let targetLateral = proj.lateral;
    if (target) {
      const total = this.path.totalLength;
      gap = target.physics.projection.distance - proj.distance;
      if (gap < -total / 2) gap += total;
      if (gap > total / 2) gap -= total;
      targetLateral = target.physics.projection.lateral;
    }

    // Cuanto más cerca, más directo: a menos de 10 m se olvida del trazado y va
    // sobre el kart, que es lo que hace que termine acertando.
    const direct = THREE.MathUtils.clamp(1 - (gap - 4) / 14, 0, 1);

    let aim: THREE.Vector3;
    if (target && direct >= 1) {
      aim = target.physics.position.clone();
    } else {
      // Punto de mira sobre la línea central, adelante del misil y corrido hacia
      // el carril por el que viene el objetivo. Mirar demasiado lejos hace que
      // en una horquilla apunte al otro lado de la curva y se vaya al muro.
      const lookahead = THREE.MathUtils.clamp(Math.max(gap, 6) * 0.45, 7, 16);
      const sample = this.path.sampleAtDistance(proj.distance + lookahead);
      const lateral = THREE.MathUtils.lerp(proj.lateral, targetLateral, 0.65);
      aim = sample.position
        .clone()
        .addScaledVector(sample.right, THREE.MathUtils.clamp(lateral, -sample.halfWidth, sample.halfWidth))
        .addScaledVector(sample.up, FLIGHT_HEIGHT.misil);
      if (target && direct > 0) aim.lerp(target.physics.position, direct);
    }

    const desired = aim.sub(h.position).setY(0);
    if (desired.lengthSq() < 1e-6) return;

    // Giro con límite angular real (rad/s), no una interpolación entre vectores:
    // el `lerp` acorta el vector y además da un giro que depende del ángulo, así
    // que en una horquilla el misil se quedaba corto y terminaba en el muro.
    const current = Math.atan2(h.velocity.x, h.velocity.z);
    const wanted = Math.atan2(desired.x, desired.z);
    let delta = (wanted - current) % (Math.PI * 2);
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    const step = THREE.MathUtils.clamp(delta, -MISSILE_TURN * dt, MISSILE_TURN * dt);
    const yaw = current + step;
    h.velocity.set(Math.sin(yaw) * speed, 0, Math.cos(yaw) * speed);
  }

  private stepHazards(dt: number, racers: Racer[]): void {
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.life -= dt;

      if (h.kind !== 'banana') {
        if (h.kind === 'misil') this.guideMissile(h, dt, racers);

        h.position.addScaledVector(h.velocity, dt);

        // Los proyectiles siguen el relieve del circuito en vez de irse al cielo
        // en una bajada o enterrarse en una subida.
        const proj = this.path.project(h.position, h.hint);
        h.hint = proj.index;
        h.position.y = proj.surfaceY + FLIGHT_HEIGHT[h.kind];

        h.mesh.position.copy(h.position);
        h.mesh.lookAt(h.position.clone().add(h.velocity));
        h.trail.update(h.position);

        // Contra el muro exterior se apaga: seguir de largo por el pasto no
        // tiene sentido y encima se ve mal.
        if (Math.abs(proj.lateral) > proj.halfWidth + TUNING.barrierOffset) {
          this.burst(h);
          this.remove(i);
          continue;
        }
      }

      let consumed = h.life <= 0;
      let exploded = false;

      if (!consumed) {
        const radius = HIT_RADIUS[h.kind];
        for (const racer of racers) {
          if (racer.id === h.ownerId && h.kind !== 'banana') continue;
          // La banana del propio dueño no lo afecta hasta que se aleja, o se
          // pisaría sola al soltarla.
          if (racer.id === h.ownerId && h.kind === 'banana' && h.life > BANANA_LIFE - 1.2) continue;
          if (racer.finished) continue;

          const dx = racer.physics.position.x - h.position.x;
          const dz = racer.physics.position.z - h.position.z;
          if (dx * dx + dz * dz > radius * radius) continue;

          const hit = racer.physics.applyHit();
          if (hit) this.onEvent?.({ type: 'hit', racer });
          consumed = true;
          exploded = true;
          break;
        }
      }

      if (consumed) {
        if (h.kind !== 'banana' && (exploded || h.life <= 0)) this.burst(h);
        this.remove(i);
      }
    }
  }

  private burst(h: Hazard): void {
    if (h.kind === 'banana') return;
    this.explosions.spawn(
      h.position,
      h.kind === 'fuego' ? 0xff8c2a : 0x8fd0ff,
      h.kind === 'fuego' ? 1.25 : 0.85,
    );
  }

  private remove(index: number): void {
    const h = this.hazards[index];
    this.group.remove(h.mesh);
    if (h.kind === 'banana') {
      ((h.mesh as THREE.Mesh).material as THREE.Material).dispose();
    } else {
      this.group.remove(h.trail.group);
      h.trail.dispose();
      h.mesh.traverse((obj) => {
        const material = (obj as THREE.Mesh).material as THREE.Material | undefined;
        material?.dispose();
      });
    }
    this.hazards.splice(index, 1);
  }

  /** Proyectiles vivos. Lo usan el HUD y los tests. */
  get hazardCount(): number {
    return this.hazards.length;
  }

  /** Posición de lo que hay en vuelo o en el piso, para el minimapa y los tests. */
  get hazardStates(): { kind: Hazard['kind']; position: THREE.Vector3 }[] {
    return this.hazards.map((h) => ({ kind: h.kind, position: h.position }));
  }

  dispose(): void {
    for (let i = this.hazards.length - 1; i >= 0; i--) this.remove(i);
    this.explosions.dispose();
    this.bananaGeo.dispose();
    this.assets.dispose();
  }
}
