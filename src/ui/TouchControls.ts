/**
 * Mandos en pantalla para celular y tablet.
 *
 * Se construyen en DOM, no en el canvas: así el navegador se ocupa del área
 * táctil, de la accesibilidad y de escalar en cualquier pantalla, y no hay que
 * mantener una segunda capa de hit-testing dentro del render loop.
 *
 * Los eventos son de puntero (`pointerdown`/`pointerup`) y no de toque, para que
 * funcionen igual con el dedo, con el mouse y con un lápiz, y se capturan por
 * puntero para no perder un botón si el dedo se corre fuera de él.
 */

export interface TouchInputState {
  throttle: number;
  brake: number;
  steer: number;
  drift: boolean;
  use: boolean;
}

interface ButtonDef {
  id: string;
  label: string;
  className: string;
  onDown: (state: TouchInputState) => void;
  onUp: (state: TouchInputState) => void;
}

const BUTTONS: ButtonDef[] = [
  {
    id: 'touch-left',
    label: '◀',
    className: 'touch-btn touch-steer',
    onDown: (s) => {
      s.steer = -1;
    },
    onUp: (s) => {
      if (s.steer < 0) s.steer = 0;
    },
  },
  {
    id: 'touch-right',
    label: '▶',
    className: 'touch-btn touch-steer',
    onDown: (s) => {
      s.steer = 1;
    },
    onUp: (s) => {
      if (s.steer > 0) s.steer = 0;
    },
  },
  {
    id: 'touch-item',
    label: '★',
    className: 'touch-btn touch-small touch-item',
    onDown: (s) => {
      s.use = true;
    },
    onUp: (s) => {
      s.use = false;
    },
  },
  {
    id: 'touch-drift',
    label: '⤺',
    className: 'touch-btn touch-small touch-drift',
    onDown: (s) => {
      s.drift = true;
    },
    onUp: (s) => {
      s.drift = false;
    },
  },
  {
    id: 'touch-brake',
    label: '▼',
    className: 'touch-btn touch-small touch-brake',
    onDown: (s) => {
      s.brake = 1;
    },
    onUp: (s) => {
      s.brake = 0;
    },
  },
  {
    id: 'touch-gas',
    label: '▲',
    className: 'touch-btn touch-gas',
    onDown: (s) => {
      s.throttle = 1;
    },
    onUp: (s) => {
      s.throttle = 0;
    },
  },
];

export class TouchControls {
  readonly root: HTMLElement;
  readonly state: TouchInputState = { throttle: 0, brake: 0, steer: 0, drift: false, use: false };

  private readonly buttons = new Map<string, HTMLElement>();
  private visible = false;

  constructor(document: Document) {
    this.root = document.createElement('div');
    this.root.id = 'touch-controls';
    this.root.className = 'hidden';

    const left = document.createElement('div');
    left.className = 'touch-cluster touch-left-cluster';

    // El lado derecho va en dos filas: arriba los poderes y el derrape, abajo
    // freno y acelerador. Todo en una sola fila no entra en un celular parado y
    // los dos grupos terminan chocándose en el medio de la pantalla.
    const right = document.createElement('div');
    right.className = 'touch-cluster touch-right-cluster';
    const topRow = document.createElement('div');
    topRow.className = 'touch-row';
    const bottomRow = document.createElement('div');
    bottomRow.className = 'touch-row';
    right.append(topRow, bottomRow);

    for (const def of BUTTONS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = def.id;
      btn.className = def.className;
      btn.textContent = def.label;
      btn.setAttribute('aria-label', def.id.replace('touch-', ''));
      this.wire(btn, def);
      this.buttons.set(def.id, btn);
      if (def.className.includes('touch-steer')) left.append(btn);
      else if (def.className.includes('touch-small') && !def.className.includes('touch-brake')) {
        topRow.append(btn);
      } else bottomRow.append(btn);
    }

    this.root.append(left, right);
    document.getElementById('app')?.append(this.root);
  }

  private wire(btn: HTMLElement, def: ButtonDef): void {
    const press = (e: PointerEvent) => {
      e.preventDefault();
      btn.setPointerCapture?.(e.pointerId);
      btn.classList.add('pressed');
      def.onDown(this.state);
    };
    const release = (e: PointerEvent) => {
      e.preventDefault();
      btn.classList.remove('pressed');
      def.onUp(this.state);
    };
    btn.addEventListener('pointerdown', press);
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    // Si el dedo se va del botón sin levantarlo, igual hay que soltar: si no, el
    // kart se queda acelerando solo.
    btn.addEventListener('lostpointercapture', () => {
      btn.classList.remove('pressed');
      def.onUp(this.state);
    });
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    this.root.classList.toggle('hidden', !visible);
    if (!visible) this.reset();
  }

  get shown(): boolean {
    return this.visible;
  }

  reset(): void {
    this.state.throttle = 0;
    this.state.brake = 0;
    this.state.steer = 0;
    this.state.drift = false;
    this.state.use = false;
    for (const btn of this.buttons.values()) btn.classList.remove('pressed');
  }

  dispose(): void {
    this.root.remove();
  }
}
