import type { Difficulty } from '../race/AiDriver';

export type GameMode = 'contrarreloj' | 'carrera' | 'torneo';

export interface ModeSpec {
  id: GameMode;
  label: string;
  icon: string;
  blurb: string;
  /** ¿Se elige la pista? En el torneo se corren todas. */
  choosesTrack: boolean;
  /** ¿Se eligen rivales y dificultad? */
  hasRivals: boolean;
}

export const MODES: Record<GameMode, ModeSpec> = {
  contrarreloj: {
    id: 'contrarreloj',
    label: 'Contrarreloj',
    icon: '⏱',
    blurb: 'Solo en la pista. Bajá tu mejor vuelta.',
    choosesTrack: true,
    hasRivals: false,
  },
  carrera: {
    id: 'carrera',
    label: 'Carrera',
    icon: '🏁',
    blurb: 'Una carrera contra rivales en la pista que elijas.',
    choosesTrack: true,
    hasRivals: true,
  },
  torneo: {
    id: 'torneo',
    label: 'Torneo',
    icon: '🏆',
    blurb: 'Una carrera en la pista de cada piloto. Gana el que sume más puntos.',
    choosesTrack: false,
    hasRivals: true,
  },
};

export const MODE_ORDER: GameMode[] = ['contrarreloj', 'carrera', 'torneo'];

/** Cantidades de karts que se pueden elegir. */
export const RACER_COUNTS = [2, 4, 6, 8];

export interface RaceConfig {
  mode: GameMode;
  /** Personaje del jugador. */
  characterId: string;
  /** Personaje cuya pista se corre. */
  trackCharacterId: string;
  racerCount: number;
  difficulty: Difficulty;
  laps: number;
}

export const DEFAULT_CONFIG: RaceConfig = {
  mode: 'carrera',
  characterId: 'futbol',
  trackCharacterId: 'futbol',
  racerCount: 4,
  difficulty: 'normal',
  laps: 3,
};
