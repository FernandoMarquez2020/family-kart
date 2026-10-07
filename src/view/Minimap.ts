import type { ItemSystem } from '../items/ItemSystem';
import type { Racer } from '../race/Racer';
import type { TrackPath } from '../track/TrackPath';
import type { ThemePalette } from '../track/themes';

/**
 * Minimapa translúcido.
 *
 * Se dibuja en un canvas 2D aparte en vez de con una segunda cámara 3D: cuesta
 * una fracción de un render completo, se ve nítido en pantallas HiDPI y permite
 * marcar cosas que en 3D no se distinguirían (quién va adelante, dónde quedó la
 * caja, para qué lado sigue la pista).
 *
 * El trazado se dibuja una sola vez en un canvas de fondo y después sólo se
 * repintan los puntitos, que es lo que cambia en cada frame.
 */

const SIZE = 168;
const PADDING = 12;

export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly base: HTMLCanvasElement;
  private readonly dpr: number;

  /** Transformación mundo → mapa. */
  private scale = 1;
  private offsetX = 0;
  private offsetZ = 0;

  private readonly path: TrackPath;

  constructor(canvas: HTMLCanvasElement, path: TrackPath, palette: ThemePalette) {
    this.path = path;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = SIZE * this.dpr;
    canvas.height = SIZE * this.dpr;
    canvas.style.width = `${SIZE}px`;
    canvas.style.height = `${SIZE}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('El minimapa necesita un contexto 2D');
    this.ctx = ctx;

    this.computeTransform();
    this.base = this.drawBase(palette);
  }

  /** Encaja el circuito entero en el cuadro, conservando la proporción. */
  private computeTransform(): void {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const s of this.path.samples) {
      minX = Math.min(minX, s.position.x);
      maxX = Math.max(maxX, s.position.x);
      minZ = Math.min(minZ, s.position.z);
      maxZ = Math.max(maxZ, s.position.z);
    }
    const span = Math.max(maxX - minX, maxZ - minZ) || 1;
    const usable = SIZE - PADDING * 2;
    this.scale = usable / span;
    this.offsetX = PADDING + (usable - (maxX - minX) * this.scale) / 2 - minX * this.scale;
    this.offsetZ = PADDING + (usable - (maxZ - minZ) * this.scale) / 2 - minZ * this.scale;
  }

  private toMapX(x: number): number {
    return x * this.scale + this.offsetX;
  }

  private toMapY(z: number): number {
    return z * this.scale + this.offsetZ;
  }

  /** Canvas de fondo con el trazado, dibujado una sola vez. */
  private drawBase(palette: ThemePalette): HTMLCanvasElement {
    const base = document.createElement('canvas');
    base.width = SIZE * this.dpr;
    base.height = SIZE * this.dpr;
    const ctx = base.getContext('2d')!;
    ctx.scale(this.dpr, this.dpr);

    const step = Math.max(1, Math.floor(this.path.samples.length / 220));
    ctx.beginPath();
    for (let i = 0; i < this.path.samples.length; i += step) {
      const s = this.path.samples[i];
      const x = this.toMapX(s.position.x);
      const y = this.toMapY(s.position.z);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Borde primero, asfalto después: da la sensación de pista con banquina.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = 9;
    ctx.stroke();
    ctx.strokeStyle = palette.road;
    ctx.lineWidth = 6;
    ctx.stroke();

    // Línea de largada.
    const start = this.path.samples[0];
    const sx = this.toMapX(start.position.x);
    const sy = this.toMapY(start.position.z);
    const rx = start.right.x * 5;
    const rz = start.right.z * 5;
    ctx.beginPath();
    ctx.moveTo(sx - rx, sy - rz);
    ctx.lineTo(sx + rx, sy + rz);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    return base;
  }

  /** Repinta los puntitos. Se llama con el reloj del render. */
  update(racers: Racer[], player: Racer, items: ItemSystem | null): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.base, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    if (items) {
      for (const hazard of items.hazardStates) {
        ctx.beginPath();
        ctx.arc(
          this.toMapX(hazard.position.x),
          this.toMapY(hazard.position.z),
          hazard.kind === 'banana' ? 2 : 2.6,
          0,
          Math.PI * 2,
        );
        ctx.fillStyle = hazard.kind === 'banana' ? '#ffd93d' : '#ff8c2a';
        ctx.fill();
      }
    }

    // Los rivales primero y el jugador al final, para que nunca quede tapado.
    for (const racer of racers) {
      if (racer === player) continue;
      this.dot(racer, false);
    }
    this.dot(player, true);
  }

  private dot(racer: Racer, isPlayer: boolean): void {
    const ctx = this.ctx;
    const x = this.toMapX(racer.physics.position.x);
    const y = this.toMapY(racer.physics.position.z);
    const color = `#${racer.character.kart.body.toString(16).padStart(6, '0')}`;

    if (isPlayer) {
      // Triángulo apuntando hacia donde mira el kart: de un vistazo se ve en qué
      // sentido va, que es justo lo que se pierde con un puntito redondo.
      const f = racer.physics.forward;
      const angle = Math.atan2(f.x, f.z);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-angle + Math.PI);
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(4.4, 5);
      ctx.lineTo(-4.4, 5);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      return;
    }

    ctx.beginPath();
    ctx.arc(x, y, 3.6, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  /** Posición de un kart en el mapa, en píxeles CSS. Para los tests. */
  project(racer: Racer): { x: number; y: number } {
    return {
      x: this.toMapX(racer.physics.position.x),
      y: this.toMapY(racer.physics.position.z),
    };
  }

  get size(): number {
    return SIZE;
  }
}
