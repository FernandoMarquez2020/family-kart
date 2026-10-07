import * as THREE from 'three';
import type { Racer } from './Racer';

/**
 * Choques entre karts.
 *
 * Cada kart es un círculo en el plano horizontal. Al superponerse se los separa
 * y se intercambia parte de la velocidad, así que el que viene más rápido
 * empuja al de adelante y ninguno puede atravesar a otro.
 *
 * Se resuelve en el mismo paso fijo que la física y sin números aleatorios, de
 * modo que dos partidas con los mismos inputs den el mismo resultado: es lo que
 * va a permitir que el servidor y el cliente coincidan en el modo online.
 */

/** Radio de colisión, en metros. El chasis mide 1,5 × 2,3. */
export const KART_RADIUS = 1.25;

/** Cuánto rebotan: 0 = quedan pegados, 1 = rebote perfecto. */
const RESTITUTION = 0.35;

/**
 * Cuánta velocidad de acercamiento se convierte en empuje en vez de perderse.
 * Por encima de 0 el de atrás arrastra al de adelante, que es lo que hace que
 * los toques se sientan como toques y no como una pared.
 */
const PUSH = 0.55;

/** Pérdida de velocidad del que choca, para que chocar no salga gratis. */
const SCRUB = 0.08;

/** Velocidad de acercamiento (m/s) a la que el raspón pega completo. */
const SCRUB_FULL_IMPACT = 6;

/**
 * Por debajo de esta velocidad de acercamiento (m/s) el contacto se considera
 * apoyo, no choque: se separan y nada más.
 */
const RESTING_APPROACH = 0.4;

/**
 * Pasadas de relajación. Con varios karts apretados, separar de a pares una
 * sola vez deja superposiciones residuales; dos pasadas alcanzan.
 */
const ITERATIONS = 2;

const normal = new THREE.Vector3();
const relative = new THREE.Vector3();

export interface CollisionEvent {
  a: Racer;
  b: Racer;
  /** Velocidad de acercamiento en el momento del impacto, m/s. */
  impact: number;
}

/**
 * Separa los karts superpuestos. Devuelve los choques detectados, para que el
 * HUD pueda avisar cuando al jugador lo tocan.
 */
export function resolveKartCollisions(racers: Racer[]): CollisionEvent[] {
  const events: CollisionEvent[] = [];
  if (racers.length < 2) return events;

  const minDistance = KART_RADIUS * 2;

  for (let pass = 0; pass < ITERATIONS; pass++) {
    for (let i = 0; i < racers.length; i++) {
      for (let j = i + 1; j < racers.length; j++) {
        const a = racers[i].physics;
        const b = racers[j].physics;

        normal.set(b.position.x - a.position.x, 0, b.position.z - a.position.z);
        const distance = normal.length();
        if (distance >= minDistance) continue;

        // Dos karts exactamente en el mismo punto no tienen dirección de
        // separación; los apartamos a lo largo del eje X para no dividir por
        // cero ni dejarlos encimados para siempre.
        if (distance < 1e-4) normal.set(1, 0, 0);
        else normal.divideScalar(distance);

        const overlap = minDistance - distance;
        a.position.addScaledVector(normal, -overlap / 2);
        b.position.addScaledVector(normal, overlap / 2);

        // Las pasadas extra sólo re-separan. Si también repitieran el impulso y
        // el raspón, dos karts que van pegados se frenarían dos veces por paso.
        if (pass > 0) continue;

        relative.subVectors(b.velocity, a.velocity);
        const approach = relative.dot(normal);
        // Si ya se están separando —o apenas se rozan— no hace falta impulso.
        // El umbral es lo que distingue un choque de un contacto sostenido: sin
        // él, dos karts que van lado a lado quedaban frenándose cada paso fijo
        // (120 veces por segundo) hasta pararse del todo.
        if (approach > -RESTING_APPROACH) continue;

        // Impulso simétrico: misma masa para todos, así nadie tiene ventaja por
        // ser un personaje u otro.
        const impulse = (-(1 + RESTITUTION) * approach) / 2;
        a.velocity.addScaledVector(normal, -impulse * PUSH);
        b.velocity.addScaledVector(normal, impulse * PUSH);

        // Un poco de raspón, proporcional al golpe: un toque suave no cuesta
        // casi nada y un impacto fuerte sí.
        const scrub = 1 - SCRUB * Math.min(1, -approach / SCRUB_FULL_IMPACT);
        a.velocity.multiplyScalar(scrub);
        b.velocity.multiplyScalar(scrub);

        events.push({ a: racers[i], b: racers[j], impact: -approach });
      }
    }
  }

  return events;
}
