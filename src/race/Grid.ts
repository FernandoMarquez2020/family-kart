import * as THREE from 'three';
import {
  CHARACTERS,
  displayName,
  getCharacter,
  type CharacterSpec,
} from '../characters/CharacterSpec';

export interface GridEntry {
  character: CharacterSpec;
  name: string;
  isPlayer: boolean;
}

/**
 * Arma la parrilla de largada.
 *
 * El jugador va primero y los rivales salen de los otros personajes. Si se
 * piden más karts que personajes hay, se generan variantes: mismo piloto con la
 * librea en otro tono y otro número, para que se distingan en pista sin tener
 * que inventar personajes nuevos.
 */
export function buildGrid(playerCharacterId: string, count: number): GridEntry[] {
  const player = getCharacter(playerCharacterId);
  const others = CHARACTERS.filter((c) => c.id !== player.id);
  const entries: GridEntry[] = [
    { character: player, name: displayName(player), isPlayer: true },
  ];

  for (let i = 0; i < count - 1; i++) {
    const base = others[i % others.length];
    const round = Math.floor(i / others.length);
    if (round === 0) {
      entries.push({ character: base, name: displayName(base), isPlayer: false });
    } else {
      entries.push({
        character: variant(base, round),
        name: `${displayName(base)} ${round + 1}`,
        isPlayer: false,
      });
    }
  }

  return entries;
}

/** Copia de un personaje con otro tono de kart y otro número. */
function variant(base: CharacterSpec, round: number): CharacterSpec {
  const shift = 0.17 * round + 0.34;
  const body = rotateHue(base.kart.body, shift);
  const accent = rotateHue(base.kart.accent, shift * 0.5);
  const number = String(((Number(base.kart.number) + round * 11) % 89) + 11);

  return {
    ...base,
    id: `${base.id}-v${round}`,
    kart: { ...base.kart, body, accent, number },
  };
}

function rotateHue(color: number, amount: number): number {
  const c = new THREE.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  // Le damos un piso de saturación: si no, rotar el tono de un gris no cambia
  // nada y dos karts quedarían idénticos.
  c.setHSL((hsl.h + amount) % 1, Math.max(0.45, hsl.s), Math.min(0.72, Math.max(0.34, hsl.l)));
  return c.getHex();
}
