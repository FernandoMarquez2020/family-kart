/**
 * Esquemas de teclado y preferencias de control.
 *
 * El mapa de teclas no está clavado en `Input` porque no todos los teclados son
 * iguales: en un AZERTY la W y la A están en otro lado, y en una notebook chica
 * las flechas quedan incómodas. Cada esquema es sólo una tabla de
 * `KeyboardEvent.code` → acción, así que agregar uno es agregar una entrada acá.
 *
 * Se usa `code` y no `key` a propósito: `code` es la posición física de la
 * tecla, o sea que "la tecla que está arriba de la S" es la misma sin importar
 * la distribución que tenga configurada el sistema operativo.
 */

export type ControlAction = 'up' | 'down' | 'left' | 'right' | 'drift' | 'use' | 'reset';

export type LayoutId = 'flechas' | 'wasd' | 'zqsd' | 'ijkl';

export interface KeyboardLayout {
  id: LayoutId;
  label: string;
  /** Resumen corto para el menú. */
  hint: string;
  /** Teclas visibles en la ayuda del pie del menú: [teclas, qué hace]. */
  legend: [string[], string][];
  keys: Record<string, ControlAction>;
}

/** Filas de la ayuda que son iguales en todos los esquemas. */
const COMMON_LEGEND: [string[], string][] = [
  [['Esc'], 'opciones'],
  [['R'], 'volver a la pista'],
];

/** Teclas que funcionan en todos los esquemas. */
const COMMON: Record<string, ControlAction> = {
  Space: 'drift',
  ShiftLeft: 'use',
  ShiftRight: 'use',
  Enter: 'use',
  KeyR: 'reset',
};

export const KEYBOARD_LAYOUTS: Record<LayoutId, KeyboardLayout> = {
  flechas: {
    id: 'flechas',
    label: 'Flechas',
    hint: '↑ ↓ ← →  ·  Espacio derrape  ·  Shift poder',
    legend: [
      [['↑'], 'acelerar'],
      [['↓'], 'frenar / reversa'],
      [['←', '→'], 'doblar'],
      [['Espacio'], 'saltar y derrapar'],
      [['Shift'], 'usar el poder'],
      ...COMMON_LEGEND,
    ],
    keys: {
      ...COMMON,
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
      KeyX: 'use',
    },
  },
  wasd: {
    id: 'wasd',
    label: 'WASD',
    hint: 'W A S D  ·  Espacio derrape  ·  E poder',
    legend: [
      [['W'], 'acelerar'],
      [['S'], 'frenar / reversa'],
      [['A', 'D'], 'doblar'],
      [['Espacio'], 'saltar y derrapar'],
      [['E'], 'usar el poder'],
      ...COMMON_LEGEND,
    ],
    keys: {
      ...COMMON,
      KeyW: 'up',
      KeyS: 'down',
      KeyA: 'left',
      KeyD: 'right',
      KeyE: 'use',
    },
  },
  zqsd: {
    id: 'zqsd',
    label: 'ZQSD',
    hint: 'Z Q S D (AZERTY)  ·  Espacio derrape  ·  A poder',
    legend: [
      [['Z'], 'acelerar'],
      [['S'], 'frenar / reversa'],
      [['Q', 'D'], 'doblar'],
      [['Espacio'], 'saltar y derrapar'],
      [['A'], 'usar el poder'],
      ...COMMON_LEGEND,
    ],
    keys: {
      ...COMMON,
      // En un teclado AZERTY, la tecla marcada Z está donde el QWERTY tiene la W.
      KeyW: 'up',
      KeyS: 'down',
      KeyA: 'left',
      KeyD: 'right',
      KeyQ: 'use',
    },
  },
  ijkl: {
    id: 'ijkl',
    label: 'IJKL',
    hint: 'I J K L  ·  N derrape  ·  M poder',
    legend: [
      [['I'], 'acelerar'],
      [['K'], 'frenar / reversa'],
      [['J', 'L'], 'doblar'],
      [['N'], 'saltar y derrapar'],
      [['M'], 'usar el poder'],
      ...COMMON_LEGEND,
    ],
    keys: {
      ...COMMON,
      KeyI: 'up',
      KeyK: 'down',
      KeyJ: 'left',
      KeyL: 'right',
      KeyN: 'drift',
      KeyM: 'use',
    },
  },
};

export const LAYOUT_ORDER: LayoutId[] = ['flechas', 'wasd', 'zqsd', 'ijkl'];

/** ZQSD comparte teclas físicas con WASD; sólo cambia cómo se rotula. */
export const DEFAULT_LAYOUT: LayoutId = 'flechas';

export type TouchMode = 'auto' | 'si' | 'no';

export interface ControlPrefs {
  layout: LayoutId;
  touch: TouchMode;
}

const STORAGE_KEY = 'kart-royale:controles';

/** ¿El dispositivo es táctil? Decide el modo `auto`. */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  return coarse || navigator.maxTouchPoints > 0;
}

export function loadControlPrefs(): ControlPrefs {
  const fallback: ControlPrefs = { layout: DEFAULT_LAYOUT, touch: 'auto' };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<ControlPrefs>;
    return {
      layout: parsed.layout && KEYBOARD_LAYOUTS[parsed.layout] ? parsed.layout : DEFAULT_LAYOUT,
      touch: parsed.touch === 'si' || parsed.touch === 'no' ? parsed.touch : 'auto',
    };
  } catch {
    // Modo privado o almacenamiento bloqueado: se juega igual, sin recordar.
    return fallback;
  }
}

export function saveControlPrefs(prefs: ControlPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* sin persistencia, pero el juego sigue */
  }
}

/** ¿Hay que mostrar los botones en pantalla con estas preferencias? */
export function shouldShowTouch(prefs: ControlPrefs): boolean {
  if (prefs.touch === 'si') return true;
  if (prefs.touch === 'no') return false;
  return isTouchDevice();
}
