import type { InputState } from '../core/Input';
import type { AiDriver } from '../race/AiDriver';
import type { Racer } from '../race/Racer';

/**
 * De dónde saca cada kart lo que hace en este tick.
 *
 * Es la pieza que separa "quién es este corredor" de "quién lo maneja", y es lo
 * primero que hace falta para el modo online. Antes el bucle preguntaba
 * `racer.isPlayer` y elegía entre el teclado y la IA; con eso, un tercer origen
 * —un jugador del otro lado de internet— no tenía dónde entrar sin meter
 * condicionales de red en el medio de la física.
 *
 * Ahora el bucle no sabe ni le importa: le pide la entrada a un controlador y
 * sigue. El teclado, la IA y la red son tres implementaciones de lo mismo, y la
 * física es una sola para todos, que además es lo que impide que alguien haga
 * trampa corriendo una física distinta de su lado.
 */
export interface Controller {
  /** Qué está haciendo este kart en este paso de simulación. */
  poll(dt: number, racer: Racer, tick: number): InputState;
  /** Se llama al cerrar la carrera. */
  dispose?(): void;
}

export const NEUTRAL_INPUT: InputState = {
  throttle: 0,
  brake: 0,
  steer: 0,
  drift: false,
  driftPressed: false,
  reset: false,
  usePressed: false,
};

export function cloneInput(source: InputState): InputState {
  return {
    throttle: source.throttle,
    brake: source.brake,
    steer: source.steer,
    drift: source.drift,
    driftPressed: source.driftPressed,
    reset: source.reset,
    usePressed: source.usePressed,
  };
}

/** El jugador de esta máquina: teclado, mandos táctiles o gamepad. */
export class LocalController implements Controller {
  constructor(private readonly read: () => InputState) {}

  poll(): InputState {
    return this.read();
  }
}

/**
 * Un rival manejado por la máquina.
 *
 * El uso de poderes entra acá adentro, en `usePressed`, y no como un caso aparte
 * del bucle. Antes el jugador usaba su poder por `input.usePressed` y la IA por
 * una llamada suelta a `shouldUseItem`: dos caminos para la misma acción, y el
 * de la red hubiera sido un tercero. Metiéndolo en la entrada, los tres quedan
 * iguales y el bucle tiene un solo lugar donde se usa un poder.
 */
export class AiController implements Controller {
  private readonly state: InputState = { ...NEUTRAL_INPUT };

  constructor(private readonly driver: AiDriver) {}

  poll(dt: number, racer: Racer): InputState {
    Object.assign(this.state, this.driver.update(dt, racer));
    this.state.usePressed = this.driver.shouldUseItem(racer, dt);
    return this.state;
  }
}

/**
 * Un jugador que está en otra máquina.
 *
 * Guarda la última entrada que llegó y la repite mientras no llegue otra. Eso no
 * es un parche: los paquetes llegan cada 50 ms y la simulación corre a 120 Hz,
 * así que entre uno y otro hay seis pasos que igual hay que dar. Repetir la
 * última entrada es la suposición correcta —el que venía acelerando y doblando
 * sigue acelerando y doblando— y es lo que hace que el kart se mueva parejo en
 * lugar de avanzar a tirones cada vez que llega un paquete.
 *
 * `driftPressed` y `usePressed` son la excepción: valen para un solo tick. Si se
 * repitieran, un toque del botón de poder se convertiría en seis usos.
 */
export class RemoteController implements Controller {
  private readonly state: InputState = { ...NEUTRAL_INPUT };
  private silence = 0;

  /** Cuántos segundos hace que no llega nada de este jugador. */
  get stale(): number {
    return this.silence;
  }

  receive(input: InputState): void {
    Object.assign(this.state, input);
    this.silence = 0;
  }

  poll(dt: number): InputState {
    this.silence += dt;

    // Si se cortó la conexión, el kart suelta el acelerador en vez de seguir a
    // fondo contra el primer muro. Frenar de golpe se vería peor: así el que
    // mira ve a alguien que se quedó sin señal, no a alguien que se estrelló.
    if (this.silence > 1.5) {
      this.state.throttle *= 0.985;
      this.state.steer *= 0.985;
      this.state.drift = false;
    }

    const out = cloneInput(this.state);
    this.state.driftPressed = false;
    this.state.usePressed = false;
    this.state.reset = false;
    return out;
  }
}
