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

/**
 * El mensaje con el que se invita a alguien.
 *
 * El link va al final y solo en su línea porque así es como WhatsApp arma la
 * vista previa: busca la primera dirección del mensaje y le pide a esa página
 * su imagen y su título. Si el link va en el medio de una frase igual la arma,
 * pero el que recibe ve el link partiendo el texto, y la invitación se lee peor.
 *
 * La imagen que aparece en esa vista previa no sale de acá: son las etiquetas
 * `og:` de `index.html`, que apuntan a `invitacion.jpg`.
 */
export function inviteText(room: string): string {
  return [
    '🏁 ¡Te invito a correr en Family Kart!',
    'Entrá a mi sala, elegí tu personaje y largamos.',
    '',
    roomLink(room),
  ].join('\n');
}

/**
 * Dirección que abre WhatsApp con el mensaje ya escrito.
 *
 * `wa.me` es el único camino que funciona en todos lados: en el celular abre la
 * aplicación y en la computadora abre WhatsApp Web o el programa de escritorio,
 * según lo que haya instalado. Sin número de destino, WhatsApp pregunta a quién
 * mandárselo, que es lo que uno quiere — la invitación casi nunca es para una
 * sola persona.
 */
export function whatsappLink(room: string): string {
  return `https://wa.me/?text=${encodeURIComponent(inviteText(room))}`;
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
  private readonly copyBtn: HTMLButtonElement;
  /** Código de la sala abierta. Lo necesita el botón de WhatsApp. */
  private code = '';
  private copyTimer = 0;

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
      <div class="lobby-share">
        <button type="button" class="share-btn whatsapp-btn">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2Zm0 18.17h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.11.82.83-3.04-.2-.31a8.22 8.22 0 0 1-1.26-4.4c0-4.54 3.7-8.23 8.24-8.23 2.2 0 4.27.86 5.83 2.41a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.7 8.25-8.24 8.25Zm4.52-6.17c-.25-.13-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.81-.78.97-.14.17-.29.19-.54.06-.25-.12-1.05-.38-1.99-1.23-.74-.65-1.23-1.46-1.38-1.71-.14-.25-.01-.38.11-.51.11-.11.25-.29.37-.43.13-.15.17-.25.25-.42.08-.17.04-.31-.02-.44-.06-.12-.56-1.35-.77-1.84-.2-.49-.4-.42-.56-.43h-.47c-.17 0-.44.06-.67.31-.23.25-.87.86-.87 2.09s.9 2.43 1.02 2.6c.12.17 1.76 2.69 4.27 3.77.6.26 1.06.41 1.42.53.6.19 1.14.16 1.57.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.08.14-1.18-.06-.11-.22-.17-.47-.3Z"/>
          </svg>
          Invitar por WhatsApp
        </button>
        <button type="button" class="ghost-btn copy-btn">Copiar link</button>
      </div>
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
    this.copyBtn = this.root.querySelector('.copy-btn')!;

    // Un click en el link lo selecciona entero: es lo que uno va a querer hacer
    // siempre, y seleccionarlo a mano en un celular es incómodo.
    this.linkBox.addEventListener('focus', () => this.linkBox.select());
    this.linkBox.addEventListener('click', () => this.linkBox.select());

    // WhatsApp se abre en otra pestaña y no en esta. Si se navegara acá, la sala
    // se cerraría en el acto: el anfitrión se iría de su propia partida justo al
    // invitar, que es el único momento en que no puede irse.
    this.root.querySelector('.whatsapp-btn')!.addEventListener('click', () => {
      if (this.code) window.open(whatsappLink(this.code), '_blank', 'noopener');
    });

    this.copyBtn.addEventListener('click', () => void this.copyLink());

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

    this.code = code;
    this.linkBox.value = roomLink(code);
    this.root.classList.remove('hidden');
    this.render();

    // El invitado avisa quién es apenas se engancha. Un pequeño retraso porque
    // la conexión tarda en abrirse y un mensaje mandado antes se pierde.
    setTimeout(() => this.session?.announce(), 600);
    setTimeout(() => this.render(), 700);
  }

  /**
   * Copia el link al portapapeles y lo dice.
   *
   * El aviso no es un adorno: copiar no produce ningún cambio visible, así que
   * sin él la única forma de saber si funcionó es ir a pegarlo a algún lado y
   * volver. La mayoría aprieta dos o tres veces por las dudas.
   *
   * `navigator.clipboard` no está en todos lados —necesita conexión segura y en
   * algunos navegadores pide permiso—, así que si falla se cae a seleccionar el
   * texto, que al menos deja el link listo para copiar a mano.
   */
  private async copyLink(): Promise<void> {
    const link = this.linkBox.value;
    let done = false;
    try {
      await navigator.clipboard.writeText(link);
      done = true;
    } catch {
      this.linkBox.focus();
      this.linkBox.select();
    }

    this.copyBtn.textContent = done ? '¡Copiado!' : 'Copialo de arriba';
    this.copyBtn.classList.toggle('done', done);
    clearTimeout(this.copyTimer);
    this.copyTimer = window.setTimeout(() => {
      this.copyBtn.textContent = 'Copiar link';
      this.copyBtn.classList.remove('done');
    }, 2200);
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
    clearTimeout(this.copyTimer);
    this.session?.close();
    this.session = null;
    this.root.classList.add('hidden');
  }

  get isOpen(): boolean {
    return !this.root.classList.contains('hidden');
  }
}
