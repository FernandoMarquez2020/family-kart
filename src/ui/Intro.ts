import { FIGURES, HERO } from './figures';
import { POSTER_PORTRAITS } from './portraits';
import { CHARACTERS, displayName } from '../characters/CharacterSpec';

/**
 * Presentación del juego: el afiche.
 *
 * Es lo primero que se ve al abrir y tiene un solo trabajo, que no es explicar
 * el juego: es que alguien quiera jugarlo. Por eso el reparto son las seis
 * personas REALES, recortadas de sus fotos y tratadas como un cartel de
 * película, y no los personajes 3D. Los 3D son para la pista, donde hay que
 * reconocer a alguien de atrás y a cuarenta metros; acá hay tiempo de mirar una
 * cara, y una cara de verdad es lo que hace que la familia se reconozca en el
 * juego.
 *
 * Los seis vehículos van arriba, en su propia franja. Probados detrás de cada
 * retrato —que parecía lo elegante— no se leen: el render trae su sombra y su
 * piso, y eso detrás de una cara es una mancha gris. En una franja propia se
 * ven, y de paso llenan el tercio de arriba del afiche.
 *
 * La fila va en cuña —los del medio más grandes y adelante, los de las puntas
 * más chicos y atrás— porque seis retratos del mismo tamaño en línea recta se
 * leen como un catálogo. La cuña es lo que los convierte en un reparto.
 *
 * Todo el movimiento va con animaciones CSS y no con `requestAnimationFrame`: el
 * navegador las corre en el compositor, así que la entrada se ve fluida incluso
 * mientras en segundo plano se está compilando el bundle del juego.
 */

/** Cuánto tarda en entrar cada corredor después del anterior, en segundos. */
const STAGGER = 0.16;
/** Cuánto queda la portada en pantalla antes de ofrecer el botón. */
const SETTLE = 0.9;

/**
 * En qué orden entran.
 *
 * No es el orden de la fila: entran desde las puntas hacia el centro, así que
 * los últimos en aparecer son los dos del medio, que son los que están más
 * grandes y más adelante. Entrando de izquierda a derecha, la vista termina el
 * recorrido en una punta y el remate se pierde.
 */
const ENTRY_ORDER = [0, 5, 1, 4, 2, 3];

export class Intro {
  private readonly root: HTMLElement;
  private readonly startBtn: HTMLButtonElement;
  private finished = false;
  private timer = 0;

  /** Se llama cuando el jugador arranca (o saltea la presentación). */
  onStart: (() => void) | null = null;

  constructor(document: Document) {
    this.root = document.createElement('div');
    this.root.id = 'intro';
    // El fondo renderizado va bien apagado por CSS: acá es la atmósfera detrás
    // del reparto, no el escenario.
    this.root.style.backgroundImage = `url(${HERO})`;

    const vignette = document.createElement('div');
    vignette.className = 'intro-glow';

    const beam = document.createElement('div');
    beam.className = 'intro-beam';

    // Friso de vehículos, sobre el reparto.
    const fleet = document.createElement('div');
    fleet.className = 'intro-fleet';
    CHARACTERS.forEach((spec, i) => {
      const kart = document.createElement('img');
      kart.src = FIGURES[spec.id];
      kart.alt = '';
      kart.decoding = 'async';
      kart.style.animationDelay = `${0.15 + i * 0.07}s`;
      fleet.append(kart);
    });

    const cast = document.createElement('div');
    cast.className = 'intro-cast';

    CHARACTERS.forEach((spec, i) => {
      const slot = document.createElement('figure');
      slot.className = 'cast-member';
      slot.dataset.character = spec.id;
      // La distancia al centro decide el tamaño, la profundidad y la sombra: se
      // calcula acá y viaja como variable CSS para no repetir seis reglas.
      //
      // Se estira para que el par del medio quede en 0 y las puntas en 1. Con
      // seis y sin estirar, el par del medio da 0,2 y nunca llega a estar del
      // todo adelante: la cuña se insinúa pero no se ve.
      const half = (CHARACTERS.length - 1) / 2;
      const raw = Math.abs(i - half);
      const closest = CHARACTERS.length % 2 === 0 ? 0.5 : 0;
      const depth = (raw - closest) / (half - closest);
      slot.style.setProperty('--depth', depth.toFixed(3));
      slot.style.zIndex = String(10 - Math.round(depth * 4));

      const delay = 0.3 + ENTRY_ORDER.indexOf(i) * STAGGER;
      slot.style.animationDelay = `${delay}s`;

      const portrait = document.createElement('img');
      portrait.className = 'cast-portrait';
      portrait.src = POSTER_PORTRAITS[spec.id];
      portrait.alt = '';
      portrait.decoding = 'async';

      const caption = document.createElement('figcaption');
      caption.textContent = displayName(spec);
      caption.style.animationDelay = `${delay + 0.34}s`;

      slot.append(portrait, caption);
      cast.append(slot);
    });

    const title = document.createElement('div');
    title.className = 'intro-title';
    title.innerHTML = '<h1><span>FAMILY</span> <b>KART</b></h1>';

    const tagline = document.createElement('p');
    tagline.className = 'intro-tagline';
    tagline.textContent = 'Seis pilotos. Seis pistas. Una familia.';
    title.append(tagline);

    this.startBtn = document.createElement('button');
    this.startBtn.type = 'button';
    this.startBtn.id = 'intro-start';
    this.startBtn.className = 'primary-btn';
    this.startBtn.textContent = '¡A CORRER!';
    this.startBtn.style.animationDelay = `${0.3 + CHARACTERS.length * STAGGER + SETTLE}s`;
    this.startBtn.addEventListener('click', () => this.finish());

    this.root.append(vignette, beam, fleet, cast, title, this.startBtn);
    document.getElementById('app')?.append(this.root);

    // Cualquier tecla o toque en el fondo también entra: en un celular nadie
    // busca el botón chico, y en la tercera partida la portada ya se vio.
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target !== this.startBtn) this.finish();
    });
    document.addEventListener('keydown', this.onKey);
  }

  private onKey = (): void => {
    if (!this.finished) this.finish();
  };

  /** Muestra la presentación. Sólo la primera vez que se abre el juego. */
  show(): void {
    this.finished = false;
    this.root.classList.remove('leaving');
    this.root.classList.add('showing');
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    document.removeEventListener('keydown', this.onKey);
    this.root.classList.add('leaving');
    // Esperamos a que termine el fundido para sacarlo del DOM: si se quita de
    // golpe, el menú aparece de un salto.
    this.timer = window.setTimeout(() => {
      this.root.classList.remove('showing');
      this.root.remove();
    }, 520);
    this.onStart?.();
  }

  dispose(): void {
    window.clearTimeout(this.timer);
    document.removeEventListener('keydown', this.onKey);
    this.root.remove();
  }
}

/** El fondo de estudio, para que el menú comparta el mismo mundo. */
export { HERO as BACKDROP, FIGURES };
