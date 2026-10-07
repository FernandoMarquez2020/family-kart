import Peer, { type DataConnection } from 'peerjs';
import type { NetMessage, Transport } from './Transport';

/**
 * Servidores que ayudan a los dos navegadores a encontrarse.
 *
 * STUN sólo hace una cosa: le dice a cada uno con qué dirección se lo ve desde
 * afuera. Con eso alcanza para la mayoría de las conexiones entre dos casas, es
 * gratis y no necesita cuenta.
 *
 * Donde STUN no alcanza es cuando alguno de los dos está detrás de un NAT que le
 * cambia el puerto según con quién hable —típico de las conexiones móviles y de
 * los proveedores que comparten una IP entre muchos clientes—. Ahí los dos
 * navegadores se pasan direcciones que del otro lado no sirven y la conexión
 * nunca se arma. La solución es un TURN, que no los presenta sino que les hace
 * de intermediario todo el tiempo, y eso ya consume ancho de banda de alguien y
 * por eso no hay ninguno realmente abierto.
 *
 * Se deja preparado y vacío: mientras no haga falta no se paga ni se configura
 * nada, y el día que una conexión no arme se agregan las credenciales acá.
 */
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
  // { urls: 'turn:…', username: '…', credential: '…' },
];

/**
 * Transporte por internet, punto a punto (WebRTC).
 *
 * Una vez conectados, los datos van directo de una computadora a la otra sin
 * pasar por ningún servidor: es lo que hace que no haya nada que pagar ni
 * mantener, y de paso lo que da la latencia más baja posible entre dos casas.
 *
 * Lo que sí hace falta es un intermediario para el saludo inicial. Dos navegadores
 * no se pueden encontrar solos: cada uno tiene que averiguar por qué dirección
 * es alcanzable y pasarle esa información al otro, y para eso hace falta un
 * tercero que los presente. Se usa el broker público de PeerJS, que es gratuito
 * y no pide credenciales. Sólo interviene en el saludo; después se desentiende y
 * la carrera va directa.
 *
 * La contra de esto es que si ese broker no está disponible —se cayó, o la
 * página se sirve desde algún lado que bloquea la conexión— la sala no levanta.
 * Por eso `onError` avisa en lugar de dejar la pantalla colgada esperando, y el
 * juego puede ofrecer el transporte local o correr solo contra la máquina.
 */
export class PeerTransport implements Transport {
  readonly room: string;
  readonly isHost: boolean;
  self = '';

  onMessage: ((from: string, msg: NetMessage) => void) | null = null;
  onJoin: ((peer: string) => void) | null = null;
  onLeave: ((peer: string) => void) | null = null;
  onError: ((reason: string) => void) | null = null;
  onStatus: ((text: string) => void) | null = null;

  private peer: Peer;
  private readonly links = new Map<string, DataConnection>();
  private closed = false;

  constructor(room: string, isHost: boolean) {
    this.room = room;
    this.isHost = isHost;

    // El anfitrión toma como identidad la de la sala, así el invitado puede
    // llamarlo sabiendo nada más que el código del link. El invitado toma una
    // identidad derivada, porque dos no pueden compartir la misma.
    const id = isHost ? hostId(room) : `${hostId(room)}-${rand()}`;
    this.peer = new Peer(id, { debug: 0, config: { iceServers: ICE_SERVERS } });
    this.self = id;

    this.peer.on('open', (open) => {
      this.self = open;
      this.onStatus?.(isHost ? 'Sala abierta. Esperando…' : 'Buscando la sala…');
      if (!isHost) this.dial(hostId(room));
    });

    this.peer.on('connection', (conn) => this.adopt(conn));

    this.peer.on('error', (err) => {
      if (this.closed) return;
      // El error más común y el más informativo: alguien intenta crear una sala
      // con un código que ya está tomado, o entrar a una que no existe.
      const taken = String(err.type) === 'unavailable-id';
      const missing = String(err.type) === 'peer-unavailable';
      this.onError?.(
        taken ? 'Esa sala ya existe.'
          : missing ? 'No encontramos esa sala. Puede que el anfitrión la haya cerrado.'
          : 'No pudimos conectarnos.',
      );
    });
  }

  private dial(target: string): void {
    // `ordered: false` no sirve acá: las fotos del mundo se pisan unas a otras y
    // llegar en desorden significaría ver al rival saltar para atrás.
    this.adopt(this.peer.connect(target, { reliable: false, serialization: 'json' }));
  }

  private adopt(conn: DataConnection): void {
    conn.on('open', () => {
      this.links.set(conn.peer, conn);
      this.onStatus?.('Conectado.');
      this.onJoin?.(conn.peer);
      this.reportRoute(conn);
    });
    conn.on('data', (data) => {
      this.onMessage?.(conn.peer, data as NetMessage);
    });
    conn.on('close', () => {
      this.links.delete(conn.peer);
      this.onLeave?.(conn.peer);
    });
    conn.on('error', () => {
      this.links.delete(conn.peer);
      this.onLeave?.(conn.peer);
    });
  }

  /**
   * Avisa si la conexión salió directa o por un intermediario.
   *
   * Es la información que decide si hace falta pagar un TURN. Sin mirarla, dos
   * partidas que funcionan igual de bien pueden estar usando caminos
   * completamente distintos, y recién se nota el día que una falla.
   */
  private async reportRoute(conn: DataConnection): Promise<void> {
    const pc = conn.peerConnection;
    if (!pc?.getStats) return;
    try {
      const stats = await pc.getStats();
      let relayed = false;
      stats.forEach((report: { type?: string; candidateType?: string }) => {
        if (report.type === 'local-candidate' && report.candidateType === 'relay') relayed = true;
      });
      this.onStatus?.(relayed ? 'Conectado (por intermediario).' : 'Conectado (directo).');
    } catch {
      /* las estadísticas son un lujo: si no están, la partida anda igual */
    }
  }

  broadcast(msg: NetMessage): void {
    for (const conn of this.links.values()) {
      if (conn.open) conn.send(msg);
    }
  }

  send(peer: string, msg: NetMessage): void {
    const conn = this.links.get(peer);
    if (conn?.open) conn.send(msg);
  }

  close(): void {
    this.closed = true;
    for (const conn of this.links.values()) conn.close();
    this.links.clear();
    this.peer.destroy();
  }
}

/** El broker es global: un prefijo evita chocar con salas de otra gente. */
function hostId(room: string): string {
  return `familykart-${room}`;
}

function rand(): string {
  return Math.random().toString(36).slice(2, 8);
}
