import * as THREE from 'three';
import type { KartPhysics } from '../kart/KartPhysics';
import { TUNING } from '../kart/KartPhysics';

const CONFIG = {
  distance: 8.2,
  height: 3.4,
  /** A dónde mira: por delante del kart, para ver la curva que viene. */
  lookAhead: 9,
  lookHeight: 1.5,
  /** Suavizado de posición y de objetivo (mayor = más pegada). */
  positionDamping: 5.5,
  targetDamping: 9,
  fovBase: 62,
  fovMax: 82,
  /** Retroceso extra y FOV extra durante el turbo. */
  boostPullback: 1.6,
  /** Desplazamiento lateral hacia afuera del derrape, da sensación de velocidad. */
  driftOffset: 1.5,
};

/**
 * Cámara persecutoria.
 *
 * Sigue la posición del kart pero no su orientación instantánea: el rumbo se
 * suaviza aparte, de modo que en un derrape la cámara queda levemente atrasada
 * y se ve el costado del kart, que es lo que hace legible el drift.
 */
export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;

  private readonly position = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private smoothedYaw = 0;
  private smoothedUp = new THREE.Vector3(0, 1, 0);
  private initialized = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(CONFIG.fovBase, aspect, 0.3, 2500);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Reubica la cámara de golpe (largada, respawn) sin interpolar. */
  snapTo(physics: KartPhysics): void {
    this.smoothedYaw = physics.yaw;
    this.smoothedUp.copy(physics.projection.up);
    this.initialized = false;
    this.update(1 / 60, physics);
  }

  update(dt: number, physics: KartPhysics): void {
    // El rumbo se suaviza en el círculo, no linealmente, para no saltar en ±π.
    const yawDelta = shortestAngle(this.smoothedYaw, physics.yaw);
    this.smoothedYaw += yawDelta * (1 - Math.exp(-6 * dt));

    this.smoothedUp.lerp(physics.projection.up, 1 - Math.exp(-4 * dt)).normalize();

    const forward = new THREE.Vector3(Math.sin(this.smoothedYaw), 0, Math.cos(this.smoothedYaw));
    forward.projectOnPlane(this.smoothedUp).normalize();
    // Derecha real: adelante × arriba.
    const right = new THREE.Vector3().crossVectors(forward, this.smoothedUp).normalize();

    const boosting = physics.boostTime > 0;
    const distance = CONFIG.distance + (boosting ? CONFIG.boostPullback : 0);
    const driftShift = physics.drift.active ? -physics.drift.direction * CONFIG.driftOffset : 0;

    const desiredPosition = physics.position
      .clone()
      .addScaledVector(forward, -distance)
      .addScaledVector(this.smoothedUp, CONFIG.height)
      .addScaledVector(right, driftShift);

    const desiredTarget = physics.position
      .clone()
      .addScaledVector(forward, CONFIG.lookAhead)
      .addScaledVector(this.smoothedUp, CONFIG.lookHeight);

    if (!this.initialized) {
      this.position.copy(desiredPosition);
      this.target.copy(desiredTarget);
      this.initialized = true;
    } else {
      damp3(this.position, desiredPosition, CONFIG.positionDamping, dt);
      damp3(this.target, desiredTarget, CONFIG.targetDamping, dt);
    }

    this.camera.position.copy(this.position);
    this.camera.up.copy(this.smoothedUp);
    this.camera.lookAt(this.target);

    // El FOV se abre con la velocidad: es el truco más barato y más efectivo
    // para que 40 m/s se sientan como 40 m/s.
    const speed = Math.hypot(physics.velocity.x, physics.velocity.z);
    const speedRatio = THREE.MathUtils.clamp(speed / TUNING.maxSpeed, 0, 1.3);
    const targetFov = CONFIG.fovBase + (CONFIG.fovMax - CONFIG.fovBase) * speedRatio;
    this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 4, dt);
    this.camera.updateProjectionMatrix();
  }
}

function shortestAngle(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function damp3(current: THREE.Vector3, target: THREE.Vector3, lambda: number, dt: number): void {
  const factor = 1 - Math.exp(-lambda * dt);
  current.lerp(target, factor);
}
