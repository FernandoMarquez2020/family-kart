import {
  CHARACTERS,
  displayName,
  getCharacter,
  loadNames,
  saveName,
  type CharacterSpec,
} from '../characters/CharacterSpec';
import { makeAvatarDataUrl } from '../characters/faces';
import { PORTRAIT_PHOTOS } from '../characters/photos';
import { BACKDROP, FIGURES } from './Intro';
import {
  DEFAULT_CONFIG,
  MODES,
  MODE_ORDER,
  RACER_COUNTS,
  type GameMode,
  type RaceConfig,
} from '../core/GameConfig';
import { DIFFICULTIES, DIFFICULTY_ORDER, type Difficulty } from '../race/AiDriver';
import {
  KEYBOARD_LAYOUTS,
  LAYOUT_ORDER,
  isTouchDevice,
  loadControlPrefs,
  saveControlPrefs,
  type ControlPrefs,
  type LayoutId,
  type TouchMode,
} from '../core/Controls';

type Step = 'modo' | 'piloto' | 'pista' | 'rivales' | 'controles';

const STEP_LABELS: Record<Step, string> = {
  modo: 'Elegí cómo querés jugar.',
  piloto: 'Elegí tu piloto.',
  pista: 'Elegí la pista.',
  rivales: 'Cuántos karts y qué tan difícil.',
  controles: 'Con qué querés manejar.',
};

const TOUCH_MODES: { value: TouchMode; label: string }[] = [
  { value: 'auto', label: 'Automático' },
  { value: 'si', label: 'Siempre' },
  { value: 'no', label: 'Nunca' },
];

/**
 * Menú por pasos: modo → piloto → pista → rivales.
 *
 * Los pasos que no aplican al modo elegido se saltean solos (el torneo corre
 * todas las pistas, la contrarreloj no tiene rivales), así que el jugador nunca
 * ve una pantalla que no decide nada.
 */
export class Menu {
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly label: HTMLElement;
  private readonly backBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;

  private config: RaceConfig = { ...DEFAULT_CONFIG };
  private step: Step = 'modo';
  private controls: ControlPrefs = loadControlPrefs();

  onStart: ((config: RaceConfig) => void) | null = null;
  /** El jugador eligió jugar en red en lugar de contra la máquina. */
  onOnline: (() => void) | null = null;
  /** Se avisa cuando se tocan los controles, para aplicarlos enseguida. */
  onControlsChange: ((prefs: ControlPrefs) => void) | null = null;

  constructor(document: Document) {
    this.root = required(document, 'menu');
    this.body = required(document, 'menu-body');
    this.label = required(document, 'menu-step-label');
    this.backBtn = required(document, 'menu-back') as HTMLButtonElement;
    this.nextBtn = required(document, 'menu-next') as HTMLButtonElement;

    this.backBtn.addEventListener('click', () => this.goBack());
    this.nextBtn.addEventListener('click', () => this.goNext());

    // El menú vive en el mismo mundo que la presentación: mismo fondo, mismos
    // vehículos. Sin esto, la portada se siente pegada por fuera del juego.
    this.root.style.backgroundImage = `url(${BACKDROP})`;
  }

  open(step: Step = 'modo'): void {
    this.step = step;
    // Otra pantalla (las opciones en carrera) puede haber cambiado los controles
    // mientras el menú estaba cerrado.
    this.controls = loadControlPrefs();
    this.root.classList.remove('hidden');
    this.render();
  }

  /** Preferencias de control elegidas. */
  get controlPrefs(): ControlPrefs {
    return { ...this.controls };
  }

  close(): void {
    this.root.classList.add('hidden');
  }

  /** Lo elegido hasta ahora. La partida en red lo usa para armar la carrera. */
  get current(): RaceConfig {
    return { ...this.config };
  }

  /** Pasos que aplican al modo elegido, en orden. */
  private get steps(): Step[] {
    const mode = MODES[this.config.mode];
    const list: Step[] = ['modo', 'piloto'];
    if (mode.choosesTrack) list.push('pista');
    if (mode.hasRivals) list.push('rivales');
    list.push('controles');
    return list;
  }

  private goBack(): void {
    const steps = this.steps;
    const i = steps.indexOf(this.step);
    if (i <= 0) return;
    this.step = steps[i - 1];
    this.render();
  }

  private goNext(): void {
    const steps = this.steps;
    const i = steps.indexOf(this.step);
    if (i === steps.length - 1) {
      this.close();
      this.onStart?.({ ...this.config });
      return;
    }
    this.step = steps[i + 1];
    this.render();
  }

  private render(): void {
    const steps = this.steps;
    const i = steps.indexOf(this.step);
    this.label.textContent = STEP_LABELS[this.step];
    this.backBtn.classList.toggle('hidden', i <= 0);
    this.nextBtn.textContent = i === steps.length - 1 ? '¡A CORRER!' : 'SIGUIENTE';

    switch (this.step) {
      case 'modo':
        this.renderModes();
        break;
      case 'piloto':
        this.renderCharacters('piloto');
        break;
      case 'pista':
        this.renderCharacters('pista');
        break;
      case 'rivales':
        this.renderRivals();
        break;
      case 'controles':
        this.renderControls();
        break;
    }
  }

  private renderControls(): void {
    const wrap = document.createElement('div');
    wrap.className = 'options';

    const layout = this.buildChoiceRow(
      'Teclado',
      LAYOUT_ORDER.map((id) => ({ value: id, label: KEYBOARD_LAYOUTS[id].label })),
      this.controls.layout,
      (value) => this.setControls({ layout: value as LayoutId }),
    );

    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.id = 'menu-layout-hint';
    hint.textContent = KEYBOARD_LAYOUTS[this.controls.layout].hint;

    const touch = this.buildChoiceRow(
      'Botones en pantalla',
      TOUCH_MODES,
      this.controls.touch,
      (value) => this.setControls({ touch: value as TouchMode }),
    );

    const touchHint = document.createElement('p');
    touchHint.className = 'hint';
    touchHint.textContent = isTouchDevice()
      ? 'Estás en una pantalla táctil: en automático los botones aparecen solos.'
      : 'En automático no aparecen; ponelos en "Siempre" si querés probarlos con el mouse.';

    const note = document.createElement('p');
    note.className = 'hint';
    note.textContent = 'Todo esto se puede cambiar en plena carrera con la tecla Esc o el ⚙.';

    wrap.append(layout, hint, touch, touchHint, note);
    this.body.replaceChildren(wrap);
  }

  private setControls(patch: Partial<ControlPrefs>): void {
    this.controls = { ...this.controls, ...patch };
    saveControlPrefs(this.controls);
    this.onControlsChange?.(this.controlPrefs);
    this.updateControlLegend();
    // El redibujado lo hace `buildChoiceRow` al elegir; no hace falta acá.
  }

  /** Mantiene al día la ayuda de teclas del pie del menú. */
  updateControlLegend(): void {
    const legend = document.querySelector('.controls');
    if (!legend) return;
    legend.replaceChildren(
      ...KEYBOARD_LAYOUTS[this.controls.layout].legend.map(([keys, what]) => {
        const row = document.createElement('div');
        for (const key of keys) {
          const kbd = document.createElement('kbd');
          kbd.textContent = key;
          row.append(kbd, ' ');
        }
        row.append(what);
        return row;
      }),
    );
  }

  private renderModes(): void {
    const body = document.createDocumentFragment();

    // La parrilla completa arriba de todo: al abrir el menú se ve de una quiénes
    // corren, que es la pregunta que se hace cualquiera que llega al juego.
    const lineup = document.createElement('div');
    lineup.className = 'menu-lineup';
    for (const spec of CHARACTERS) {
      const img = document.createElement('img');
      img.src = FIGURES[spec.id];
      img.alt = displayName(spec);
      img.title = displayName(spec);
      lineup.append(img);
    }
    body.append(lineup);

    const grid = document.createElement('div');
    grid.className = 'mode-grid';

    for (const id of MODE_ORDER) {
      const mode = MODES[id];
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'mode-card';
      card.dataset.mode = id;
      card.classList.toggle('selected', this.config.mode === id);
      card.innerHTML = `
        <span class="mode-icon">${mode.icon}</span>
        <span class="mode-label">${mode.label}</span>
        <span class="mode-blurb">${mode.blurb}</span>
      `;
      card.addEventListener('click', () => {
        this.config.mode = id as GameMode;
        this.render();
      });
      grid.append(card);
    }

    // El online no es un modo más de la lista: no elige pista ni rivales acá,
    // sino que abre una sala y todo lo demás lo decide el anfitrión.
    const online = document.createElement('button');
    online.type = 'button';
    online.className = 'mode-card online-card';
    online.innerHTML = `
      <span class="mode-icon">🌐</span>
      <span class="mode-label">Jugar con otros</span>
      <span class="mode-blurb">Abrí una sala y pasá el link. Los lugares que sobren los llena la máquina.</span>
    `;
    online.addEventListener('click', () => this.onOnline?.());
    grid.append(online);

    body.append(grid);
    this.body.replaceChildren(body);
  }

  private renderCharacters(kind: 'piloto' | 'pista'): void {
    const names = loadNames();
    const grid = document.createElement('div');
    grid.className = 'character-grid';

    const selectedId =
      kind === 'piloto' ? this.config.characterId : this.config.trackCharacterId;

    for (const spec of CHARACTERS) {
      grid.append(this.buildCharacterCard(spec, names, kind, selectedId));
    }

    this.body.replaceChildren(grid);
  }

  private buildCharacterCard(
    spec: CharacterSpec,
    names: Record<string, string>,
    kind: 'piloto' | 'pista',
    selectedId: string,
  ): HTMLElement {
    const card = document.createElement('div');
    card.className = 'char-card';
    card.dataset.character = spec.id;
    card.dataset.kind = kind;
    card.classList.toggle('selected', spec.id === selectedId);
    card.style.setProperty('--card-body', hex(cardColor(spec)));
    card.style.setProperty('--card-accent', hex(spec.kart.numberPanel));
    card.style.setProperty('--card-ink', hex(spec.kart.numberInk));

    const number = document.createElement('span');
    number.className = 'char-number';
    number.textContent = spec.kart.number;

    const avatar = document.createElement('img');
    avatar.className = 'char-avatar';
    // La foto real del piloto. El retrato dibujado queda de reserva: si mañana
    // se agrega un personaje sin foto, la tarjeta sigue teniendo cara.
    avatar.src = PORTRAIT_PHOTOS[spec.id] ?? makeAvatarDataUrl(spec.appearance);
    avatar.alt = '';

    card.append(number, avatar);

    if (kind === 'piloto') {
      // El nombre es editable, así que su click no debe seleccionar la tarjeta.
      const name = document.createElement('input');
      name.className = 'char-name';
      name.type = 'text';
      name.id = `name-${spec.id}`;
      name.maxLength = 14;
      name.value = displayName(spec, names);
      name.setAttribute('aria-label', `Nombre del piloto ${spec.kart.number}`);
      name.addEventListener('click', (e) => e.stopPropagation());
      name.addEventListener('change', () => saveName(spec.id, name.value));
      card.append(name);
    } else {
      const title = document.createElement('div');
      title.className = 'char-name static';
      title.textContent = displayName(spec, names);
      card.append(title);
    }

    // El render del vehículo: la misma figura de la presentación, en chico.
    const figure = document.createElement('img');
    figure.className = 'char-figure';
    figure.src = FIGURES[spec.id];
    figure.alt = '';
    figure.loading = 'lazy';
    card.append(figure);

    const track = document.createElement('div');
    track.className = 'char-track';
    track.textContent = spec.trackName;

    const tagline = document.createElement('p');
    tagline.className = 'char-tagline';
    tagline.textContent = spec.tagline;

    card.append(track, tagline);

    card.addEventListener('click', () => {
      if (kind === 'piloto') {
        this.config.characterId = spec.id;
        // Por defecto, la pista del piloto elegido.
        this.config.trackCharacterId = spec.id;
      } else {
        this.config.trackCharacterId = spec.id;
      }
      this.render();
    });

    return card;
  }

  private renderRivals(): void {
    const wrap = document.createElement('div');
    wrap.className = 'options';

    wrap.append(
      this.buildChoiceRow(
        'Cantidad de karts',
        RACER_COUNTS.map((n) => ({ value: String(n), label: String(n) })),
        String(this.config.racerCount),
        (value) => {
          this.config.racerCount = Number(value);
        },
      ),
      this.buildChoiceRow(
        'Dificultad',
        DIFFICULTY_ORDER.map((d) => ({ value: d, label: DIFFICULTIES[d].label })),
        this.config.difficulty,
        (value) => {
          this.config.difficulty = value as Difficulty;
        },
      ),
      this.buildChoiceRow(
        'Vueltas',
        [2, 3, 5].map((n) => ({ value: String(n), label: String(n) })),
        String(this.config.laps),
        (value) => {
          this.config.laps = Number(value);
        },
      ),
    );

    if (this.config.mode === 'torneo') {
      const note = document.createElement('p');
      note.className = 'hint';
      // El texto sale de la lista de personajes: si mañana hay ocho pistas, el
      // menú no queda mintiendo.
      note.textContent = `El torneo corre una carrera en cada una de las ${CHARACTERS.length} pistas. Puntos por carrera: 10, 8, 6, 5…`;
      wrap.append(note);
    }

    this.body.replaceChildren(wrap);
  }

  private buildChoiceRow(
    title: string,
    options: { value: string; label: string }[],
    selected: string,
    onPick: (value: string) => void,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'option-row';

    const label = document.createElement('span');
    label.className = 'option-label';
    label.textContent = title;
    row.append(label);

    const choices = document.createElement('div');
    choices.className = 'option-choices';
    for (const option of options) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
      btn.dataset.value = option.value;
      btn.textContent = option.label;
      btn.classList.toggle('selected', option.value === selected);
      btn.addEventListener('click', () => {
        onPick(option.value);
        this.render();
      });
      choices.append(btn);
    }
    row.append(choices);
    return row;
  }
}

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** Luminancia relativa aproximada, 0 = negro, 1 = blanco. */
function luminance(color: number): number {
  const r = ((color >> 16) & 0xff) / 255;
  const g = ((color >> 8) & 0xff) / 255;
  const b = (color & 0xff) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Color con el que se pinta la tarjeta. Normalmente es el del kart, pero si es
 * muy oscuro (el kart neón es casi negro) el texto quedaría ilegible sobre el
 * fondo del menú, así que se usa el color de acento.
 */
function cardColor(spec: CharacterSpec): number {
  return luminance(spec.kart.body) < 0.22 ? spec.kart.accent : spec.kart.body;
}

function required(doc: Document, id: string): HTMLElement {
  const el = doc.getElementById(id);
  if (!el) throw new Error(`Falta el elemento #${id}`);
  return el;
}

export { getCharacter };
