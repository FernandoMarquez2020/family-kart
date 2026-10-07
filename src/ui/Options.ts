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

/**
 * Opciones durante la carrera.
 *
 * Abre una pausa real (la simulación se detiene) para poder cambiar el esquema
 * de teclado sin perder la carrera: probar controles nuevos mientras el kart
 * sigue andando es la forma más rápida de terminar contra el muro.
 */

const TOUCH_MODES: { value: TouchMode; label: string }[] = [
  { value: 'auto', label: 'Automático' },
  { value: 'si', label: 'Siempre' },
  { value: 'no', label: 'Nunca' },
];

export class Options {
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly openBtn: HTMLButtonElement;
  private prefs: ControlPrefs;
  private open = false;

  /** Se avisa cuando cambian las preferencias, para aplicarlas al vuelo. */
  onChange: ((prefs: ControlPrefs) => void) | null = null;
  /** Se avisa al abrir y cerrar, para pausar y reanudar. */
  onToggle: ((open: boolean) => void) | null = null;
  /** Salir al menú. Vive acá porque en celular no hay botón de "Salir". */
  onExit: (() => void) | null = null;

  constructor(document: Document) {
    this.prefs = loadControlPrefs();

    this.openBtn = document.createElement('button');
    this.openBtn.type = 'button';
    this.openBtn.id = 'options-btn';
    this.openBtn.className = 'hidden';
    this.openBtn.setAttribute('aria-label', 'Opciones');
    this.openBtn.textContent = '⚙';
    this.openBtn.addEventListener('click', () => this.toggle());

    this.root = document.createElement('div');
    this.root.id = 'options';
    this.root.className = 'hidden';

    const panel = document.createElement('div');
    panel.className = 'options-panel';

    const title = document.createElement('h2');
    title.textContent = 'Opciones';

    this.body = document.createElement('div');
    this.body.className = 'options';

    const close = document.createElement('button');
    close.type = 'button';
    close.id = 'options-close';
    close.className = 'primary-btn';
    close.textContent = 'SEGUIR CORRIENDO';
    close.addEventListener('click', () => this.toggle(false));

    const exit = document.createElement('button');
    exit.type = 'button';
    exit.id = 'options-exit';
    exit.className = 'ghost-btn';
    exit.textContent = 'Volver al menú';
    exit.addEventListener('click', () => {
      this.toggle(false);
      this.onExit?.();
    });

    const actions = document.createElement('div');
    actions.className = 'results-actions';
    actions.append(close, exit);

    panel.append(title, this.body, actions);
    this.root.append(panel);

    const app = document.getElementById('app');
    app?.append(this.openBtn, this.root);

    document.addEventListener('keydown', this.onKey);
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.code !== 'Escape' && e.code !== 'KeyP') return;
    if (this.openBtn.classList.contains('hidden')) return;
    e.preventDefault();
    this.toggle();
  };

  /** Muestra u oculta el botón de engranaje (sólo hay opciones en carrera). */
  setAvailable(available: boolean): void {
    this.openBtn.classList.toggle('hidden', !available);
    if (!available) this.toggle(false);
  }

  toggle(force?: boolean): void {
    const next = force ?? !this.open;
    if (next === this.open) return;
    this.open = next;
    this.root.classList.toggle('hidden', !next);
    if (next) this.render();
    this.onToggle?.(next);
  }

  get isOpen(): boolean {
    return this.open;
  }

  get current(): ControlPrefs {
    return { ...this.prefs };
  }

  private update(patch: Partial<ControlPrefs>): void {
    this.prefs = { ...this.prefs, ...patch };
    saveControlPrefs(this.prefs);
    this.onChange?.(this.current);
    this.render();
  }

  private render(): void {
    const layoutRow = buildChoiceRow(
      'Teclado',
      LAYOUT_ORDER.map((id) => ({ value: id, label: KEYBOARD_LAYOUTS[id].label })),
      this.prefs.layout,
      (value) => this.update({ layout: value as LayoutId }),
    );

    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.id = 'options-hint';
    hint.textContent = KEYBOARD_LAYOUTS[this.prefs.layout].hint;

    const touchRow = buildChoiceRow(
      'Botones en pantalla',
      TOUCH_MODES,
      this.prefs.touch,
      (value) => this.update({ touch: value as TouchMode }),
    );

    const touchHint = document.createElement('p');
    touchHint.className = 'hint';
    touchHint.textContent = isTouchDevice()
      ? 'En automático aparecen solos, porque estás en una pantalla táctil.'
      : 'En automático no aparecen: este dispositivo no es táctil.';

    this.body.replaceChildren(layoutRow, hint, touchRow, touchHint);
  }
}

/** Fila de opciones con chips. Misma pinta que la del menú. */
export function buildChoiceRow(
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
    btn.addEventListener('click', () => onPick(option.value));
    choices.append(btn);
  }
  row.append(choices);
  return row;
}
