import * as THREE from 'three';
import type { InputState } from '../core/Input';
import type { TrackPath, TrackProjection } from '../track/TrackPath';
import { BARRIER_OFFSET } from '../track/TrackSpec';

/**
 * Parámetros de manejo. Están todos juntos y en unidades reales (m, s, rad)
 * para poder afinar el "feeling" sin tocar la lógica.
 */
export const TUNING = {
  maxSpeed: 42, // m/s ≈ 151 km/h
  engineAccel: 34, // m/s² a velocidad cero, decae al acercarse al tope
  brakeDecel: 48,
  reverseAccel: 16,
  reverseMaxSpeed: 12,
  coastDecel: 6,
  /**
   * Rozamiento al levantar el pie. Sólo se aplica sin acelerador: si actuara
   * siempre, la velocidad de equilibrio quedaría muy por debajo de `maxSpeed` y
   * el número de arriba dejaría de significar nada.
   */
  drag: 0.35,

  /** Velocidad de giro base, en rad/s. */
  turnRate: 2.1,
  /** El volante responde progresivamente en vez de saltar de 0 a 1. */
  steerResponse: 6.5,
  /** Giro mínimo utilizable: por debajo de esta velocidad casi no dobla. */
  steerRampSpeed: 4.5,
  /**
   * Cuánto se reduce el giro a velocidad máxima (1 = sin reducción).
   *
   * A fondo, girar a 2 rad/s da un radio de 20 m: el kart cambia de dirección
   * como si patinara y es imposible de conducir en recta. Con 0,45 el radio a
   * tope queda en unos 45 m: calmo en recta y todavía capaz de tomar las curvas
   * levantando el pie.
   */
  highSpeedTurnFactor: 0.45,
  /**
   * Exponente de la caída del giro con la velocidad. Por encima de 1 el kart
   * conserva maniobrabilidad en el rango medio y sólo se aquieta cerca del
   * tope, que es donde molesta el nerviosismo.
   */
  highSpeedTurnExponent: 1.4,
  /**
   * Alineación del morro con la dirección real de marcha, en 1/s.
   *
   * Es lo que hace que el kart "ande derecho" solo al soltar el volante en vez
   * de quedar cruzado. Se aplica sólo cuando no se está doblando ni derrapando,
   * así que nunca pelea contra el jugador.
   */
  headingAlign: 3.2,

  /** Agarre lateral: fracción de deslizamiento eliminada por segundo. */
  gripNormal: 12,
  gripDrift: 2.5,
  gripAir: 0.6,
  /**
   * Agarre fuera de pista. Antes era 0,55: el kart patinaba en el pasto y
   * volver a la pista era casi imposible.
   */
  gripOffTrackFactor: 0.82,
  /**
   * Parte del deslizamiento lateral que el agarre convierte en avance en vez
   * de disipar, mientras se derrapa. Sin esto cada derrape mata la velocidad y
   * deja de convenir; con esto derrapar es rápido, que es el punto.
   */
  driftSlideRecovery: 0.42,

  /** Derrape. */
  driftMinSpeed: 11,
  driftBaseTurn: 1.15,
  driftSteerTurn: 0.95,
  hopVelocity: 3.4,
  /**
   * Cuánto tiempo puede estar el kart en el aire sin perder el derrape.
   *
   * Un badén, el rebote contra la barrera o el borde de la banquina levantan
   * las ruedas una o dos centésimas. Sin esta tolerancia, cualquiera de esos
   * baches cortaba el derrape y reiniciaba la carga del mini turbo justo antes
   * de completarse, que es exactamente lo que hace que derrapar no rinda.
   */
  driftAirGrace: 0.3,
  /** Umbral de carga (s) y duración del turbo (s) de cada nivel. */
  driftTiers: [
    { charge: 0.95, boost: 1.05, color: 0x4aa8ff },
    { charge: 2.0, boost: 1.75, color: 0xff9c20 },
    { charge: 3.3, boost: 2.7, color: 0xc06bff },
  ],
  boostAccel: 40,
  boostMaxSpeedFactor: 1.38,

  /**
   * Fuera de pista.
   *
   * Salirse tiene que costar, pero no sacarte de la carrera: con el 52 % de
   * velocidad y 14 m/s² de frenado, un error chico significaba quedarse a pie y
   * ver cómo se iban todos. Ahora se sigue perdiendo terreno, pero se puede
   * maniobrar y volver.
   */
  offTrackMaxSpeedFactor: 0.7,
  offTrackDecel: 7,

  /** Barrera exterior: más allá de esto no se puede seguir. */
  barrierOffset: BARRIER_OFFSET,
  barrierBounce: 0.35,

  gravity: 30,
  /**
   * Altura del origen del kart sobre la superficie.
   *
   * En el modelo las ruedas apoyan exactamente en el origen del grupo, así que
   * esto tiene que ser casi cero: con 0,46 el kart viajaba flotando medio metro
   * por encima del asfalto. Quedan 3 cm para que los neumáticos no peleen en Z
   * con la pista.
   */
  rideHeight: 0.03,
  /** Si el kart está a menos de esta altura del piso, se pega en vez de flotar. */
  snapDistance: 0.4,

  /** Efectos de los poderes. */
  spinDuration: 1.5,
  spinRate: 11,
  starDuration: 6,
  padBoostDuration: 1.6,
} as const;

/**
 * Comando de volante que lleva el morro desde `currentYaw` hacia `targetYaw`.
 * Positivo = derecha, igual que la flecha del teclado.
 *
 * Existe como función porque el signo no es obvio y equivocarlo es justo el
 * error que deja el juego con la dirección invertida: en la convención de
 * three.js el yaw crece girando hacia la IZQUIERDA, así que el error de rumbo
 * va con signo cambiado respecto del volante.
 */
export function steerToward(currentYaw: number, targetYaw: number): number {
  let delta = (targetYaw - currentYaw) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return -delta;
}

/** Rumbo (yaw) que corresponde a una dirección horizontal. */
export function yawOf(direction: THREE.Vector3): number {
  return Math.atan2(direction.x, direction.z);
}

export interface DriftState {
  active: boolean;
  /** -1 izquierda, 1 derecha, 0 sin derrape. */
  direction: number;
  charge: number;
  /** Nivel alcanzado: 0 = ninguno, 1..3 = mini turbo. */
  tier: number;
}

/** Instantánea de solo lectura del kart, para HUD, cámara, red y depuración. */
export interface KartTelemetry {
  speed: number;
  speedKmh: number;
  forwardSpeed: number;
  lateralSpeed: number;
  grounded: boolean;
  offTrack: boolean;
  boostTime: boolean;
  spinning: boolean;
  immune: boolean;
  wrongWay: boolean;
  drift: DriftState;
  projection: TrackProjection;
}

/**
 * Física arcade de kart.
 *
 * El modelo trabaja en el plano horizontal (rumbo + velocidad descompuesta en
 * avance y deslizamiento lateral) con la altura resuelta aparte contra la
 * superficie del asfalto. Es el enfoque clásico de los kart racers: da control
 * predecible y derrapes legibles, sin el costo ni la inestabilidad de simular
 * suspensión y neumáticos rueda por rueda.
 */
export class KartPhysics {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  grounded = true;

  readonly drift: DriftState = { active: false, direction: 0, charge: 0, tier: 0 };
  boostTime = 0;
  /** Segundos que le quedan de trompo tras recibir un golpe. */
  spinTime = 0;
  /** Segundos de invulnerabilidad: ningún poder lo afecta. */
  immuneTime = 0;
  wrongWay = false;

  /** Ángulo extra del chasis durante el derrape, sólo visual. */
  visualDriftYaw = 0;
  /** Inclinación lateral del chasis en las curvas, sólo visual. */
  visualRoll = 0;

  private steerSmoothed = 0;
  private driftAirTime = 0;
  private hopping = false;
  private trackHint = 0;
  private lastProjection: TrackProjection;

  private readonly path: TrackPath;

  constructor(path: TrackPath, startSlot = 0) {
    this.path = path;
    const start = path.startTransform(startSlot);
    this.position.copy(start.position);
    this.yaw = start.yaw;
    this.lastProjection = path.project(this.position);
    this.trackHint = this.lastProjection.index;
    this.position.y = this.lastProjection.surfaceY + TUNING.rideHeight;
  }

  get forward(): THREE.Vector3 {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  /**
   * Costado derecho del kart.
   *
   * En un mundo con Y hacia arriba y orientación derecha, la derecha de algo
   * que mira en dirección F es F × arriba. Con `arriba × F` se obtiene el
   * costado izquierdo, y entonces doblar con las flechas sale invertido en
   * pantalla aunque toda la matemática interna parezca coherente.
   */
  get right(): THREE.Vector3 {
    return new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
  }

  get projection(): TrackProjection {
    return this.lastProjection;
  }

  /** Devuelve el kart al centro de la pista, mirando hacia adelante. */
  respawn(): void {
    const proj = this.path.project(this.position, this.trackHint);
    const sample = this.path.sampleAt(proj.index);
    this.position.copy(sample.position).addScaledVector(sample.up, TUNING.rideHeight);
    this.yaw = Math.atan2(sample.tangent.x, sample.tangent.z);
    this.velocity.set(0, 0, 0);
    this.boostTime = 0;
    this.endDrift(false);
    this.lastProjection = this.path.project(this.position, proj.index);
    this.trackHint = this.lastProjection.index;
  }

  // ---------- Efectos de los poderes ----------

  /** Turbo: acelera por unos segundos. */
  applyBoost(seconds: number): void {
    this.boostTime = Math.max(this.boostTime, seconds);
  }

  /** Rayo: velocidad e inmunidad a todo lo demás. */
  applyStar(seconds = TUNING.starDuration): void {
    this.immuneTime = Math.max(this.immuneTime, seconds);
    this.boostTime = Math.max(this.boostTime, seconds);
  }

  /**
   * Golpe de un poder. Devuelve false si estaba inmune, para que quien
   * dispara sepa que no hizo efecto.
   */
  applyHit(): boolean {
    if (this.immuneTime > 0) return false;
    this.spinTime = TUNING.spinDuration;
    this.endDrift(false);
    return true;
  }

  get spinning(): boolean {
    return this.spinTime > 0;
  }

  update(dt: number, input: InputState): KartTelemetry {
    const proj = this.path.project(this.position, this.trackHint);
    this.trackHint = proj.index;
    this.lastProjection = proj;

    if (input.reset) this.respawn();

    this.immuneTime = Math.max(0, this.immuneTime - dt);

    // En trompo el jugador pierde el control: el kart gira sobre sí mismo y se
    // frena solo. Reemplazamos el input en vez de saltear la física para que
    // siga cayendo, chocando la barrera y detectándose fuera de pista.
    let effective = input;
    if (this.spinTime > 0) {
      this.spinTime = Math.max(0, this.spinTime - dt);
      this.yaw += TUNING.spinRate * dt;
      effective = {
        throttle: 0,
        brake: 0,
        steer: 0,
        drift: false,
        driftPressed: false,
        reset: false,
        usePressed: false,
      };
    }
    input = effective;

    const f = this.forward;
    const r = this.right;
    let forwardSpeed = this.velocity.dot(f);
    let lateralSpeed = this.velocity.dot(r);

    // ---------- Motor ----------
    const boosting = this.boostTime > 0;
    let maxSpeed = TUNING.maxSpeed;
    if (proj.offTrack) maxSpeed *= TUNING.offTrackMaxSpeedFactor;
    if (boosting) maxSpeed *= TUNING.boostMaxSpeedFactor;

    if (input.throttle > 0) {
      // El acelerador pide una VELOCIDAD, no una fuerza. Con el modelo anterior
      // (empuje proporcional al acelerador, sin rozamiento en contra) cualquier
      // acelerador mayor que cero terminaba llevando al kart al tope: sólo
      // cambiaba cuánto tardaba. Eso volvía decorativos el levante de pie de la
      // IA en las curvas y las dificultades, que iban todas a fondo y se abrían
      // igual.
      const target = maxSpeed * (boosting ? 1 : input.throttle);
      if (forwardSpeed < target) {
        const headroom = Math.max(0, 1 - Math.max(0, forwardSpeed) / target);
        forwardSpeed += TUNING.engineAccel * headroom * dt;
      } else {
        // Por encima del objetivo el motor deja de empujar y el kart rueda.
        forwardSpeed -= Math.min(forwardSpeed - target, TUNING.coastDecel * dt);
      }
    }

    if (input.brake > 0) {
      if (forwardSpeed > 0.4) {
        forwardSpeed -= TUNING.brakeDecel * input.brake * dt;
      } else {
        const headroom = Math.max(0, 1 - Math.max(0, -forwardSpeed) / TUNING.reverseMaxSpeed);
        forwardSpeed -= TUNING.reverseAccel * input.brake * headroom * dt;
      }
    }

    if (input.throttle === 0 && input.brake === 0) {
      const decel = Math.min(Math.abs(forwardSpeed), TUNING.coastDecel * dt);
      forwardSpeed -= Math.sign(forwardSpeed) * decel;
    }

    if (proj.offTrack && forwardSpeed > 0) {
      forwardSpeed = Math.max(0, forwardSpeed - TUNING.offTrackDecel * dt);
    }

    if (boosting) {
      this.boostTime = Math.max(0, this.boostTime - dt);
      forwardSpeed += TUNING.boostAccel * dt * Math.max(0, 1 - forwardSpeed / maxSpeed);
    }

    if (input.throttle === 0) forwardSpeed *= Math.exp(-TUNING.drag * dt);

    // ---------- Derrape ----------
    this.updateDrift(dt, input, forwardSpeed, Math.hypot(this.velocity.x, this.velocity.z));

    // ---------- Dirección ----------
    this.steerSmoothed = THREE.MathUtils.damp(
      this.steerSmoothed,
      input.steer,
      TUNING.steerResponse,
      dt,
    );

    const speedRamp = THREE.MathUtils.clamp(Math.abs(forwardSpeed) / TUNING.steerRampSpeed, 0, 1);
    const speedTaper = THREE.MathUtils.lerp(
      1,
      TUNING.highSpeedTurnFactor,
      Math.pow(
        THREE.MathUtils.clamp(Math.abs(forwardSpeed) / TUNING.maxSpeed, 0, 1),
        TUNING.highSpeedTurnExponent,
      ),
    );
    const steerAuthority = speedRamp * speedTaper * (this.grounded ? 1 : 0.35);

    let turnRate: number;
    if (this.drift.active) {
      // En derrape el kart queda "enganchado" en un arco; el volante sólo lo
      // abre o lo cierra. Es lo que hace que el drift se sienta comprometido.
      const steerAlign = this.steerSmoothed * this.drift.direction;
      turnRate =
        this.drift.direction *
        (TUNING.driftBaseTurn + TUNING.driftSteerTurn * THREE.MathUtils.clamp(steerAlign, -0.7, 1)) *
        steerAuthority;
    } else {
      turnRate = this.steerSmoothed * TUNING.turnRate * steerAuthority;
    }

    if (forwardSpeed < -0.2) turnRate = -turnRate;
    // Un giro positivo (flecha derecha) tiene que llevar el morro hacia
    // `right`, y derivando `forward` respecto de yaw se ve que eso ocurre al
    // DISMINUIR el ángulo, no al aumentarlo.
    this.yaw -= turnRate * dt;

    // Estabilidad: con el volante suelto, el morro se va alineando con la
    // dirección real de marcha. Sin esto el kart queda cruzado después de cada
    // corrección y hay que estar peleándolo todo el tiempo.
    const travelSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (!this.drift.active && this.grounded && travelSpeed > 3 && forwardSpeed > 0) {
      const travelYaw = yawOf(this.velocity);
      const align =
        TUNING.headingAlign * (1 - Math.min(1, Math.abs(this.steerSmoothed))) * dt;
      this.yaw -= steerToward(this.yaw, travelYaw) * Math.min(1, align);
    }

    // ---------- Agarre lateral ----------
    // Al rotar el rumbo, la velocidad conservada se convierte sola en
    // deslizamiento lateral; el agarre decide qué tan rápido se disipa.
    let grip = this.grounded
      ? this.drift.active
        ? TUNING.gripDrift
        : TUNING.gripNormal
      : TUNING.gripAir;
    if (proj.offTrack) grip *= TUNING.gripOffTrackFactor;

    const lateralBefore = lateralSpeed;
    lateralSpeed *= Math.exp(-grip * dt);
    if (this.drift.active && forwardSpeed > 0) {
      const scrubbed = Math.abs(lateralBefore) - Math.abs(lateralSpeed);
      forwardSpeed += scrubbed * TUNING.driftSlideRecovery;
    }

    forwardSpeed = THREE.MathUtils.clamp(forwardSpeed, -TUNING.reverseMaxSpeed, maxSpeed);

    // ---------- Vertical ----------
    let verticalSpeed = this.velocity.y - TUNING.gravity * dt;
    const surfaceY = proj.surfaceY + TUNING.rideHeight;
    let nextY = this.position.y + verticalSpeed * dt;

    if (nextY <= surfaceY || (!this.hopping && nextY - surfaceY < TUNING.snapDistance && verticalSpeed <= 0)) {
      nextY = surfaceY;
      verticalSpeed = 0;
      if (!this.grounded) this.hopping = false;
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    if (input.driftPressed && this.grounded) {
      verticalSpeed = TUNING.hopVelocity;
      this.grounded = false;
      this.hopping = true;
      nextY = surfaceY + 0.01;
    }

    // ---------- Integración ----------
    this.velocity.copy(f).multiplyScalar(forwardSpeed).addScaledVector(r, lateralSpeed);
    this.velocity.y = verticalSpeed;

    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    this.position.y = nextY;

    this.applyBarrier(proj);
    this.updateVisuals(dt, forwardSpeed, proj);

    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    const alignment = f.dot(proj.tangent);
    this.wrongWay = speed > 4 && alignment < -0.25;

    return this.snapshot();
  }

  /**
   * Instantánea del estado actual, sin avanzar la simulación.
   *
   * La usan el HUD y los tests antes del primer paso, cuando todavía no hubo
   * ningún `update()` del que leer.
   */
  snapshot(): KartTelemetry {
    const proj = this.lastProjection;
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    return {
      speed,
      speedKmh: speed * 3.6,
      forwardSpeed: this.velocity.dot(this.forward),
      lateralSpeed: this.velocity.dot(this.right),
      grounded: this.grounded,
      offTrack: proj.offTrack,
      boostTime: this.boostTime > 0,
      spinning: this.spinTime > 0,
      immune: this.immuneTime > 0,
      wrongWay: this.wrongWay,
      drift: this.drift,
      projection: proj,
    };
  }

  private updateDrift(
    dt: number,
    input: InputState,
    forwardSpeed: number,
    groundSpeed: number,
  ): void {
    const d = this.drift;

    if (d.active) {
      // Para sostener el derrape miramos la velocidad real sobre el piso, no
      // la proyección sobre el morro: en pleno derrape el kart va muy cruzado
      // y el avance proyectado cae aunque siga volando.
      this.driftAirTime = this.grounded ? 0 : this.driftAirTime + dt;
      const stillValid =
        input.drift &&
        this.driftAirTime < TUNING.driftAirGrace &&
        groundSpeed > TUNING.driftMinSpeed * 0.55;
      if (!stillValid) {
        this.endDrift(true);
        return;
      }
      // Cargar más rápido si se mantiene el volante hacia el lado del derrape.
      const alignment = 0.6 + 0.4 * THREE.MathUtils.clamp(this.steerSmoothed * d.direction, 0, 1);
      d.charge += dt * alignment;
      d.tier = this.tierFor(d.charge);
      return;
    }

    // Arranque: sólo al aterrizar el saltito, con volante cargado y velocidad.
    const canStart =
      input.drift &&
      this.grounded &&
      !this.hopping &&
      forwardSpeed > TUNING.driftMinSpeed &&
      Math.abs(this.steerSmoothed) > 0.25;

    if (canStart) {
      d.active = true;
      d.direction = Math.sign(this.steerSmoothed);
      d.charge = 0;
      d.tier = 0;
      this.driftAirTime = 0;
    }
  }

  private tierFor(charge: number): number {
    let tier = 0;
    for (let i = 0; i < TUNING.driftTiers.length; i++) {
      if (charge >= TUNING.driftTiers[i].charge) tier = i + 1;
    }
    return tier;
  }

  private endDrift(award: boolean): void {
    const d = this.drift;
    if (award && d.tier > 0) {
      this.boostTime = Math.max(this.boostTime, TUNING.driftTiers[d.tier - 1].boost);
    }
    d.active = false;
    d.direction = 0;
    d.charge = 0;
    d.tier = 0;
  }

  /** Empuja el kart de vuelta si se pasa del borde exterior del escenario. */
  private applyBarrier(proj: TrackProjection): void {
    const limit = proj.halfWidth + TUNING.barrierOffset;
    const over = Math.abs(proj.lateral) - limit;
    if (over <= 0) return;

    const sign = Math.sign(proj.lateral);
    this.position.addScaledVector(proj.right, -sign * over);

    // Rebote: se conserva el avance y se invierte (amortiguado) el componente
    // que iba hacia afuera.
    const outward = this.velocity.dot(proj.right);
    if (outward * sign > 0) {
      this.velocity.addScaledVector(proj.right, -outward * (1 + TUNING.barrierBounce));
    }
  }

  private updateVisuals(dt: number, forwardSpeed: number, proj: TrackProjection): void {
    const targetDriftYaw = this.drift.active
      ? -this.drift.direction * 0.34 * THREE.MathUtils.clamp(forwardSpeed / TUNING.maxSpeed, 0, 1)
      : 0;
    this.visualDriftYaw = THREE.MathUtils.damp(this.visualDriftYaw, targetDriftYaw, 6, dt);

    // Balanceo hacia afuera de la curva, como un chasis real. En una curva a la
    // derecha el kart desliza hacia su izquierda (lateralG negativo) y el
    // cuerpo tiene que inclinarse a la izquierda.
    const lateralG = this.velocity.dot(this.right) / 12;
    const targetRoll = THREE.MathUtils.clamp(lateralG, -0.5, 0.5) * 0.35;
    this.visualRoll = THREE.MathUtils.damp(this.visualRoll, targetRoll, 7, dt);

    void proj;
  }
}
