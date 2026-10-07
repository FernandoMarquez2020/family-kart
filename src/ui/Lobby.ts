import { LocalTransport, type Transport } from '../net/Transport';
import { Session } from '../net/Session';

/**
 * La sala de espera del modo online.
 *
 * Crea o abre una sala, muestra el link para compartir y quién fue entrando, y
 * arranca la carrera cuando el anfitrión dice que sí.
 *
 * El código de sala va en la dirección (`?sala=abc123`), no en un campo aparte.
 * Es lo que permite que invitar sea mandar un link por WhatsApp: el que lo abre
 * ya entró, sin escribir nada. Un código para tipear a mano es un paso más y un
 * error de tipeo más, y acá no agrega nada.
 */

const ROOM_PARAM = 'sala';

export function roomFromUrl(): string | null {
  return new URLSearchParams(location.search).get(ROOM_PARAM);
}

export function roomLink(room: string): string {
  const url = new URL(location.href);
  url.searchParams.set(ROOM_PARAM, room);
  // La presentación no tiene sentido para el que llega por un link de invitación:
  // viene a jugar a una partida que ya está armada.
  url.searchParams.delete('autostart');
  return url.toString();
}

export function newRoomCode(): string {
  // Sin vocales, para que no salga ninguna palabra desafortunada, y sin los
  // caracteres que se confunden al leerlos en voz alta.
  const alphabet = 'bcdfghjkmnpqrstvwxz23456789';
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export class Lobby {
  private readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly status: HTMLElement;
  /** Estado de la conexión, en palabras. Vacío cuando se juega entre pestañas. */
  private readonly link: HTMLElement;
  private readonly linkBox: HTMLInputElement;
  private readonly startBtn: HTMLButtonElement;

  session: Session | null = null;

  /** El anfitrión apretó "arrancar". */
  onStart: ((session: Session) => void) | null = null;
  /** El anfitrión largó y esta máquina es invitada. */
  onGo: ((session: Session, config: unknown) => void) | null = null;
  onCancel: (() => void) | null = null;

  constructor(document: Document) {
    this.root = document.createElement('div');
    this.root.id = 'lobby';
    this.root.className = 'panel hidden';

    this.root.innerHTML = `
      <h2>Sala</h2>
      <p class="lobby-status"></p>
      <label class="lobby-link">
        <span>Link para invitar</span>
        <input type="text" readonly />
      </label>
      <p class="lobby-net"></p>
      <ul class="lobby-players"></ul>
      <div class="lobby-actions">
        <button type="button" class="primary-btn lobby-start">¡ARRANCAR!</button>
        <button type="button" class="ghost-btn lobby-cancel">Salir</button>
      </div>
    `;

    this.status = this.root.querySelector('.lobby-status')!;
    this.link = this.root.querySelector('.lobby-net')!;
    this.list = this.root.querySelector('.lobby-players')!;
    this.linkBox = this.root.querySelector('.lobby-link input')!;
    this.startBtn = this.root.querySelector('.lobby-start')!;

    // Un click en el link lo selecciona entero: es lo que uno va a querer hacer
    // siempre, y seleccionarlo a mano en un celular es incómodo.
    this.linkBox.addEventListener('focus', () => this.linkBox.select());
    this.linkBox.addEventListener('click', () => this.linkBox.select());

    this.startBtn.addEventListener('click', () => {
      if (this.session) this.onStart?.(this.session);
    });
    this.root.querySelector('.lobby-cancel')!.addEventListener('click', () => {
      this.close();
      this.onCancel?.();
    });

    document.getElementById('app')?.append(this.root);
  }

  /** Abre la sala. `room` null crea una nueva. */
  open(room: string | null, name: string, makeTransport?: (room: string) => Transport): void {
    const code = room ?? newRoomCode();
    const transport = makeTransport ? makeTransport(code) : new LocalTransport(code);

    this.session = new Session(transport, name);
    this.session.onRoster = () => this.render();
    this.session.onGo = (config) => {
      const active = this.session!;
      this.handOff();
      this.onGo?.(active, config);
    };
    this.session.onKicked = (reason) => {
      this.status.textContent = reason;
      this.startBtn.disabled = true;
    };
    transport.onError = (reason) => {
      this.status.textContent = reason;
      this.startBtn.disabled = true;
    };
    transport.onStatus = (text) => {
      this.link.textContent = text;
    };

    this.linkBox.value = roomLink(code);
    this.root.classList.remove('hidden');
    this.render();

    // El invitado avisa quién es apenas se engancha. Un pequeño retraso porque
    // la conexión tarda en abrirse y un mensaje mandado antes se pierde.
    setTimeout(() => this.session?.announce(), 600);
    setTimeout(() => this.render(), 700);
  }

  private render(): void {
    const session = this.session;
    if (!session) return;

    const host = session.isHost;
    this.status.textContent = host
      ? 'Sos el anfitrión. Pasá el link y arrancá cuando estén todos.'
      : 'Esperando a que el anfitrión arranque…';
    // Sólo el anfitrión larga: si cualquiera pudiera, dos podrían largar a la vez
    // y cada uno vería una carrera distinta.
    this.startBtn.classList.toggle('hidden', !host);

    const rows = [`<li class="me">${host ? 'Vos (anfitrión)' : 'Vos'}</li>`];
    for (const player of session.roster) rows.push(`<li>${player.name}</li>`);
    this.list.innerHTML = rows.join('');
  }

  /**
   * Esconde la sala pero deja la sesión viva.
   *
   * Es la diferencia entre largar y salirse, y confundirlas rompe la partida de
   * la forma más silenciosa posible: `close()` corta el canal, así que largar
   * con él mataba la conexión en el mismo instante en que empezaba a hacer
   * falta. La carrera arrancaba igual, los dos veían su pista, y no pasaba nada
   * más nunca — sin un solo error en la consola.
   */
  handOff(): void {
    this.root.classList.add('hidden');
  }

  close(): void {
    this.session?.close();
    this.session = null;
    this.root.classList.add('hidden');
  }

  get isOpen(): boolean {
    return !this.root.classList.contains('hidden');
  }
}
