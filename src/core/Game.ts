import * as THREE from 'three';
import { Input } from './Input';
import type { RaceConfig } from './GameConfig';
import { getCharacter } from '../characters/CharacterSpec';
import { ItemSystem, type ItemEvent } from '../items/ItemSystem';
import { AiDriver, DIFFICULTIES } from '../race/AiDriver';
import { resolveKartCollisions } from '../race/Collisions';
import { buildGrid } from '../race/Grid';
import { formatTime } from '../race/LapTracker';
import { RaceDirector, type RaceResult } from '../race/RaceDirector';
import { Racer } from '../race/Racer';
import {
  AiController,
  LocalController,
  NEUTRAL_INPUT,
  type Controller,
} from '../net/Controller';
import { applyKart, captureKart, type WorldSnapshot } from '../net/Snapshot';
import { TrackPath } from '../track/TrackPath';
import { buildTrackMesh } from '../track/TrackMesh';
import { generateTrackSpec } from '../track/TrackSpec';
import { ThemeAnimations } from '../track/animations';
import { THEMES, type ThemePalette } from '../track/themes';
import { ChaseCamera } from '../view/ChaseCamera';
import { Hud } from '../view/Hud';
import { buildSky } from '../view/Sky';

/**
 * Paso fijo de simulación.
 *
 * La física avanza siempre en pasos de 1/120 s, independientemente de los FPS.
 * Eso hace que el manejo se sienta igual en una notebook y en un monitor de
 * 144 Hz, y —más importante para lo que viene— la vuelve determinista, que es
 * el requisito para poder reproducir y reconciliar los estados en el modo
 * online.
 */
const FIXED_STEP = 1 / 120;
const MAX_STEPS_PER_FRAME = 8;

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly path: TrackPath;
  readonly palette: ThemePalette;
  readonly config: RaceConfig;
  readonly racers: Racer[] = [];
  readonly director: RaceDirector;
  readonly items: ItemSystem;
  readonly chase: ChaseCamera;
  readonly input = new Input();
  readonly hud: Hud;
  readonly animations: ThemeAnimations;

  /** Se dispara al terminar la carrera, con la clasificación final. */
  onRaceFinished: ((results: RaceResult[]) => void) | null = null;
  /**
   * Se dispara una vez por frame, después de avanzar la simulación.
   *
   * Es el enganche de la red, y va DESPUÉS del paso de física a propósito: el
   * anfitrión tiene que mandar el mundo como quedó en este frame, no como estaba
   * antes de moverlo.
   */
  onNetTick: ((dt: number) => void) | null = null;

  private readonly canvas: HTMLCanvasElement;
  private readonly sun: THREE.DirectionalLight;
  private readonly ai = new Map<number, AiDriver>();
  /** Quién maneja cada kart: el teclado de acá, la máquina, o alguien por red. */
  private readonly controllers = new Map<number, Controller>();
  /** Pasos de simulación dados desde la largada. Lo usa la red para ordenar. */
  private tick = 0;
  private accumulator = 0;
  private lastTime = 0;
  private frameHandle = 0;
  private running = false;

  constructor(canvas: HTMLCanvasElement, config: RaceConfig) {
    this.canvas = canvas;
    this.config = config;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // --- Pista ---
    const trackCharacter = getCharacter(config.trackCharacterId);
    const spec = generateTrackSpec(trackCharacter.trackSeed, {
      theme: trackCharacter.theme,
      name: trackCharacter.trackName,
      overrides: { ...trackCharacter.trackOverrides, laps: config.laps },
    });
    this.path = new TrackPath(spec);
    this.palette = THEMES[spec.theme];

    this.scene.fog = new THREE.Fog(this.palette.fog, this.palette.fogNear, this.palette.fogFar);
    this.scene.add(buildSky(this.palette));
    this.scene.add(buildTrackMesh(this.path));

    this.animations = new ThemeAnimations(this.path, this.palette);
    this.scene.add(this.animations.group);

    this.scene.add(
      new THREE.HemisphereLight(
        this.palette.hemiSky,
        this.palette.hemiGround,
        this.palette.hemiIntensity,
      ),
    );
    this.sun = new THREE.DirectionalLight(this.palette.sunColor, this.palette.sunIntensity);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 220;
    const shadowBox = this.sun.shadow.camera as THREE.OrthographicCamera;
    shadowBox.left = -55;
    shadowBox.right = 55;
    shadowBox.top = 55;
    shadowBox.bottom = -55;
    shadowBox.updateProjectionMatrix();
    this.scene.add(this.sun, this.sun.target);

    // --- Karts ---
    const grid = buildGrid(config.characterId, config.racerCount);
    const difficulty = DIFFICULTIES[config.difficulty];
    grid.forEach((entry, i) => {
      const racer = new Racer({
        id: i,
        character: entry.character,
        name: entry.name,
        isPlayer: entry.isPlayer,
        path: this.path,
        startSlot: i,
        totalLaps: config.laps,
      });
      this.scene.add(racer.view.group);
      this.racers.push(racer);
      if (entry.isPlayer) {
        this.controllers.set(racer.id, new LocalController(() => this.input.state));
      } else {
        const driver = new AiDriver(difficulty, `${spec.seed}:${entry.character.id}:${i}`);
        this.ai.set(racer.id, driver);
        this.controllers.set(racer.id, new AiController(driver));
      }
    });

    // --- Poderes y rampas ---
    this.items = new ItemSystem(this.path, hashSeed(spec.seed));
    this.scene.add(this.items.group);

    // --- Carrera ---
    this.director = new RaceDirector(this.racers);
    this.chase = new ChaseCamera(canvas.clientWidth / Math.max(1, canvas.clientHeight));
    this.hud = new Hud(document);
    this.hud.buildMinimap(this.path, this.palette);
    this.hud.show(config, this.racers.length);

    this.wireEvents();

    this.input.attach();
    window.addEventListener('resize', this.onResize);
    this.onResize();

    for (const racer of this.racers) racer.sync(FIXED_STEP);
    this.chase.snapTo(this.player.physics);
  }

  /** Pasos de simulación dados. La red los usa para ordenar lo que llega. */
  get currentTick(): number {
    return this.tick;
  }

  /**
   * Cambia quién maneja un kart, en caliente.
   *
   * Es todo lo que el modo online necesita del juego: cuando entra alguien a la
   * sala, su kart deja de manejarlo la IA y pasa a manejarlo lo que llega por el
   * canal de datos; si se va, vuelve la IA y la carrera sigue sin cortarse.
   */
  setController(racerId: number, controller: Controller): void {
    this.controllers.get(racerId)?.dispose?.();
    this.controllers.set(racerId, controller);
  }

  /**
   * Cambia cuál de los karts es el de esta máquina.
   *
   * En una partida en red, el anfitrión reparte la parrilla: al que entra le
   * toca el kart 1, al siguiente el 2. Pero en la pantalla de ese invitado el
   * juego se armó con él en el kart 0, como en cualquier partida solitaria. Si
   * no se corrige, el invitado maneja un kart y el anfitrión mueve otro — los
   * dos se ven corriendo, cada uno en su pantalla, sin tocarse nunca.
   *
   * De este marcador cuelgan la cámara, el HUD y el resultado final, así que
   * alcanza con moverlo para que todo lo demás siga al kart correcto.
   */
  setLocalRacer(id: number): void {
    for (const racer of this.racers) racer.isPlayer = racer.id === id;
    this.controllers.set(id, new LocalController(() => this.input.state));
    this.chase.snapTo(this.player.physics);
  }

  /** Devuelve el kart a la máquina. Se usa cuando un invitado se desconecta. */
  releaseController(racerId: number): void {
    const driver = this.ai.get(racerId);
    if (driver) this.setController(racerId, new AiController(driver));
  }

  /** Foto del mundo, para que el anfitrión se la mande a los invitados. */
  snapshot(): WorldSnapshot {
    return {
      t: this.tick,
      ph: this.director.phase,
      cd: Math.round(this.director.countdown * 100) / 100,
      karts: this.racers.map(captureKart),
    };
  }

  /**
   * Acepta la foto del anfitrión.
   *
   * `except` es el kart de este jugador, que NO se corrige: el jugador ya lo
   * está simulando con sus propias teclas y sin retraso. Pisarle la posición con
   * la que llega de la red —que describe cómo estaba hace media vuelta de
   * ping— es exactamente lo que hace que un juego en red se sienta elástico.
   */
  applySnapshot(snap: WorldSnapshot, except: number, blend = 0.22): void {
    this.director.phase = snap.ph as typeof this.director.phase;
    this.director.countdown = snap.cd;
    for (const kart of snap.karts) {
      if (kart.i === except) continue;
      const racer = this.racers[kart.i];
      if (racer) applyKart(racer, kart, blend);
    }
  }

  /** ¿Está corriendo el bucle de render? Falso mientras las opciones pausan. */
  get isRunning(): boolean {
    return this.running;
  }

  get player(): Racer {
    return this.director.player;
  }

  get trackName(): string {
    return this.path.spec.name;
  }

  private wireEvents(): void {
    this.player.laps.onLapComplete = (lap, time) => {
      this.hud.flash(`VUELTA ${lap}  ${formatTime(time)}`, 1.8);
    };

    this.items.onEvent = (event: ItemEvent) => {
      if (!event.racer.isPlayer) {
        // De los rivales sólo avisamos lo que le pasa al jugador por rebote.
        return;
      }
      if (event.type === 'hit') this.hud.flash('¡TE DIERON!', 1.2);
      if (event.type === 'boost') this.hud.flash('¡TURBO!', 0.8);
    };

    this.director.onFinish = (results) => {
      const mine = results.find((r) => r.isPlayer);
      this.hud.flash(mine ? `${ordinal(mine.position)} PUESTO` : '¡META!', 4);
      this.onRaceFinished?.(results);
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frameHandle);
  }

  dispose(): void {
    this.stop();
    this.input.detach();
    window.removeEventListener('resize', this.onResize);
    for (const racer of this.racers) racer.dispose();
    this.items.dispose();
    this.hud.hide();
    this.renderer.dispose();
  }

  private onResize = (): void => {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.chase.setAspect(width / Math.max(1, height));
  };

  private frame = (now: number): void => {
    if (!this.running) return;
    this.frameHandle = requestAnimationFrame(this.frame);

    // Un frame muy largo (pestaña en segundo plano) se recorta en vez de
    // simularse entero: mejor perder tiempo que atravesar la pista.
    const elapsed = Math.min((now - this.lastTime) / 1000, 0.25);
    this.lastTime = now;
    this.step(elapsed);
    this.render();
  };

  /**
   * Descarta el tiempo acumulado sin simular.
   *
   * Lo usan los tests: entre que la página carga y el test toma el reloj queda
   * una fracción de paso fijo pendiente, distinta en cada corrida, y eso alcanza
   * para que una simulación de 4 s termine dando 3,49 s unas veces y 4,00 otras.
   */
  resetClock(): void {
    this.accumulator = 0;
    this.lastTime = performance.now();
  }

  /** Avanza la simulación. Público para poder manejarlo desde los tests. */
  step(elapsed: number): void {
    const playerInput = this.input.update();
    this.accumulator += elapsed;

    let steps = 0;

    while (this.accumulator >= FIXED_STEP && steps < MAX_STEPS_PER_FRAME) {
      this.fixedStep();
      // Los flancos valen para un solo paso de simulación. Un frame de 60 Hz
      // dispara dos pasos de 120 Hz: sin esto, un toque del botón de poder
      // gastaría dos poderes y un toque de derrape cargaría el turbo doble.
      playerInput.driftPressed = false;
      playerInput.usePressed = false;
      this.accumulator -= FIXED_STEP;
      steps++;
    }

    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;

    const dt = elapsed || FIXED_STEP;
    // Las animaciones del escenario son decorado: van con el reloj del render,
    // no con el paso fijo, así que no cuestan nada en la simulación.
    this.animations.update(dt);
    this.items.updateVisuals(dt);
    for (const racer of this.racers) racer.sync(dt);
    this.chase.update(dt, this.player.physics);
    this.hud.update(dt, this.player, this.director, this.racers.length, this.racers, this.items);

    // La luz acompaña al jugador para que el mapa de sombras cubra siempre la
    // zona visible sin necesidad de una resolución enorme.
    this.sun.target.position.copy(this.player.physics.position);
    this.sun.position.copy(this.player.physics.position).add(new THREE.Vector3(60, 90, 35));

    this.onNetTick?.(dt);
  }

  private fixedStep(): void {
    const racing = this.director.racing;
    this.tick++;

    // Quién usa su poder en este tick. Se anota acá y se resuelve después de
    // mover a todos: disparar un misil mientras la mitad de la parrilla todavía
    // no se movió lo haría salir apuntado a posiciones de hace un paso.
    const firing: Racer[] = [];

    for (const racer of this.racers) {
      // Durante la cuenta regresiva y después de la meta nadie maneja, pero la
      // simulación sigue para que el kart se apoye y la cámara se ubique. El que
      // ya llegó sigue rodando por inercia.
      const idle = !racing || racer.finished;
      const input = idle
        ? NEUTRAL_INPUT
        : this.controllers.get(racer.id)!.poll(FIXED_STEP, racer, this.tick);

      if (!idle && input.usePressed && racer.item) firing.push(racer);

      racer.step(FIXED_STEP, input, racing);
    }

    // Los choques se resuelven después de mover a todos: separar a un kart
    // mientras los demás todavía no se movieron deja el resultado dependiendo
    // del orden de la lista.
    for (const hit of resolveKartCollisions(this.racers)) {
      if (hit.impact > 9 && (hit.a.isPlayer || hit.b.isPlayer)) {
        this.hud.flash('¡CHOQUE!', 0.7);
      }
    }

    if (racing) {
      this.items.step(FIXED_STEP, this.racers);
      // Un solo camino para usar un poder, venga del teclado, de la IA o de la
      // red: los tres lo pidieron por `usePressed` en su entrada.
      for (const racer of firing) this.items.use(racer, this.racers);
    }

    this.director.step(FIXED_STEP);
  }

  render(): void {
    this.renderer.render(this.scene, this.chase.camera);
  }
}

function ordinal(position: number): string {
  return `${position}º`;
}

/** Semilla numérica estable a partir del texto del circuito. */
function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
