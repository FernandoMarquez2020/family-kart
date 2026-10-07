import type { ChassisKind } from '../kart/chassis';
import type { TrackSpec } from '../track/TrackSpec';
import type { ThemeId } from '../track/themes';

/**
 * Definición de un personaje jugable.
 *
 * Es sólo datos: apariencia del piloto, librea del kart y a qué pista está
 * vinculado. El avatar se dibuja por código a partir de estos parámetros, así
 * que agregar un personaje es agregar una entrada acá.
 *
 * Cuando tengamos las caricaturas dibujadas de verdad, cada personaje va a
 * poder traer además una textura de cara propia (`faceTexture`), que
 * `KartView.setFaceTexture()` aplica en lugar de la cara generada.
 */

export type HairStyle = 'rulos' | 'corto' | 'ondulado' | 'largo' | 'puas' | 'mechas';
export type Expression = 'sonrisa' | 'risa' | 'seria' | 'pilla' | 'dientito' | 'segura';
export type ShirtPattern = 'liso' | 'rayas' | 'capucha' | 'camisa' | 'musculosa';
/** Vello facial. Sólo se dibuja en los adultos. */
export type FacialHair = 'ninguno' | 'bigote' | 'candado' | 'perilla';

export interface CharacterAppearance {
  skin: number;
  hair: number;
  hairStyle: HairStyle;
  /** Volumen y largo del pelo. 1 = estándar. */
  hairVolume: number;
  /** Flequillo recto sobre la frente. */
  fringe: boolean;
  eyes: number;
  shirt: number;
  shirtAccent: number;
  shirtPattern: ShirtPattern;
  expression: Expression;
  /** Escala del piloto. 1 = estándar. */
  scale: number;
  /**
   * Tamaño del cuerpo respecto de la cabeza. 1 = estándar.
   *
   * Un adulto no es un chico agrandado: tiene la cabeza más chica en proporción
   * al torso. Subir sólo `scale` agranda todo por igual y el personaje sigue
   * teniendo proporciones de nene, apenas más grande.
   */
  bodyScale?: number;

  // --- Rasgos finos de la cara ---------------------------------------------
  // Todos opcionales y con un valor por defecto sensato, así un personaje nuevo
  // se puede definir con lo básico y después afinar sólo lo que haga falta.

  /** Mechas o reflejos del pelo. */
  hairHighlight?: number;
  /** Color de las cejas; por defecto, el del pelo. */
  brows?: number;
  /** Grosor de las cejas. 1 = estándar. */
  browWeight?: number;
  /** Pestañas marcadas. */
  lashes?: boolean;
  /** Color de los labios; por defecto, un tono derivado de la piel. */
  lips?: number;
  facialHair?: FacialHair;
  /** Pecas en las mejillas y la nariz. */
  freckles?: boolean;
  /** Ancho de la cara. 1 = estándar; >1 más cuadrada, <1 más fina. */
  faceWidth?: number;
  /** Ancho de la nariz. 1 = estándar. */
  noseWidth?: number;
  /**
   * Proporciones de adulto: ojos más chicos y más separados, cara más larga,
   * mentón marcado. Sin esto, un adulto sale con cara de nene grande.
   */
  adult?: boolean;
}

export interface KartLivery {
  body: number;
  accent: number;
  trim: number;
  /** Número que va en los paneles laterales y en el capó. */
  number: string;
  numberPanel: number;
  numberInk: number;
  /** Rayas verticales del panel del número; null = panel liso. */
  numberStripes: number | null;
}

export interface CharacterSpec {
  id: string;
  /** Nombre por defecto; el jugador lo puede cambiar en el menú. */
  defaultName: string;
  /** Texto corto para la tarjeta de selección. */
  tagline: string;
  theme: ThemeId;
  trackName: string;
  /** Semilla del trazado: fija el dibujo del circuito. */
  trackSeed: string;
  /** Ajustes que le dan carácter propio al trazado. */
  trackOverrides?: Partial<Omit<TrackSpec, 'harmonics' | 'elevation'>>;
  appearance: CharacterAppearance;
  kart: KartLivery;
  /** Carrocería. Si no se indica, un kart. */
  chassis?: ChassisKind;
}

export const CHARACTERS: CharacterSpec[] = [
  {
    id: 'futbol',
    defaultName: 'Isma',
    tagline: 'Estadio mundialista: tribunas llenas, arcos y banderas. Kart con el 7.',
    theme: 'futbol',
    trackName: 'Estadio Mundial 26',
    trackSeed: 'estadio-mundial-26',
    // Trazado ancho y de curvas amplias: se corre rápido y se derrapa fácil.
    trackOverrides: { radius: 215, halfWidth: 9.6, banking: 0.17, widthVariation: 0.1 },
    appearance: {
      skin: 0xd8996a,
      hair: 0x33251a,
      hairStyle: 'rulos',
      // Rulos al ras: con la mata grande no se le veía la cara.
      hairVolume: 0.78,
      fringe: false,
      eyes: 0x3a2a1c,
      shirt: 0x1b2748,
      shirtAccent: 0xd63a2a,
      shirtPattern: 'capucha',
      expression: 'risa',
      scale: 0.94,
    },
    kart: {
      body: 0xe8402f,
      accent: 0xf4f4f4,
      trim: 0x1f9c4a,
      number: '7',
      numberPanel: 0xf8f8f8,
      numberInk: 0x14171d,
      numberStripes: null,
    },
  },

  {
    id: 'gaming',
    defaultName: 'Xavi',
    tagline: 'Circuito neón, grillas y píxeles. El kart más técnico.',
    theme: 'gaming',
    trackName: 'Circuito Neón',
    trackSeed: 'circuito-neon',
    // Más corto y más cerrado: pista técnica, de frenar y salir.
    trackOverrides: { radius: 168, halfWidth: 7.2, banking: 0.09, widthVariation: 0.2 },
    appearance: {
      skin: 0xeec49b,
      hair: 0x4a3526,
      hairStyle: 'corto',
      hairVolume: 0.8,
      fringe: true,
      eyes: 0x4a3526,
      shirt: 0x1a1d26,
      shirtAccent: 0x25e6ff,
      shirtPattern: 'liso',
      expression: 'seria',
      // El más grande del grupo.
      scale: 1.2,
    },
    kart: {
      body: 0x1f2430,
      accent: 0x25e6ff,
      trim: 0xff3fd0,
      number: '2',
      numberPanel: 0x10131c,
      numberInk: 0x25e6ff,
      numberStripes: null,
    },
  },

  {
    id: 'bloques',
    defaultName: 'Benja',
    tagline: 'Mundo de bloques. Kart celeste y blanco con el 10.',
    theme: 'bloques',
    trackName: 'Ciudad Bloques',
    trackSeed: 'ciudad-bloques',
    trackOverrides: { radius: 195, halfWidth: 8.6, banking: 0.12 },
    appearance: {
      skin: 0xf0c49e,
      hair: 0x8a6a45,
      hairStyle: 'ondulado',
      hairVolume: 0.72,
      fringe: false,
      eyes: 0x4a3220,
      shirt: 0xf4f4f4,
      shirtAccent: 0x75aadb,
      // Camiseta a rayas celestes y blancas.
      shirtPattern: 'rayas',
      expression: 'sonrisa',
      scale: 1.02,
    },
    kart: {
      body: 0x75aadb,
      accent: 0xf8f8f8,
      trim: 0xffcc33,
      number: '10',
      numberPanel: 0xf8f8f8,
      numberInk: 0x0f2f6b,
      // Rayas celestes: la bandera, sin copiar ninguna camiseta.
      numberStripes: 0x75aadb,
    },
  },

  {
    id: 'rosa',
    defaultName: 'Isa',
    tagline: 'Mundo rosa: flores gigantes, globos y castillos pastel.',
    theme: 'rosa',
    trackName: 'Valle Rosa',
    trackSeed: 'valle-rosa',
    trackOverrides: { radius: 205, halfWidth: 9.2, banking: 0.15, widthVariation: 0.14 },
    appearance: {
      skin: 0xeec096,
      hair: 0x6b4a2e,
      hairStyle: 'largo',
      // Melena larga y con cuerpo.
      hairVolume: 1.35,
      fringe: false,
      eyes: 0x4a3220,
      shirt: 0xd2d2d2,
      shirtAccent: 0xff5fa8,
      shirtPattern: 'liso',
      // Sonrisa con el dientito de adelante que le falta.
      expression: 'dientito',
      scale: 0.99,
    },
    kart: {
      body: 0xff5fa8,
      accent: 0xfff0f7,
      trim: 0xffd93d,
      number: '4',
      numberPanel: 0xfff4fa,
      numberInk: 0xd6247a,
      numberStripes: null,
    },
  },

  {
    id: 'puerto',
    defaultName: 'Fer',
    tagline: 'Puerto de carga: grúas, contenedores y buques en el muelle. Autoelevador con uñas.',
    theme: 'puerto',
    trackName: 'Terminal Puerto',
    trackSeed: 'terminal-puerto',
    // Anchísima y de curvas largas: una explanada de muelle, no un circuito de
    // karting. Con el autoelevador conviene tener lugar para maniobrar.
    trackOverrides: { radius: 225, halfWidth: 10.4, banking: 0.08, widthVariation: 0.18 },
    chassis: 'autoelevador',
    appearance: {
      skin: 0xe3b088,
      hair: 0x15100d,
      hairStyle: 'puas',
      hairVolume: 0.92,
      fringe: false,
      eyes: 0x3a2a1c,
      brows: 0x120d0a,
      browWeight: 1.35,
      facialHair: 'candado',
      lips: 0xb57a6a,
      faceWidth: 1.08,
      noseWidth: 1.12,
      adult: true,
      shirt: 0xf6f3ee,
      shirtAccent: 0xd8d2c6,
      shirtPattern: 'camisa',
      expression: 'segura',
      scale: 1.24,
      bodyScale: 1.2,
    },
    kart: {
      // Verde de máquina de puerto, con el contrapeso y el techo en negro.
      body: 0x2f8f3f,
      accent: 0x2a2e35,
      trim: 0xc9ced6,
      number: '1',
      numberPanel: 0xf8f8f8,
      numberInk: 0x20242c,
      numberStripes: null,
    },
  },

  {
    id: 'miami',
    defaultName: 'Vero',
    tagline: 'Playa, costanera y centro art déco: palmeras, marquesinas y neones. Deportivo rojo.',
    theme: 'miami',
    trackName: 'Costanera Miami',
    trackSeed: 'costanera-miami',
    // Larga y rápida, con tramos abiertos de costanera y otros más apretados en
    // la zona céntrica.
    trackOverrides: { radius: 230, halfWidth: 9.0, banking: 0.16, widthVariation: 0.24 },
    chassis: 'deportivo',
    appearance: {
      skin: 0xe8b388,
      // Rubia de pelo largo, con mechones más claros enmarcando la cara.
      hair: 0xd2a862,
      hairHighlight: 0xf0d69c,
      hairStyle: 'mechas',
      hairVolume: 1.45,
      fringe: false,
      eyes: 0x7a8a4a,
      // Las cejas no siguen al pelo: son bastante más oscuras que la melena.
      brows: 0x6b4a2e,
      browWeight: 1.15,
      lashes: true,
      lips: 0xc9707e,
      faceWidth: 0.98,
      noseWidth: 0.95,
      adult: true,
      shirt: 0xdcdde0,
      shirtAccent: 0xff5fa8,
      shirtPattern: 'musculosa',
      expression: 'pilla',
      scale: 1.18,
      bodyScale: 1.16,
    },
    kart: {
      body: 0xd8172a,
      accent: 0xf4f4f4,
      trim: 0x20242c,
      number: '8',
      numberPanel: 0xf8f8f8,
      numberInk: 0xd8172a,
      numberStripes: null,
    },
  },
];

export function getCharacter(id: string): CharacterSpec {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
}

// --- Nombres elegidos por el jugador ----------------------------------------

const NAME_KEY = 'kart-royale:names';

/**
 * Los nombres los escribe el jugador en el menú y se guardan en el navegador.
 * Es una comodidad local: si el almacenamiento no está disponible (ventana
 * privada, datos bloqueados) el juego funciona igual con los nombres por
 * defecto, así que todo va envuelto en try/catch.
 */
export function loadNames(): Record<string, string> {
  try {
    const raw = localStorage.getItem(NAME_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function saveName(id: string, name: string): void {
  try {
    const names = loadNames();
    names[id] = name;
    localStorage.setItem(NAME_KEY, JSON.stringify(names));
  } catch {
    // Sin almacenamiento el nombre dura lo que dure la sesión. No es grave.
  }
}

export function displayName(spec: CharacterSpec, names = loadNames()): string {
  const stored = names[spec.id]?.trim();
  return stored || spec.defaultName;
}
