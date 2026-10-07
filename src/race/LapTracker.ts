import type { TrackPath, TrackProjection } from '../track/TrackPath';

/**
 * Vueltas, sectores y cronómetro de UN kart.
 *
 * Los checkpoints son sectores consecutivos del trazado y hay que pasarlos en
 * orden: eso hace que cortar camino o volver atrás no sume vuelta, sin
 * necesidad de colisionadores en la escena.
 */
export class LapTracker {
  readonly totalLaps: number;
  readonly checkpointCount: number;

  lap = 1;
  raceTime = 0;
  lapTime = 0;
  lastLapTime: number | null = null;
  bestLapTime: number | null = null;
  readonly lapTimes: number[] = [];
  finished = false;
  /** Tiempo total al cruzar la meta en la última vuelta. */
  finishTime: number | null = null;

  /** Avance absoluto en metros desde la largada, sumando vueltas. */
  totalProgress = 0;

  private nextCheckpoint = 1;
  private readonly trackLength: number;

  onLapComplete: ((lap: number, time: number) => void) | null = null;
  onFinish: ((totalTime: number) => void) | null = null;

  constructor(path: TrackPath, totalLaps = path.spec.laps) {
    this.totalLaps = totalLaps;
    this.checkpointCount = path.spec.checkpoints;
    this.trackLength = path.totalLength;
  }

  /**
   * @param running false durante la cuenta regresiva: el reloj no tiene que
   * correr antes de la largada, o los 3,5 s de la cuenta se sumaban al tiempo
   * de la primera vuelta.
   */
  update(dt: number, projection: TrackProjection, running: boolean): void {
    if (running && !this.finished) {
      this.raceTime += dt;
      this.lapTime += dt;
      this.checkProgress(projection);
    }
    this.totalProgress = (this.lap - 1) * this.trackLength + projection.distance;
  }

  /** Vuelve al estado de largada, sin rehacer la escena. */
  reset(): void {
    this.lap = 1;
    this.raceTime = 0;
    this.lapTime = 0;
    this.lastLapTime = null;
    this.bestLapTime = null;
    this.lapTimes.length = 0;
    this.finished = false;
    this.finishTime = null;
    this.nextCheckpoint = 1;
  }

  private checkProgress(projection: TrackProjection): void {
    const n = this.checkpointCount;
    const sector = ((Math.floor(projection.t * n) % n) + n) % n;
    if (sector !== this.nextCheckpoint) return;
    if (sector === 0) this.completeLap();
    this.nextCheckpoint = (sector + 1) % n;
  }

  private completeLap(): void {
    const time = this.lapTime;
    this.lapTimes.push(time);
    this.lastLapTime = time;
    if (this.bestLapTime === null || time < this.bestLapTime) this.bestLapTime = time;
    this.lapTime = 0;
    this.onLapComplete?.(this.lap, time);

    if (this.lap >= this.totalLaps) {
      this.finished = true;
      this.finishTime = this.raceTime;
      this.onFinish?.(this.raceTime);
    } else {
      this.lap++;
    }
  }
}

/** Formatea segundos como m:ss.cc, el formato habitual de los tiempos de vuelta. */
export function formatTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '--:--.--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
