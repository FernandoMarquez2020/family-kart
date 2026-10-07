import type { Racer } from './Racer';

export type RacePhase = 'countdown' | 'racing' | 'finished';

export interface RaceResult {
  racerId: number;
  name: string;
  position: number;
  /** Tiempo total; null si no terminó. */
  time: number | null;
  /** Metros que le faltaban respecto del ganador, si no terminó. */
  gap: number | null;
  bestLap: number | null;
  isPlayer: boolean;
}

/**
 * Coordina la carrera: cuenta regresiva, orden de los karts y llegada.
 *
 * El orden sale de `totalProgress` (metros recorridos sumando vueltas), que es
 * una sola magnitud comparable entre todos y no depende de dónde esté cada uno
 * en el mapa. Es también la métrica que se sincronizará en el modo online.
 */
export class RaceDirector {
  phase: RacePhase = 'countdown';
  countdown: number;
  /** Segundos desde la largada. */
  clock = 0;

  private readonly racers: Racer[];
  private readonly finishOrder: Racer[] = [];

  onFinish: ((results: RaceResult[]) => void) | null = null;
  onPlayerFinish: ((position: number) => void) | null = null;

  constructor(racers: Racer[], countdownSeconds = 3.5) {
    this.racers = racers;
    this.countdown = countdownSeconds;
    for (const racer of racers) {
      racer.laps.onFinish = () => this.registerFinish(racer);
    }
    this.updateStandings();
  }

  get racing(): boolean {
    return this.phase === 'racing';
  }

  get player(): Racer {
    return this.racers.find((r) => r.isPlayer) ?? this.racers[0];
  }

  step(dt: number): void {
    if (this.phase === 'countdown') {
      this.countdown = Math.max(0, this.countdown - dt);
      if (this.countdown === 0) this.phase = 'racing';
      return;
    }
    if (this.phase !== 'racing') return;

    this.clock += dt;
    this.updateStandings();

    // La carrera termina cuando cruza el jugador; a los rivales que quedaban en
    // pista se les cierra la clasificación con el orden en que iban. Esperar a
    // que lleguen todos sólo alarga la espera sin cambiar nada.
    if (this.player.finished || this.racers.every((r) => r.finished)) {
      this.phase = 'finished';
      this.onFinish?.(this.results());
    }
  }

  /** Recalcula la posición de cada kart. 1 = puntero. */
  updateStandings(): void {
    const order = [...this.racers].sort((a, b) => {
      // Los que ya llegaron van primero, por orden de llegada.
      const ai = this.finishOrder.indexOf(a);
      const bi = this.finishOrder.indexOf(b);
      if (ai !== -1 || bi !== -1) {
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      }
      return b.laps.totalProgress - a.laps.totalProgress;
    });
    order.forEach((racer, i) => {
      racer.position = i + 1;
    });
  }

  private registerFinish(racer: Racer): void {
    if (!this.finishOrder.includes(racer)) this.finishOrder.push(racer);
    this.updateStandings();
    if (racer.isPlayer) this.onPlayerFinish?.(racer.position);
  }

  results(): RaceResult[] {
    this.updateStandings();
    const ordered = [...this.racers].sort((a, b) => a.position - b.position);
    // La carrera se corta cuando llega el jugador, así que casi siempre queda
    // gente en pista. En vez de dejarles el tiempo en blanco mostramos cuánto
    // les faltaba: es un dato real y se lee de un vistazo.
    const leader = ordered[0]?.laps.totalProgress ?? 0;
    return ordered.map((racer) => ({
      racerId: racer.id,
      name: racer.name,
      position: racer.position,
      time: racer.laps.finishTime,
      gap: racer.laps.finishTime === null ? Math.max(0, leader - racer.laps.totalProgress) : null,
      bestLap: racer.laps.bestLapTime,
      isPlayer: racer.isPlayer,
    }));
  }
}

/** Puntos por posición, estilo campeonato. */
export const TOURNAMENT_POINTS = [10, 8, 6, 5, 4, 3, 2, 1];

export function pointsFor(position: number): number {
  return TOURNAMENT_POINTS[position - 1] ?? 0;
}
