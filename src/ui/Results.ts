import { formatTime } from '../race/LapTracker';
import type { RaceResult } from '../race/RaceDirector';

export interface StandingRow {
  name: string;
  points: number;
  isPlayer: boolean;
}

/**
 * Pantalla de resultados: clasificación de la carrera y, en el torneo, la tabla
 * de puntos acumulados.
 */
export class Results {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly subtitle: HTMLElement;
  private readonly table: HTMLElement;
  private readonly primary: HTMLButtonElement;
  private readonly menuBtn: HTMLButtonElement;

  onPrimary: (() => void) | null = null;
  onMenu: (() => void) | null = null;

  constructor(document: Document) {
    this.root = required(document, 'results');
    this.title = required(document, 'results-title');
    this.subtitle = required(document, 'results-subtitle');
    this.table = required(document, 'results-table');
    this.primary = required(document, 'results-primary') as HTMLButtonElement;
    this.menuBtn = required(document, 'results-menu') as HTMLButtonElement;

    this.primary.addEventListener('click', () => this.onPrimary?.());
    this.menuBtn.addEventListener('click', () => this.onMenu?.());
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  /** Clasificación de una carrera. */
  showRace(options: {
    title: string;
    subtitle: string;
    results: RaceResult[];
    primaryLabel: string;
    standings?: StandingRow[];
  }): void {
    this.title.textContent = options.title;
    this.subtitle.textContent = options.subtitle;
    this.primary.textContent = options.primaryLabel;

    const rows: HTMLElement[] = [
      header(['#', 'Piloto', 'Tiempo', 'Mejor vuelta']),
      ...options.results.map((r) =>
        row(
          [`${r.position}`, r.name, timeOrGap(r), formatTime(r.bestLap)],
          r.isPlayer,
        ),
      ),
    ];

    if (options.standings?.length) {
      rows.push(sectionTitle('Torneo'));
      rows.push(header(['#', 'Piloto', 'Puntos', '']));
      options.standings.forEach((s, i) => {
        rows.push(row([`${i + 1}`, s.name, `${s.points}`, ''], s.isPlayer));
      });
    }

    this.table.replaceChildren(...rows);
    this.root.classList.remove('hidden');
  }
}

/** Tiempo de llegada, o cuánto le faltaba al que quedó en pista. */
function timeOrGap(r: RaceResult): string {
  if (r.time !== null) return formatTime(r.time);
  if (r.gap === null) return '—';
  return r.gap >= 1000 ? `a ${(r.gap / 1000).toFixed(1)} km` : `a ${Math.round(r.gap)} m`;
}

function header(cells: string[]): HTMLElement {
  const el = document.createElement('div');
  el.className = 'results-row head';
  for (const text of cells) {
    const c = document.createElement('span');
    c.textContent = text;
    el.append(c);
  }
  return el;
}

function row(cells: string[], highlight: boolean): HTMLElement {
  const el = document.createElement('div');
  el.className = 'results-row';
  if (highlight) el.classList.add('mine');
  for (const text of cells) {
    const c = document.createElement('span');
    c.textContent = text;
    el.append(c);
  }
  return el;
}

function sectionTitle(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'results-section';
  el.textContent = text;
  return el;
}

function required(doc: Document, id: string): HTMLElement {
  const el = doc.getElementById(id);
  if (!el) throw new Error(`Falta el elemento #${id}`);
  return el;
}
