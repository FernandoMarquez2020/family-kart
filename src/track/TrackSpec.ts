import * as THREE from 'three';
import type { ThemeId } from './themes';

/**
 * Definición declarativa de un circuito.
 *
 * Toda la geometría de la pista se deriva de este objeto, así que una "pista
 * personalizada por jugador" es simplemente un TrackSpec distinto. Por ahora lo
 * generamos desde una semilla de texto (el nombre del jugador); más adelante el
 * mismo tipo puede venir de un editor de pistas o del servidor.
 */
export interface TrackSpec {
  /** Nombre visible del circuito. */
  name: string;
  /** Semilla original de la que se derivó (para reproducir el mismo trazado). */
  seed: string;
  /** Tema visual: decide colores, cielo, luz y decorados. */
  theme: ThemeId;
  /** Radio medio del circuito, en metros. */
  radius: number;
  /** Armónicos radiales: deforman el círculo base en curvas rápidas y lentas. */
  harmonics: Harmonic[];
  /** Armónicos de elevación: generan subidas y bajadas. */
  elevation: Harmonic[];
  /** Semiancho del asfalto en metros (la pista mide el doble). */
  halfWidth: number;
  /** Variación del ancho a lo largo del trazado, 0 = ancho constante. */
  widthVariation: number;
  /** Cuánto peralta las curvas, en radianes de inclinación máxima. */
  banking: number;
  /** Cantidad de vueltas de la carrera. */
  laps: number;
  /** Cantidad de checkpoints (sectores) en los que se divide el trazado. */
  checkpoints: number;
}

export interface Harmonic {
  /** Frecuencia angular: cuántas ondulaciones da en toda la vuelta. */
  freq: number;
  /** Amplitud, relativa al radio (o en metros, para la elevación). */
  amp: number;
  /** Desfase en radianes. */
  phase: number;
}

/**
 * Distancia desde el borde del asfalto hasta la barrera exterior, en metros.
 *
 * Vive acá porque la usan los dos lados: la física, para frenar al kart, y la
 * malla, para dibujar el muro justo ahí. Si sólo la supiera la física, el
 * jugador chocaría contra una pared invisible.
 */
export const BARRIER_OFFSET = 26;

/** Perfil de la banquina: dónde empieza, cuánto mide y cuánto baja hacia afuera. */
export const SHOULDER_INNER = 1.5;
export const SHOULDER_WIDTH = 45;
export const SHOULDER_DROP = 3.5;

/**
 * Altura de la banquina a una distancia dada del borde del asfalto.
 *
 * La usan la malla de la banquina, el muro y los decorados: si cada uno
 * calculara su propia altura, las cosas quedarían flotando o enterradas.
 */
export function shoulderLift(offsetFromEdge: number): number {
  const t = Math.min(
    1,
    Math.max(0, (offsetFromEdge - SHOULDER_INNER) / (SHOULDER_WIDTH - SHOULDER_INNER)),
  );
  return -SHOULDER_DROP * t;
}

/** PRNG determinista (mulberry32): misma semilla, misma pista, siempre. */
export function makeRng(seedText: string): () => number {
  let h = 1779033703 ^ seedText.length;
  for (let i = 0; i < seedText.length; i++) {
    h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CIRCUIT_SUFFIXES = [
  'Ring',
  'Speedway',
  'Circuit',
  'Raceway',
  'Loop',
  'Park',
  'Coast',
  'Valley',
];

export interface TrackOptions {
  /** Tema visual del circuito. Por defecto, el de bloques. */
  theme?: ThemeId;
  /** Nombre visible; si no se pasa, se deriva de la semilla. */
  name?: string;
  /** Ajustes finos sobre el trazado generado (para dar carácter a cada pista). */
  overrides?: Partial<Omit<TrackSpec, 'harmonics' | 'elevation'>>;
}

/**
 * Genera un circuito a partir de un texto.
 *
 * Usamos una curva radial r(θ) = R · (1 + Σ aᵢ·sin(fᵢθ + pᵢ)) con amplitudes
 * acotadas. Mientras Σ|aᵢ| < 1 el radio nunca se anula ni se invierte, así que
 * el trazado es siempre una curva cerrada simple: no se cruza a sí misma y no
 * hace falta validarlo después.
 */
export function generateTrackSpec(seedText: string, options: TrackOptions = {}): TrackSpec {
  const seed = seedText.trim() || 'Kart Royale';
  const rng = makeRng(seed);

  // Tres armónicos con frecuencias distintas dan rectas largas, curvas amplias
  // y horquillas, sin repetirse.
  const freqA = 2 + Math.floor(rng() * 2); // 2..3
  const freqB = freqA + 1 + Math.floor(rng() * 2); // 3..5
  const freqC = freqB + 2 + Math.floor(rng() * 3); // 5..9

  const harmonics: Harmonic[] = [
    { freq: freqA, amp: 0.16 + rng() * 0.1, phase: rng() * Math.PI * 2 },
    { freq: freqB, amp: 0.07 + rng() * 0.07, phase: rng() * Math.PI * 2 },
    { freq: freqC, amp: 0.025 + rng() * 0.035, phase: rng() * Math.PI * 2 },
  ];

  const elevation: Harmonic[] = [
    { freq: 1 + Math.floor(rng() * 2), amp: 5 + rng() * 9, phase: rng() * Math.PI * 2 },
    { freq: 3 + Math.floor(rng() * 3), amp: 1.5 + rng() * 3, phase: rng() * Math.PI * 2 },
  ];

  const suffix = CIRCUIT_SUFFIXES[Math.floor(rng() * CIRCUIT_SUFFIXES.length)];
  const displaySeed = seed.charAt(0).toUpperCase() + seed.slice(1);

  return {
    name: options.name ?? `${displaySeed} ${suffix}`,
    seed,
    theme: options.theme ?? 'bloques',
    radius: 170 + rng() * 70,
    harmonics,
    elevation,
    halfWidth: 7.5 + rng() * 2.5,
    widthVariation: 0.12 + rng() * 0.12,
    banking: 0.1 + rng() * 0.12,
    laps: 3,
    checkpoints: 24,
    ...options.overrides,
  };
}

/** Puntos de control de la línea central, listos para una Catmull-Rom cerrada. */
export function buildControlPoints(spec: TrackSpec, count = 96): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < count; i++) {
    const theta = (i / count) * Math.PI * 2;
    let r = 1;
    for (const h of spec.harmonics) r += h.amp * Math.sin(h.freq * theta + h.phase);
    r *= spec.radius;

    let y = 0;
    for (const h of spec.elevation) y += h.amp * Math.sin(h.freq * theta + h.phase);

    points.push(new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r));
  }
  return points;
}

/** Semiancho del asfalto en el parámetro t (0..1) del trazado. */
export function halfWidthAt(spec: TrackSpec, t: number): number {
  const theta = t * Math.PI * 2;
  const wobble = Math.sin(theta * 3 + 0.7) * 0.6 + Math.sin(theta * 7 + 2.1) * 0.4;
  return spec.halfWidth * (1 + spec.widthVariation * wobble);
}
