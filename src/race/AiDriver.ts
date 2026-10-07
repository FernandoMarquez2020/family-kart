import type { InputState } from '../core/Input';
import { steerToward, yawOf } from '../kart/KartPhysics';
import { makeRng } from '../track/TrackSpec';
import type { Racer } from './Racer';

export type Difficulty = 'facil' | 'normal' | 'dificil';

export interface DifficultySpec {
  id: Difficulty;
  label: string;
  /** Fracción del acelerador que usa en recta. */
  pace: number;
  /** Cuánto levanta el pie en las curvas: más alto = más prudente y lento. */
  caution: number;
  /** Qué tan bien mantiene la trazada, 0..1. */
  precision: number;
  /** Probabilidad por segundo de intentar derrapar en una curva cerrada. */
  driftSkill: number;
  /** Segundos que tarda en usar el poder que agarró. */
  itemDelay: number;
  /** Amplitud del vaivén que le mete al volante para que no vaya en riel. */
  wobble: number;
}

export const DIFFICULTIES: Record<Difficulty, DifficultySpec> = {
  facil: {
    id: 'facil',
    label: 'Fácil',
    pace: 0.6,
    caution: 55,
    precision: 0.55,
    driftSkill: 0.05,
    itemDelay: 3.2,
    wobble: 0.16,
  },
  normal: {
    id: 'normal',
    label: 'Normal',
    pace: 0.82,
    caution: 38,
    precision: 0.8,
    driftSkill: 0.12,
    itemDelay: 1.8,
    wobble: 0.09,
  },
  dificil: {
    id: 'dificil',
    label: 'Difícil',
    pace: 1,
    caution: 28,
    precision: 0.95,
    // El derrape de la IA se usa con cuentagotas: mientras derrapa, el volante
    // sólo abre o cierra el arco y no puede corregir la trazada, así que un
    // rival que derrapa todo el tiempo termina yendo más lento, no más rápido.
    driftSkill: 0.25,
    itemDelay: 0.8,
    wobble: 0.04,
  },
};

export const DIFFICULTY_ORDER: Difficulty[] = ['facil', 'normal', 'dificil'];

/**
 * Piloto automático de los rivales.
 *
 * Produce el mismo `InputState` que produciría un jugador con el teclado, así
 * que corre exactamente la misma física: no tiene velocidad extra ni agarre
 * extra, y lo único que cambia entre dificultades es cómo maneja. Eso evita el
 * rival que va en riel y es imposible de pasar.
 */
export class AiDriver {
  private readonly spec: DifficultySpec;
  private readonly rng: () => number;
  private readonly phase: number;
  private time = 0;
  private driftHold = 0;

  private readonly state: InputState = {
    throttle: 0,
    brake: 0,
    steer: 0,
    drift: false,
    driftPressed: false,
    reset: false,
    usePressed: false,
  };

  constructor(difficulty: DifficultySpec, seed: string) {
    this.spec = difficulty;
    this.rng = makeRng(seed);
    this.phase = this.rng() * Math.PI * 2;
  }

  update(dt: number, racer: Racer): InputState {
    this.time += dt;
    const s = this.state;
    const p = racer.physics;
    const proj = p.projection;

    // --- Dirección: apuntar a la tangente del trazado y recentrarse ---
    const heading = yawOf(p.forward);
    const desired = yawOf(proj.tangent);
    const toTangent = steerToward(heading, desired);

    // Trazada: en vez de ir por el centro, apunta al interior de la curva.
    // Curvatura positiva = curva a la derecha, y el interior de una curva a la
    // derecha es el lado derecho, o sea lateral positivo. Con el signo al revés
    // el rival más "preciso" se abría en todas las curvas y terminaba siendo el
    // más lento.
    const apex = Math.sign(proj.curvature) * Math.min(1, Math.abs(proj.curvature) * 55);
    const targetLateral = apex * proj.halfWidth * 0.55 * this.spec.precision;
    const centering = (targetLateral - proj.lateral) / Math.max(proj.halfWidth, 1);

    const wobble = Math.sin(this.time * 1.7 + this.phase) * this.spec.wobble;
    s.steer = clamp(toTangent * 2.6 + centering * 0.7 + wobble, -1, 1);

    // --- Acelerador: levanta el pie según lo cerrada que sea la curva ---
    const lift = Math.abs(proj.curvature) * this.spec.caution;
    s.throttle = clamp(this.spec.pace * (1 - lift), 0.28, 1);
    s.brake = 0;

    // Si viene muy cruzado respecto del trazado, frena en vez de insistir.
    if (Math.abs(toTangent) > 1.1) {
      s.throttle = 0.25;
      s.brake = 0.4;
    }

    // Si se fue al pasto, lo único que importa es volver.
    if (proj.offTrack) {
      s.throttle = clamp(s.throttle, 0.5, 1);
      s.steer = clamp(s.steer + Math.sign(-proj.lateral) * 0.35, -1, 1);
    }

    // --- Derrape en las curvas cerradas ---
    const tightCorner = Math.abs(proj.curvature) > 0.013;
    const speed = Math.hypot(p.velocity.x, p.velocity.z);
    if (tightCorner && speed > 16 && this.rng() < this.spec.driftSkill * dt * 4) {
      this.driftHold = 0.9 + this.rng() * 0.8;
    }
    if (!tightCorner) this.driftHold = Math.min(this.driftHold, 0.25);
    const wasDrifting = s.drift;
    this.driftHold = Math.max(0, this.driftHold - dt);
    s.drift = this.driftHold > 0;
    s.driftPressed = s.drift && !wasDrifting;

    s.reset = false;
    return s;
  }

  /** ¿Ya puede usar el poder que tiene en mano? */
  shouldUseItem(racer: Racer, dt: number): boolean {
    if (!racer.item) return false;
    racer.itemCooldown -= dt;
    if (racer.itemCooldown > 0) return false;
    racer.itemCooldown = this.spec.itemDelay;
    return true;
  }

  /** Demora inicial al agarrar un poder, para que no lo dispare al instante. */
  get itemDelay(): number {
    return this.spec.itemDelay;
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
