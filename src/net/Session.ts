import type { Game } from '../core/Game';
import type { InputState } from '../core/Input';
import { RemoteController, cloneInput } from './Controller';
import type { WorldSnapshot } from './Snapshot';
import type { NetMessage, Transport } from './Transport';

/**
 * Una carrera compartida.
 *
 * El modelo es "anfitrión manda": una sola máquina —la del que abrió la sala—
 * corre la simulación de verdad, y las demás le mandan lo que están apretando y
 * reciben de vuelta dónde quedó todo. Es la alternativa al lockstep, donde todos
 * simulan lo mismo y tienen que coincidir hasta el último bit; el lockstep da
 * menos tráfico, pero cualquier diferencia mínima entre navegadores —el orden en
 * que se resuelven dos choques, un redondeo distinto— desincroniza la partida
 * sin aviso y es dificilísimo de perseguir. Con un solo simulador no hay nada
 * que pueda divergir.
 *
 * El invitado igual simula su propio kart con sus teclas, sin esperar respuesta.
 * Si esperara la confirmación del anfitrión para moverse, entre que aprieta y
 * que ve el kart arrancar pasaría el viaje de ida y vuelta completo, y en una
 * conexión normal eso es un décimo de segundo largo: suficiente para que manejar
 * se sienta como manejar algo mojado. Así que su kart arranca ya, y las fotos
 * que llegan corrigen a los demás pero nunca al propio.
 *
 * Cada mensaje lleva su tick. Los que llegan tarde —y siempre llegan algunos
 * tarde— se descartan en vez de aplicarse: una foto vieja aplicada después de
 * una nueva hace que los karts salten para atrás.
 */

/** Cuántas veces por segundo manda el anfitrión el estado del mundo. */
const STATE_HZ = 20;
/** Cuántas veces por segundo manda un invitado lo que está apretando. */
const INPUT_HZ = 30;

export interface Player {
  peer: string;
  name: string;
  racerId: number;
}

export class Session {
  readonly transport: Transport;
  private game: Game | null = null;

  /** Sólo en el anfitrión: qué kart le tocó a cada invitado. */
  private readonly players = new Map<string, Player>();
  private readonly remotes = new Map<string, RemoteController>();
  /** Sólo en el invitado: qué kart me tocó a mí. */
  private mine = -1;
  private lastStateTick = -1;

  private stateTimer = 0;
  private inputTimer = 0;

  onRoster: ((players: Player[]) => void) | null = null;
  onKicked: ((reason: string) => void) | null = null;
  /** El anfitrión largó: los invitados arrancan la misma carrera. */
  onGo: ((config: unknown) => void) | null = null;

  constructor(transport: Transport, private readonly name: string) {
    this.transport = transport;
    transport.onMessage = (from, msg) => this.handle(from, msg);
    transport.onJoin = (peer) => this.greet(peer);
    transport.onLeave = (peer) => this.drop(peer);
  }

  get isHost(): boolean {
    return this.transport.isHost;
  }

  /** El kart que maneja esta máquina. */
  get myRacer(): number {
    return this.isHost ? 0 : this.mine;
  }

  get roster(): Player[] {
    return [...this.players.values()];
  }

  /** Conecta la sesión a una carrera ya creada. */
  attach(game: Game): void {
    this.game = game;

    if (this.isHost) {
      // Los karts que ya tenían dueño pasan a manejarse por red.
      for (const player of this.players.values()) {
        const remote = new RemoteController();
        this.remotes.set(player.peer, remote);
        game.setController(player.racerId, remote);
      }
      return;
    }

    // En el invitado, el juego se armó igual que una partida solitaria: él en el
    // kart 0 y el resto manejados por la máquina. Hay que darlo vuelta. Su kart
    // es el que le asignó el anfitrión, y todos los demás dejan de tener IA: no
    // los maneja nadie de este lado, los mueven las fotos que van llegando.
    //
    // Dejarles la IA sería el peor de los dos mundos: la máquina los empujaría
    // hacia donde ella cree que tienen que ir mientras las correcciones los
    // traen de vuelta, y el resultado es un kart que tironea.
    if (this.mine >= 0) game.setLocalRacer(this.mine);
    for (const racer of game.racers) {
      if (racer.id !== this.mine) game.setController(racer.id, new RemoteController());
    }
  }

  private greet(peer: string): void {
    if (!this.isHost) return;
    // El primer kart libre. El 0 es siempre del anfitrión.
    const taken = new Set([0, ...[...this.players.values()].map((p) => p.racerId)]);
    const total = this.game?.racers.length ?? 4;
    let slot = -1;
    for (let i = 1; i < total; i++) {
      if (!taken.has(i)) { slot = i; break; }
    }
    if (slot < 0) {
      this.transport.send(peer, { type: 'full' });
      return;
    }

    const player: Player = { peer, name: `Jugador ${this.players.size + 2}`, racerId: slot };
    this.players.set(peer, player);

    if (this.game) {
      const remote = new RemoteController();
      this.remotes.set(peer, remote);
      this.game.setController(slot, remote);
    }

    this.transport.send(peer, {
      type: 'welcome',
      racerId: slot,
      config: this.game?.config ?? null,
    });
    this.onRoster?.(this.roster);
  }

  private drop(peer: string): void {
    const player = this.players.get(peer);
    if (!player) return;
    // El kart no desaparece: lo agarra la máquina y la carrera sigue. Sacarlo de
    // la pista dejaría un hueco en las posiciones y en el minimapa a mitad de
    // vuelta, que se lee como un error del juego.
    this.game?.releaseController(player.racerId);
    this.players.delete(peer);
    this.remotes.delete(peer);
    this.onRoster?.(this.roster);
  }

  private handle(from: string, msg: NetMessage): void {
    switch (msg.type) {
      case 'hello':
        if (this.isHost) {
          const player = this.players.get(from);
          if (player) {
            player.name = String(msg.name ?? player.name);
            this.onRoster?.(this.roster);
          }
        }
        break;

      case 'welcome':
        this.mine = Number(msg.racerId);
        break;

      case 'go':
        // La configuración la manda el anfitrión y no se discute. La pista se
        // genera a partir de ella con una semilla fija, así que si cada uno
        // usara la suya correrían por circuitos distintos creyendo que están
        // en la misma carrera.
        if (!this.isHost) this.onGo?.(msg.config);
        break;

      case 'full':
        this.onKicked?.('La sala está llena.');
        break;

      case 'input': {
        if (!this.isHost) break;
        const remote = this.remotes.get(from);
        if (remote) remote.receive(msg.input as InputState);
        break;
      }

      case 'state': {
        if (this.isHost || !this.game) break;
        const snap = msg.snap as WorldSnapshot;
        // Una foto más vieja que la última aplicada se tira. Aplicarla haría
        // retroceder a todos los karts un cuarto de segundo.
        if (snap.t <= this.lastStateTick) break;
        this.lastStateTick = snap.t;
        this.game.applySnapshot(snap, this.mine);
        break;
      }
    }
  }

  /** Se llama una vez por frame, después de avanzar la simulación. */
  update(dt: number): void {
    if (!this.game) return;

    if (this.isHost) {
      this.stateTimer += dt;
      if (this.stateTimer >= 1 / STATE_HZ) {
        this.stateTimer = 0;
        this.transport.broadcast({ type: 'state', snap: this.game.snapshot() });
      }
    } else {
      this.inputTimer += dt;
      if (this.inputTimer >= 1 / INPUT_HZ) {
        this.inputTimer = 0;
        this.transport.broadcast({
          type: 'input',
          tick: this.game.currentTick,
          input: cloneInput(this.game.input.state),
        });
      }
    }
  }

  /**
   * El anfitrión larga.
   *
   * Sólo él puede: si cualquiera pudiera, dos podrían largar a la vez con
   * configuraciones distintas y cada uno terminaría corriendo su propia carrera
   * sin enterarse.
   */
  go(config: unknown): void {
    if (!this.isHost) return;
    this.transport.broadcast({ type: 'go', config });
  }

  /** Avisa quién soy. Lo manda el invitado apenas lo aceptan. */
  announce(): void {
    this.transport.broadcast({ type: 'hello', name: this.name });
  }

  close(): void {
    this.transport.close();
    this.players.clear();
    this.remotes.clear();
  }
}
