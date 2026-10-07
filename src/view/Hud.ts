import type { RaceConfig } from '../core/GameConfig';
import { ITEMS } from '../items/ItemTypes';
import { formatTime } from '../race/LapTracker';
import type { RaceDirector } from '../race/RaceDirector';
import type { Racer } from '../race/Racer';
import { TUNING } from '../kart/KartPhysics';
import type { ItemSystem } from '../items/ItemSystem';
import type { TrackPath } from '../track/TrackPath';
import type { ThemePalette } from '../track/themes';
import { Minimap } from './Minimap';

const TIER_COLORS = ['#4aa8ff', '#ff9c20', '#c06bff'];

/**
 * HUD en DOM sobre el canvas.
 *
 * Mantenerlo en HTML en lugar de dibujarlo en el canvas nos da texto nítido en
 * pantallas HiDPI, se adapta solo al tamaño de la ventana y permite estilarlo
 * sin tocar el render loop.
 */
export class Hud {
  private readonly root: HTMLElement;
  private readonly lapEl: HTMLElement;
  private readonly lapTotalEl: HTMLElement;
  private readonly posBox: HTMLElement;
  private readonly posEl: HTMLElement;
  private readonly posTotalEl: HTMLElement;
  private readonly timeEl: HTMLElement;
  private readonly bestEl: HTMLElement;
  private readonly lastEl: HTMLElement;
  private readonly speedEl: HTMLElement;
  private readonly driftFill: HTMLElement;
  private readonly itemSlot: HTMLElement;
  private readonly itemIcon: HTMLElement;
  private readonly centerMsg: HTMLElement;
  private readonly warning: HTMLElement;
  private readonly mapCanvas: HTMLCanvasElement;

  /** Minimapa. Se arma cuando el juego le pasa la pista. */
  minimap: Minimap | null = null;

  private messageTimer = 0;
  private lastCountdownShown = -1;
  private shownItem: string | null = null;

  constructor(document: Document) {
    this.root = required(document, 'hud');
    this.lapEl = required(document, 'hud-lap');
    this.lapTotalEl = required(document, 'hud-lap-total');
    this.posBox = required(document, 'hud-position-box');
    this.posEl = required(document, 'hud-position');
    this.posTotalEl = required(document, 'hud-position-total');
    this.timeEl = required(document, 'hud-time');
    this.bestEl = required(document, 'hud-best');
    this.lastEl = required(document, 'hud-last');
    this.speedEl = required(document, 'hud-speed');
    this.driftFill = required(document, 'hud-drift-fill');
    this.itemSlot = required(document, 'hud-item');
    this.itemIcon = required(document, 'hud-item-icon');
    this.centerMsg = required(document, 'hud-center-msg');
    this.warning = required(document, 'hud-warning');
    this.mapCanvas = required(document, 'hud-map') as HTMLCanvasElement;
  }

  /** Arma el minimapa para el circuito de esta carrera. */
  buildMinimap(path: TrackPath, palette: ThemePalette): void {
    this.minimap = new Minimap(this.mapCanvas, path, palette);
  }

  show(config: RaceConfig, racerCount: number): void {
    this.root.classList.remove('hidden');
    this.lapTotalEl.textContent = `/${config.laps}`;
    this.posTotalEl.textContent = `/${racerCount}`;
    // En contrarreloj no hay a quién ganarle: la posición sólo ocuparía lugar.
    this.posBox.classList.toggle('hidden', racerCount < 2);
    this.lastCountdownShown = -1;
    this.shownItem = null;
    this.setItem(null);
    this.centerMsg.style.display = '';
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  /** Mensaje grande y efímero en el centro de la pantalla. */
  flash(text: string, seconds = 1.2): void {
    this.centerMsg.textContent = text;
    this.centerMsg.classList.add('show');
    this.messageTimer = seconds;
  }

  update(
    dt: number,
    player: Racer,
    director: RaceDirector,
    racerCount: number,
    racers: Racer[] = [player],
    items: ItemSystem | null = null,
  ): void {
    const telemetry = player.telemetry;
    if (!telemetry) return;

    this.minimap?.update(racers, player, items);

    this.speedEl.textContent = String(Math.round(Math.abs(telemetry.speedKmh)));
    this.lapEl.textContent = String(Math.min(player.laps.lap, player.laps.totalLaps));
    this.posEl.textContent = String(player.position);
    this.timeEl.textContent = formatTime(player.laps.lapTime);
    this.bestEl.textContent = formatTime(player.laps.bestLapTime);
    this.lastEl.textContent = formatTime(player.laps.lastLapTime);

    this.setItem(player.item);
    this.updateDriftBar(telemetry);
    this.updateCountdown(director);

    this.warning.classList.toggle('hidden', !telemetry.wrongWay);
    this.root.classList.toggle('spinning', telemetry.spinning);

    void racerCount;

    if (this.messageTimer > 0) {
      this.messageTimer -= dt;
      if (this.messageTimer <= 0) this.centerMsg.classList.remove('show');
    }
  }

  private setItem(item: string | null): void {
    if (item === this.shownItem) return;
    this.shownItem = item;
    if (!item) {
      this.itemSlot.classList.remove('filled');
      this.itemIcon.textContent = '';
      return;
    }
    const def = ITEMS[item as keyof typeof ITEMS];
    this.itemSlot.classList.add('filled');
    this.itemIcon.textContent = def.icon;
    this.itemSlot.style.setProperty('--item-color', `#${def.color.toString(16).padStart(6, '0')}`);
  }

  private updateDriftBar(telemetry: Racer['telemetry']): void {
    if (!telemetry) return;
    const tiers = TUNING.driftTiers;
    const maxCharge = tiers[tiers.length - 1].charge;
    const charge = telemetry.drift.active ? telemetry.drift.charge : 0;
    const ratio = Math.min(1, charge / maxCharge);

    this.driftFill.style.width = `${ratio * 100}%`;
    const tier = telemetry.drift.tier;
    this.driftFill.style.backgroundColor =
      tier > 0 ? TIER_COLORS[tier - 1] : 'rgba(255,255,255,0.35)';
  }

  private updateCountdown(director: RaceDirector): void {
    if (director.phase !== 'countdown') {
      if (this.lastCountdownShown === 0) {
        this.flash('¡YA!', 0.9);
        this.lastCountdownShown = -1;
      }
      return;
    }
    const n = Math.ceil(director.countdown - 0.5);
    if (n !== this.lastCountdownShown && n > 0) {
      this.lastCountdownShown = n;
      this.flash(String(n), 1);
    } else if (n <= 0) {
      this.lastCountdownShown = 0;
    }
  }
}

function required(doc: Document, id: string): HTMLElement {
  const el = doc.getElementById(id);
  if (!el) throw new Error(`Falta el elemento #${id} en el HUD`);
  return el;
}
