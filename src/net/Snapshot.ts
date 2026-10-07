import type { Racer } from '../race/Racer';

/**
 * El estado de un kart, tal como viaja por la red.
 *
 * Es deliberadamente chico. En una partida a seis, el anfitrión manda esto por
 * cada kart veinte veces por segundo, y cada campo de más se multiplica por
 * ciento veinte. Sólo va lo que el otro lado no puede deducir: dónde está, hacia
 * dónde mira, a qué velocidad y en qué estado especial. Todo lo que se puede
 * recalcular —la proyección sobre la pista, la inclinación del modelo, las
 * chispas del derrape— se recalcula del otro lado y no se manda.
 *
 * Los nombres son de una letra por la misma razón: el canal manda JSON, y
 * "position" contra "p" es diez bytes por kart por paquete, o sea unos doce
 * kilobytes por minuto de nada.
 */
export interface KartSnapshot {
  /** id del corredor */
  i: number;
  /** posición */
  x: number;
  y: number;
  z: number;
  /** velocidad */
  vx: number;
  vy: number;
  vz: number;
  /** rumbo */
  a: number;
  /** derrape visual y alabeo, que no se pueden deducir del resto */
  d: number;
  /** turbo restante */
  b: number;
  /** trompo restante */
  s: number;
  /** vuelta y progreso, para el puesto y el minimapa */
  l: number;
  /** poder en mano, o null */
  it: string | null;
}

export interface WorldSnapshot {
  /** Tick de simulación del anfitrión al armar esta foto. */
  t: number;
  /** Fase de la carrera y cuenta regresiva. */
  ph: string;
  cd: number;
  karts: KartSnapshot[];
}

export function captureKart(racer: Racer): KartSnapshot {
  const p = racer.physics;
  return {
    i: racer.id,
    x: round(p.position.x),
    y: round(p.position.y),
    z: round(p.position.z),
    vx: round(p.velocity.x),
    vy: round(p.velocity.y),
    vz: round(p.velocity.z),
    a: round(p.yaw, 4),
    d: round(p.visualDriftYaw, 3),
    b: round(p.boostTime, 2),
    s: round(p.spinTime, 2),
    l: racer.laps.lap,
    it: racer.item,
  };
}

/**
 * Aplica la foto del anfitrión sobre un kart local.
 *
 * `blend` decide cuánto se le hace caso. En 1 el kart salta exactamente a donde
 * dice el anfitrión, y a veinte paquetes por segundo eso se ve como un temblor
 * permanente. Con un valor bajo el kart se va corrigiendo hacia la verdad
 * mientras su propia física lo sigue moviendo, y el movimiento queda continuo:
 * es la diferencia entre ver una carrera y ver una sucesión de posiciones.
 *
 * Lo que NO se interpola es el salto grande. Si la diferencia pasa de unos
 * metros —el otro chocó, lo dio vuelta un misil, o se cortó la conexión un
 * segundo— corregir de a poco tardaría segundos y mientras tanto el kart estaría
 * atravesando paredes. Ahí conviene el salto seco: se nota un frame, y después
 * todo vuelve a estar bien.
 */
export function applyKart(racer: Racer, snap: KartSnapshot, blend: number): void {
  const p = racer.physics;
  const far =
    Math.abs(p.position.x - snap.x) > 4 ||
    Math.abs(p.position.z - snap.z) > 4 ||
    Math.abs(p.position.y - snap.y) > 3;
  const k = far ? 1 : blend;

  p.position.x += (snap.x - p.position.x) * k;
  p.position.y += (snap.y - p.position.y) * k;
  p.position.z += (snap.z - p.position.z) * k;

  p.velocity.x += (snap.vx - p.velocity.x) * k;
  p.velocity.y += (snap.vy - p.velocity.y) * k;
  p.velocity.z += (snap.vz - p.velocity.z) * k;

  // El rumbo se corrige por el camino corto: sin normalizar, un kart que pasa de
  // 179° a -179° gira 358 grados para el otro lado.
  let turn = snap.a - p.yaw;
  while (turn > Math.PI) turn -= Math.PI * 2;
  while (turn < -Math.PI) turn += Math.PI * 2;
  p.yaw += turn * k;

  p.visualDriftYaw += (snap.d - p.visualDriftYaw) * k;
  p.boostTime = snap.b;
  p.spinTime = snap.s;
  racer.item = snap.it as Racer['item'];
}

function round(value: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
