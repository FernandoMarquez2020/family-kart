/**
 * Temas visuales de las pistas.
 *
 * Un tema es sólo datos: colores, patrones y qué decorados poblar. Toda la
 * geometría del circuito se construye igual para los cuatro, así que agregar un
 * tema nuevo es agregar una entrada acá, sin tocar la pista ni la física.
 *
 * Los temas son de estilo propio (una cancha, un circuito neón, un mundo de
 * bloques, un mundo rosa); no reproducen marcas, logos ni personajes de nadie.
 */

export type ThemeId = 'futbol' | 'gaming' | 'bloques' | 'rosa' | 'puerto' | 'miami';

/** Patrón de la textura del suelo a los costados de la pista. */
export type GroundPattern = 'cesped' | 'rayas' | 'grilla' | 'bloques' | 'brillos' | 'hormigon' | 'arena';

/** Familia de decorados que se reparte a los costados del trazado. */
export type SceneryKind = 'estadio' | 'neon' | 'bloques' | 'dulce' | 'puerto' | 'miami';

export interface ThemePalette {
  /** Nombre visible del tema. */
  label: string;

  // --- Asfalto ---
  road: string;
  roadSpeckle: string;
  edgeLine: string;
  centerLine: string;
  /** Si es false, la línea central no se dibuja (queda un piso más limpio). */
  centerDashed: boolean;

  // --- Pianos del borde ---
  curbA: string;
  curbB: string;

  // --- Suelo ---
  ground: string;
  groundAccent: string;
  groundPattern: GroundPattern;
  /** Color plano del disco de suelo lejano. */
  groundFar: number;

  // --- Cielo y luz ---
  skyTop: number;
  skyMiddle: number;
  skyBottom: number;
  fog: number;
  fogNear: number;
  fogFar: number;
  sunColor: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;

  // --- Decorados ---
  scenery: SceneryKind;
  /** Paleta de los props; se reparte por instancia. */
  sceneryColors: number[];
  /** Densidad de decorados: 0 = ninguno, 1 = mucho. */
  sceneryDensity: number;

  /**
   * Agua en el horizonte. Cuando está, el suelo lejano se recorta a un anillo de
   * costa y más allá se dibuja el mar. Es lo que hace que un puerto parezca un
   * puerto y no una playa de estacionamiento.
   */
  water?: {
    color: number;
    /** Cuántos metros por debajo del suelo queda la superficie del agua. */
    drop: number;
    /** Radio de la costa, medido desde el borde del circuito. */
    shore: number;
  };
}

export const THEMES: Record<ThemeId, ThemePalette> = {
  // Cancha de fútbol: césped rayado, tribunas, arcos y banderines.
  futbol: {
    label: 'Estadio',
    road: '#3c4149',
    roadSpeckle: '#4a5059',
    edgeLine: '#ffffff',
    centerLine: '#f4f4f4',
    centerDashed: true,
    curbA: '#ffffff',
    curbB: '#1f9c4a',
    ground: '#3f9c46',
    groundAccent: '#48ad4f',
    groundPattern: 'rayas',
    groundFar: 0x38903e,
    skyTop: 0x1f63c0,
    skyMiddle: 0x8cc4f0,
    skyBottom: 0xe8f0d8,
    fog: 0xa8cdea,
    fogNear: 340,
    fogFar: 1150,
    sunColor: 0xfff6e2,
    sunIntensity: 1.55,
    hemiSky: 0xc4dcf5,
    hemiGround: 0x4d8a45,
    hemiIntensity: 1.1,
    scenery: 'estadio',
    // Paleta de banderas: la variedad de colores es lo que da el aire de
    // torneo internacional, tanto en los mástiles como en las tribunas.
    sceneryColors: [
      0xe8402f, 0x2f7fd6, 0xffd23d, 0x1f9c4a, 0xf4f4f4, 0x8c4fd6, 0xff8a3d, 0x00b3a4,
    ],
    sceneryDensity: 0.78,
  },

  // Circuito neón: noche, grilla luminosa, bloques de píxeles flotando.
  gaming: {
    label: 'Circuito Neón',
    road: '#2b3245',
    roadSpeckle: '#39425c',
    edgeLine: '#25e6ff',
    centerLine: '#ff3fd0',
    centerDashed: true,
    curbA: '#25e6ff',
    curbB: '#141a2a',
    ground: '#141a2c',
    groundAccent: '#2bb7e0',
    groundPattern: 'grilla',
    groundFar: 0x0e1220,
    skyTop: 0x05060f,
    skyMiddle: 0x1b1350,
    skyBottom: 0x6a1d7a,
    fog: 0x160f36,
    fogNear: 220,
    fogFar: 900,
    sunColor: 0xbfe4ff,
    sunIntensity: 1.15,
    hemiSky: 0x8f7cff,
    hemiGround: 0x2a3550,
    hemiIntensity: 1.7,
    scenery: 'neon',
    sceneryColors: [0x25e6ff, 0xff3fd0, 0x9d5cff, 0x3dff9e, 0xffe14d],
    sceneryDensity: 0.62,
  },

  // Mundo de bloques: todo cúbico y de colores saturados.
  bloques: {
    label: 'Mundo Bloques',
    road: '#5a5f6b',
    roadSpeckle: '#666c79',
    edgeLine: '#ffffff',
    centerLine: '#ffd93d',
    centerDashed: true,
    curbA: '#ffd93d',
    curbB: '#e8402f',
    ground: '#58c246',
    groundAccent: '#69d455',
    groundPattern: 'bloques',
    groundFar: 0x4fb33e,
    skyTop: 0x2f8fe0,
    skyMiddle: 0x7dc4f5,
    skyBottom: 0xd8eeff,
    fog: 0x9ccff2,
    fogNear: 360,
    fogFar: 1200,
    sunColor: 0xffffff,
    sunIntensity: 1.5,
    hemiSky: 0xbfe2ff,
    // Rebote del suelo apenas verdoso: con el verde saturado del pasto, la piel
    // de los personajes se teñía de verde.
    hemiGround: 0x8fae84,
    hemiIntensity: 1.15,
    scenery: 'bloques',
    sceneryColors: [0xe8402f, 0x2f8fe0, 0xffd93d, 0x8c4fd6, 0xff8a3d, 0x3dd6a0],
    sceneryDensity: 0.7,
  },

  // Mundo rosa: pasteles, flores gigantes, corazones y caramelos.
  rosa: {
    label: 'Mundo Rosa',
    road: '#d6799f',
    roadSpeckle: '#e08cb0',
    edgeLine: '#fff4fa',
    centerLine: '#ffffff',
    centerDashed: true,
    curbA: '#fff0f7',
    curbB: '#ff5fa8',
    ground: '#f7b8d4',
    groundAccent: '#ffd4e6',
    groundPattern: 'brillos',
    groundFar: 0xf0a8c8,
    skyTop: 0x7fc4f0,
    skyMiddle: 0xffc0dd,
    skyBottom: 0xfff0e0,
    fog: 0xffd0e4,
    fogNear: 330,
    fogFar: 1100,
    sunColor: 0xfff0f4,
    sunIntensity: 1.35,
    hemiSky: 0xffd8ea,
    hemiGround: 0xe89ac0,
    hemiIntensity: 1.25,
    scenery: 'dulce',
    sceneryColors: [0xff5fa8, 0xffd93d, 0xa96ce0, 0x6fd8e8, 0xfff0f7],
    sceneryDensity: 0.66,
  },

  // Puerto de carga: hormigón, contenedores apilados, grúas pórtico y el muelle
  // con los buques amarrados. Luz de mañana con bruma sobre el agua.
  puerto: {
    label: 'Puerto',
    road: '#4a4f57',
    roadSpeckle: '#585e68',
    edgeLine: '#ffd23d',
    centerLine: '#ffd23d',
    centerDashed: true,
    curbA: '#ffd23d',
    curbB: '#2a2e35',
    ground: '#8d9199',
    groundAccent: '#9ba0a8',
    groundPattern: 'hormigon',
    groundFar: 0x7e838b,
    skyTop: 0x2a6fa8,
    skyMiddle: 0x8fb6cf,
    skyBottom: 0xd9e3e8,
    fog: 0xaebfc9,
    fogNear: 300,
    fogFar: 1100,
    sunColor: 0xfff2dd,
    sunIntensity: 1.4,
    hemiSky: 0xc3d6e4,
    hemiGround: 0x8a8f96,
    hemiIntensity: 1.15,
    scenery: 'puerto',
    // Colores de contenedor: los de verdad vienen en pocos colores fuertes.
    sceneryColors: [0xc23a2c, 0x2f6fb5, 0xd98b1f, 0x2f8f5f, 0xb0b5bc, 0x7a4fa0],
    sceneryDensity: 0.82,
    water: { color: 0x2c5f78, drop: 5, shore: 95 },
  },

  // Miami: arena, palmeras, agua turquesa y, del lado de adentro, la zona
  // céntrica con edificios art déco, marquesinas y neones.
  miami: {
    label: 'Costa Miami',
    road: '#4c4a52',
    roadSpeckle: '#5b5861',
    edgeLine: '#fff6ea',
    centerLine: '#ffe2a8',
    centerDashed: true,
    curbA: '#fff6ea',
    curbB: '#ff5fa8',
    ground: '#efdcb4',
    groundAccent: '#f8ecd2',
    groundPattern: 'arena',
    groundFar: 0xe6d2a8,
    skyTop: 0x1f7fd0,
    skyMiddle: 0x7fd0e8,
    skyBottom: 0xffd9b0,
    fog: 0xbfe2ee,
    fogNear: 340,
    fogFar: 1200,
    sunColor: 0xfff0d6,
    sunIntensity: 1.6,
    hemiSky: 0xbfe8f5,
    hemiGround: 0xd8c49a,
    hemiIntensity: 1.2,
    scenery: 'miami',
    sceneryColors: [0xff5fa8, 0x2fd6d0, 0xffd93d, 0xa96ce0, 0xfff0f7, 0x5fc8ff],
    sceneryDensity: 0.74,
    water: { color: 0x14a3c4, drop: 3, shore: 120 },
  },
};
