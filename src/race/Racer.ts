import * as THREE from 'three';
import type { CharacterSpec } from '../characters/CharacterSpec';
import type { InputState } from '../core/Input';
import { KartPhysics, type KartTelemetry } from '../kart/KartPhysics';
import { KartView } from '../kart/KartView';
import type { ItemId } from '../items/ItemTypes';
import type { TrackPath } from '../track/TrackPath';
import { LapTracker } from './LapTracker';

/**
 * Un kart en carrera: física, modelo, vueltas y poder en mano.
 *
 * El jugador y los rivales son el mismo objeto; lo único que cambia es de dónde
 * sale el `InputState` de cada frame. Eso mantiene una sola física para todos
 * —nadie hace trampa— y es también lo que va a permitir que en el modo online
 * un rival sea simplemente un Racer cuyo input llega por la red.
 */
export class Racer {
  readonly id: number;
  readonly character: CharacterSpec;
  readonly name: string;
  /**
   * ¿Lo maneja esta máquina?
   *
   * No es de sólo lectura porque en una partida en red cambia: el anfitrión le
   * asigna a cada invitado un kart de la parrilla, y en la pantalla de ese
   * invitado el kart que le tocó pasa a ser el suyo mientras el que era suyo
   * pasa a ser uno más. De eso dependen la cámara, el HUD y el cartel del final.
   */
  isPlayer: boolean;
  readonly physics: KartPhysics;
  readonly view: KartView;
  readonly laps: LapTracker;

  /** Poder en mano, o null. Sólo se guarda uno. */
  item: ItemId | null = null;
  /** Posición en carrera, 1 = puntero. La calcula el director. */
  position = 1;
  /** Segundos que faltan para que la IA use el poder que tiene. */
  itemCooldown = 0;

  /** Nunca es null: arranca con la instantánea del estado en la parrilla. */
  telemetry: KartTelemetry;

  constructor(options: {
    id: number;
    character: CharacterSpec;
    name: string;
    isPlayer: boolean;
    path: TrackPath;
    startSlot: number;
    totalLaps?: number;
  }) {
    this.id = options.id;
    this.character = options.character;
    this.name = options.name;
    this.isPlayer = options.isPlayer;
    this.physics = new KartPhysics(options.path, options.startSlot);
    this.view = new KartView(options.character);
    this.laps = new LapTracker(options.path, options.totalLaps);
    this.telemetry = this.physics.snapshot();
  }

  get position3(): THREE.Vector3 {
    return this.physics.position;
  }

  get finished(): boolean {
    return this.laps.finished;
  }

  step(dt: number, input: InputState, racing: boolean): void {
    this.telemetry = this.physics.update(dt, input);
    this.laps.update(dt, this.telemetry.projection, racing);
  }

  sync(dt: number): void {
    this.view.sync(this.physics, dt);
  }

  dispose(): void {
    this.view.dispose();
  }
}
