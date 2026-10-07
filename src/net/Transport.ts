/**
 * Por dónde viajan los mensajes de una partida en red.
 *
 * Hay dos caminos posibles y el resto del código no tiene por qué saber cuál se
 * está usando: uno conecta pestañas de la misma computadora y el otro conecta
 * computadoras distintas por internet. Separarlos detrás de esta interfaz sirve
 * para dos cosas concretas. Una, que la lógica de la partida se pueda PROBAR de
 * verdad —dos pestañas, una corrida automatizada, sin depender de que haya
 * internet ni de que un servidor externo esté vivo—. La otra, que el día que
 * haya un servidor propio entre como un tercer transporte y no haya que tocar
 * nada más.
 */
export interface NetMessage {
  type: string;
  [key: string]: unknown;
}

export interface Transport {
  /** Identificador de esta sala. Es lo que se comparte por el link. */
  readonly room: string;
  /** Quién soy dentro de la sala. */
  readonly self: string;
  /** ¿Soy el que manda? Sólo uno por sala. */
  readonly isHost: boolean;

  /** A todos menos a mí. */
  broadcast(msg: NetMessage): void;
  /** A uno solo. */
  send(peer: string, msg: NetMessage): void;

  onMessage: ((from: string, msg: NetMessage) => void) | null;
  onJoin: ((peer: string) => void) | null;
  onLeave: ((peer: string) => void) | null;
  /** Se dispara si el transporte no pudo levantar. */
  onError: ((reason: string) => void) | null;
  /**
   * Cómo va la conexión, en palabras.
   *
   * No es decoración. Cuando una partida entre dos casas no arranca, la pregunta
   * es siempre la misma —¿no se encontraron, o se encontraron y el juego está
   * mal?— y sin esto la única respuesta es una pantalla quieta. Diciendo en qué
   * paso se quedó, el problema se ubica en diez segundos.
   */
  onStatus?: ((text: string) => void) | null;

  close(): void;
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Transporte entre pestañas de la misma computadora.
 *
 * Usa `BroadcastChannel`, que es un canal que comparten las páginas del mismo
 * origen. No sale a internet, así que no sirve para jugar a distancia — sirve
 * para dos personas en la misma máquina, y sobre todo para que el test abra dos
 * pestañas y compruebe que la sincronización realmente funciona. Toda la lógica
 * de la partida es la misma que corre por WebRTC: si anda acá, el problema de
 * allá es de conexión y no de juego, que es una distinción muy cara de hacer
 * cuando no se puede probar nada.
 */
export class LocalTransport implements Transport {
  readonly room: string;
  readonly self = randomId();
  isHost = false;

  onMessage: ((from: string, msg: NetMessage) => void) | null = null;
  onJoin: ((peer: string) => void) | null = null;
  onLeave: ((peer: string) => void) | null = null;
  onError: ((reason: string) => void) | null = null;
  onStatus: ((text: string) => void) | null = null;

  private readonly channel: BroadcastChannel;
  private readonly peers = new Set<string>();
  private hostId: string | null = null;
  private claimTimer = 0;

  constructor(room: string) {
    this.room = room;
    this.channel = new BroadcastChannel(`family-kart:${room}`);
    this.channel.onmessage = (e) => this.receive(e.data);

    // Quién es anfitrión se resuelve solo: se pregunta, y si en medio segundo
    // nadie contesta que ya lo es, lo soy yo. Es más simple que un sorteo y no
    // necesita que nadie coordine — el primero que abre la sala se queda con
    // ella, que es justamente lo que uno espera.
    this.post({ type: '_who' });
    this.claimTimer = self.setTimeout(() => {
      if (!this.hostId) {
        this.hostId = this.self;
        this.isHost = true;
        this.post({ type: '_host' });
      }
    }, 450);

    addEventListener('pagehide', this.farewell);
  }

  private farewell = () => {
    this.post({ type: '_bye' });
  };

  private post(msg: NetMessage, to?: string): void {
    this.channel.postMessage({ ...msg, _from: this.self, _to: to ?? null });
  }

  private receive(raw: Record<string, unknown>): void {
    const from = raw._from as string;
    if (!from || from === this.self) return;
    const to = raw._to as string | null;
    if (to && to !== this.self) return;

    const type = raw.type as string;

    if (type === '_who') {
      if (this.isHost) this.post({ type: '_host' }, from);
      if (!this.peers.has(from)) {
        this.peers.add(from);
        this.onJoin?.(from);
      }
      return;
    }
    if (type === '_host') {
      this.hostId = from;
      clearTimeout(this.claimTimer);
      if (!this.peers.has(from)) {
        this.peers.add(from);
        this.onJoin?.(from);
      }
      return;
    }
    if (type === '_bye') {
      this.peers.delete(from);
      this.onLeave?.(from);
      return;
    }

    if (!this.peers.has(from)) {
      this.peers.add(from);
      this.onJoin?.(from);
    }
    this.onMessage?.(from, raw as unknown as NetMessage);
  }

  broadcast(msg: NetMessage): void {
    this.post(msg);
  }

  send(peer: string, msg: NetMessage): void {
    this.post(msg, peer);
  }

  close(): void {
    clearTimeout(this.claimTimer);
    removeEventListener('pagehide', this.farewell);
    this.farewell();
    this.channel.close();
  }
}
