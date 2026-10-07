import {
  DEFAULT_LAYOUT,
  KEYBOARD_LAYOUTS,
  type ControlAction,
  type LayoutId,
} from './Controls';
import type { TouchInputState } from '../ui/TouchControls';

/** Estado de control normalizado que consume la física, sea cual sea el dispositivo. */
export interface InputState {
  /** 0..1 */
  throttle: number;
  /** 0..1 */
  brake: number;
  /** -1 (izquierda) .. 1 (derecha) */
  steer: number;
  /** Botón de salto/derrape mantenido. */
  drift: boolean;
  /** true sólo en el frame en que se apretó. */
  driftPressed: boolean;
  /** Pedido de volver a la pista. */
  reset: boolean;
  /** true sólo en el frame en que se pidió usar el poder. */
  usePressed: boolean;
}

const ACTIONS = {
  up: false,
  down: false,
  left: false,
  right: false,
  drift: false,
  use: false,
  reset: false,
};

/**
 * Teclado + gamepad unificados.
 *
 * `override` permite inyectar controles desde afuera (tests automatizados y,
 * más adelante, los inputs remotos de los otros jugadores en el modo online).
 */
export class Input {
  private keys = { ...ACTIONS };
  private prevDrift = false;
  private prevUse = false;
  private override: Partial<InputState> | null = null;
  private layout: LayoutId = DEFAULT_LAYOUT;
  private keyMap: Record<string, ControlAction> = KEYBOARD_LAYOUTS[DEFAULT_LAYOUT].keys;
  /** Mandos en pantalla; se suman a lo que venga del teclado. */
  private touch: TouchInputState | null = null;

  readonly state: InputState = {
    throttle: 0,
    brake: 0,
    steer: 0,
    drift: false,
    driftPressed: false,
    reset: false,
    usePressed: false,
  };

  private onKeyDown = (e: KeyboardEvent) => {
    const action = this.keyMap[e.code];
    if (action) {
      this.keys[action] = true;
      // Las flechas y el espacio scrollean la página si no los frenamos.
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const action = this.keyMap[e.code];
    if (action) this.keys[action] = false;
  };

  private onBlur = () => {
    this.keys = { ...ACTIONS };
  };

  attach(target: Window = window): void {
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.onBlur);
  }

  detach(target: Window = window): void {
    target.removeEventListener('keydown', this.onKeyDown);
    target.removeEventListener('keyup', this.onKeyUp);
    target.removeEventListener('blur', this.onBlur);
  }

  /** Fuerza valores de control; `null` devuelve el mando al jugador. */
  setOverride(state: Partial<InputState> | null): void {
    this.override = state;
  }

  /** Cambia el esquema de teclado en caliente, incluso en plena carrera. */
  setLayout(id: LayoutId): void {
    this.layout = KEYBOARD_LAYOUTS[id] ? id : DEFAULT_LAYOUT;
    this.keyMap = KEYBOARD_LAYOUTS[this.layout].keys;
    // Las teclas que estaban apretadas con el esquema anterior nunca van a
    // recibir su keyup, así que se sueltan todas al cambiar.
    this.keys = { ...ACTIONS };
  }

  get layoutId(): LayoutId {
    return this.layout;
  }

  /** Conecta los botones en pantalla. `null` los desconecta. */
  setTouchSource(state: TouchInputState | null): void {
    this.touch = state;
  }

  /** Recalcula el estado. Llamar una vez por frame, antes de la física. */
  update(): InputState {
    const s = this.state;
    s.throttle = this.keys.up ? 1 : 0;
    s.brake = this.keys.down ? 1 : 0;
    s.steer = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
    s.drift = this.keys.drift;
    s.reset = this.keys.reset;
    let use = this.keys.use;

    this.applyGamepad(s);

    // Los botones en pantalla se suman al teclado: en una tablet con teclado
    // conectado se puede usar cualquiera de los dos sin que uno pise al otro.
    if (this.touch) {
      if (this.touch.throttle > 0) s.throttle = this.touch.throttle;
      if (this.touch.brake > 0) s.brake = this.touch.brake;
      if (this.touch.steer !== 0) s.steer = this.touch.steer;
      if (this.touch.drift) s.drift = true;
      if (this.touch.use) use = true;
    }

    if (this.override) {
      Object.assign(s, this.override);
      if (this.override.usePressed !== undefined) use = this.override.usePressed;
    }

    s.driftPressed = s.drift && !this.prevDrift;
    this.prevDrift = s.drift;
    s.usePressed = use && !this.prevUse;
    this.prevUse = use;
    return s;
  }

  private applyGamepad(s: InputState): void {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    for (const pad of pads) {
      if (!pad) continue;
      const axis = pad.axes[0] ?? 0;
      if (Math.abs(axis) > 0.15) s.steer = Math.max(-1, Math.min(1, axis));
      // Gatillos analógicos; con fallback a los botones A / B.
      const rt = pad.buttons[7]?.value ?? 0;
      const lt = pad.buttons[6]?.value ?? 0;
      if (rt > 0.05) s.throttle = rt;
      if (lt > 0.05) s.brake = lt;
      if (pad.buttons[0]?.pressed) s.throttle = 1;
      if (pad.buttons[1]?.pressed) s.brake = 1;
      if (pad.buttons[5]?.pressed || pad.buttons[4]?.pressed) s.drift = true;
      if (pad.buttons[2]?.pressed || pad.buttons[3]?.pressed) this.keys.use = true;
      if (pad.buttons[9]?.pressed) s.reset = true;
      break;
    }
  }
}
