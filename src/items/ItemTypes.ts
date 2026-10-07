/**
 * Los poderes que se agarran en las cajas de la pista.
 *
 * Son sólo datos: el sistema de poderes (`ItemSystem`) decide qué hace cada uno
 * al usarse. Agregar un poder es agregar una entrada acá y un caso en `use()`.
 */

export type ItemId = 'banana' | 'rayo' | 'misil' | 'fuego';

export interface ItemDef {
  id: ItemId;
  /** Nombre visible en el HUD. */
  label: string;
  /** Emoji del HUD. */
  icon: string;
  /** Color del kart/proyectil. */
  color: number;
  /** Peso relativo en el sorteo de la caja. */
  weight: number;
  /** Texto corto de ayuda. */
  hint: string;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  banana: {
    id: 'banana',
    label: 'Banana',
    icon: '🍌',
    color: 0xffd93d,
    weight: 0.34,
    hint: 'La dejás atrás. El que la pisa se va de trompo.',
  },
  fuego: {
    id: 'fuego',
    label: 'Bola de fuego',
    icon: '🔥',
    color: 0xff6a1f,
    weight: 0.28,
    hint: 'Sale derecho para adelante.',
  },
  misil: {
    id: 'misil',
    label: 'Misil',
    icon: '🚀',
    color: 0x4aa8ff,
    weight: 0.24,
    hint: 'Persigue al que va adelante tuyo.',
  },
  rayo: {
    id: 'rayo',
    label: 'Rayo',
    icon: '⚡',
    color: 0xfff04a,
    weight: 0.14,
    hint: 'Vas más rápido y nada te afecta.',
  },
};

export const ITEM_ORDER: ItemId[] = ['banana', 'fuego', 'misil', 'rayo'];

/**
 * Sortea un poder.
 *
 * `positionRatio` va de 0 (puntero) a 1 (último): al que va último le salen más
 * seguido los poderes fuertes, que es lo que mantiene la carrera pareja entre
 * chicos de distinta edad.
 */
export function rollItem(random: () => number, positionRatio: number): ItemId {
  const weights = ITEM_ORDER.map((id) => {
    const def = ITEMS[id];
    if (id === 'rayo') return def.weight * (0.35 + positionRatio * 2.2);
    if (id === 'misil') return def.weight * (0.6 + positionRatio * 1.2);
    if (id === 'banana') return def.weight * (1.5 - positionRatio * 0.7);
    return def.weight;
  });

  const total = weights.reduce((a, b) => a + b, 0);
  let pick = random() * total;
  for (let i = 0; i < ITEM_ORDER.length; i++) {
    pick -= weights[i];
    if (pick <= 0) return ITEM_ORDER[i];
  }
  return 'banana';
}
