import * as THREE from 'three';
import { buildControlPoints, halfWidthAt, shoulderLift, type TrackSpec } from './TrackSpec';

/** Una muestra precalculada de la línea central del circuito. */
export interface TrackSample {
  position: THREE.Vector3;
  /** Dirección de avance, unitaria. */
  tangent: THREE.Vector3;
  /** Lateral derecho, ya peraltado. */
  right: THREE.Vector3;
  /** Normal de la superficie, ya peraltada. */
  up: THREE.Vector3;
  halfWidth: number;
  /** Distancia acumulada desde la largada, en metros. */
  distance: number;
  /** Curvatura con signo (1/m). Positiva = el trazado dobla a la derecha. */
  curvature: number;
}

/** Resultado de proyectar un punto del mundo sobre el trazado. */
export interface TrackProjection {
  /** Índice de la muestra más cercana (sirve como pista para la siguiente consulta). */
  index: number;
  /** Distancia recorrida sobre el trazado, en metros. */
  distance: number;
  /** Progreso normalizado 0..1 a lo largo de la vuelta. */
  t: number;
  /** Desplazamiento lateral con signo respecto del centro (+ = derecha). */
  lateral: number;
  /** Altura de la superficie del asfalto bajo ese punto. */
  surfaceY: number;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  halfWidth: number;
  curvature: number;
  /** true si el punto quedó fuera del asfalto. */
  offTrack: boolean;
}

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const CELL_SIZE = 24;

/**
 * Línea central del circuito, muestreada y con consultas espaciales.
 *
 * Todo el juego (colisiones con el borde, altura del piso, checkpoints, IA y
 * respawn) consulta la pista a través de `project()`, así que acá está la única
 * fuente de verdad sobre dónde está el asfalto.
 */
export class TrackPath {
  readonly spec: TrackSpec;
  readonly curve: THREE.CatmullRomCurve3;
  readonly samples: TrackSample[] = [];
  readonly totalLength: number;

  private readonly grid = new Map<number, number[]>();

  constructor(spec: TrackSpec, sampleCount = 1200) {
    this.spec = spec;
    this.curve = new THREE.CatmullRomCurve3(buildControlPoints(spec), true, 'catmullrom', 0.5);

    // 1ª pasada: posiciones y tangentes.
    const positions: THREE.Vector3[] = [];
    const tangents: THREE.Vector3[] = [];
    for (let i = 0; i < sampleCount; i++) {
      const t = i / sampleCount;
      positions.push(this.curve.getPoint(t));
      tangents.push(this.curve.getTangent(t).normalize());
    }

    // 2ª pasada: curvatura, peralte, ancho y distancia acumulada.
    let distance = 0;
    for (let i = 0; i < sampleCount; i++) {
      const prev = tangents[(i - 1 + sampleCount) % sampleCount];
      const next = tangents[(i + 1) % sampleCount];
      const position = positions[i];
      const tangent = tangents[i];

      const segLen = position.distanceTo(positions[(i - 1 + sampleCount) % sampleCount]);
      if (i > 0) distance += segLen;

      // Convención de ejes: en un mundo con Y hacia arriba y orientación
      // derecha, el costado derecho de algo que mira en dirección `tangent` es
      // `tangent × arriba`. Usar `arriba × tangent` da el costado IZQUIERDO, y
      // con ese error todo el juego queda espejado: doblar con las flechas sale
      // al revés en pantalla.
      const flatRight = new THREE.Vector3().crossVectors(tangent, WORLD_UP).normalize();

      // Curvatura con signo: positiva cuando el trazado dobla hacia la derecha,
      // que es lo que se lee al proyectar la tangente siguiente sobre el
      // costado derecho de la actual.
      const cross = new THREE.Vector3().crossVectors(prev, next);
      const bend = next.dot(flatRight);
      const turnAngle =
        Math.atan2(cross.length(), prev.dot(next)) * (bend < 0 ? -1 : 1);
      const arc = Math.max(segLen * 2, 1e-4);
      const curvature = turnAngle / arc;

      // Peralte: el lado interno de la curva baja, saturando en curvas muy
      // cerradas para que no se vuelva una pared. En una curva a la derecha el
      // interior es el lado derecho, así que `right` tiene que bajar.
      const bankAngle = Math.tanh(curvature * 55) * spec.banking;
      const right = flatRight.clone().applyAxisAngle(tangent, bankAngle);
      const up = new THREE.Vector3().crossVectors(right, tangent).normalize();

      this.samples.push({
        position,
        tangent,
        right,
        up,
        halfWidth: halfWidthAt(spec, i / sampleCount),
        distance,
        curvature,
      });
    }

    // Cierre del lazo: la distancia total incluye el tramo del último al primero.
    this.totalLength = distance + positions[sampleCount - 1].distanceTo(positions[0]);

    this.buildGrid();
  }

  private cellKey(x: number, z: number): number {
    // Empaquetamos dos enteros con signo en una sola clave numérica.
    return ((x + 4096) << 13) | (z + 4096);
  }

  private buildGrid(): void {
    for (let i = 0; i < this.samples.length; i++) {
      const p = this.samples[i].position;
      const cx = Math.floor(p.x / CELL_SIZE);
      const cz = Math.floor(p.z / CELL_SIZE);
      // Registramos la muestra en su celda y en las vecinas, para que una
      // consulta desde el pasto cercano siempre encuentre candidatos.
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const key = this.cellKey(cx + dx, cz + dz);
          let list = this.grid.get(key);
          if (!list) this.grid.set(key, (list = []));
          list.push(i);
        }
      }
    }
  }

  /** Muestra en un índice, con envoltura circular. */
  sampleAt(index: number): TrackSample {
    const n = this.samples.length;
    return this.samples[((index % n) + n) % n];
  }

  /**
   * Muestra a una distancia recorrida dada, en metros, con envoltura de vuelta.
   *
   * No es lo mismo que `sampleAtT`: las muestras están repartidas parejo en el
   * parámetro de la curva, no en metros, y en un trazado con rectas largas y
   * horquillas las dos cosas se separan decenas de metros. Todo lo que razona en
   * distancias —el misil, los checkpoints, la IA— tiene que usar ésta.
   */
  sampleAtDistance(distance: number): TrackSample {
    const n = this.samples.length;
    let d = distance % this.totalLength;
    if (d < 0) d += this.totalLength;

    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.samples[mid].distance < d) lo = mid + 1;
      else hi = mid;
    }
    return this.samples[Math.max(0, lo === 0 ? 0 : lo - 1)];
  }

  /** Punto y orientación en el parámetro normalizado t (0..1). */
  sampleAtT(t: number): TrackSample {
    const n = this.samples.length;
    const wrapped = t - Math.floor(t);
    return this.samples[Math.min(n - 1, Math.floor(wrapped * n))];
  }

  /**
   * Proyecta un punto del mundo sobre el trazado.
   *
   * `hintIndex` acelera la consulta cuando el objeto se movió poco desde el
   * frame anterior; si no se pasa (o el objeto se teletransportó) se cae a la
   * grilla espacial, que siempre encuentra la respuesta correcta.
   */
  project(point: THREE.Vector3, hintIndex?: number): TrackProjection {
    const n = this.samples.length;
    let bestIndex = -1;
    let bestDistSq = Infinity;

    const consider = (i: number) => {
      const d = this.samples[i].position.distanceToSquared(point);
      if (d < bestDistSq) {
        bestDistSq = d;
        bestIndex = i;
      }
    };

    if (hintIndex !== undefined) {
      const window = 48;
      for (let k = -window; k <= window; k++) consider(((hintIndex + k) % n + n) % n);
    }

    // Si no hay pista previa, o el mejor candidato quedó lejos (el objeto saltó,
    // reapareció, o la ventana no alcanzó), consultamos la grilla.
    const windowTrusted = hintIndex !== undefined && bestDistSq < CELL_SIZE * CELL_SIZE;
    if (!windowTrusted) {
      const cx = Math.floor(point.x / CELL_SIZE);
      const cz = Math.floor(point.z / CELL_SIZE);
      const candidates = this.grid.get(this.cellKey(cx, cz));
      if (candidates) {
        for (const i of candidates) consider(i);
      } else if (bestIndex < 0) {
        // Muy lejos del circuito: barrido completo. Es raro (respawn, cámara
        // libre) y 1200 muestras se recorren en microsegundos.
        for (let i = 0; i < n; i++) consider(i);
      }
    }

    return this.refine(bestIndex, point);
  }

  /**
   * Refina la proyección entre las muestras vecinas para obtener una posición
   * continua en lugar de saltar de muestra en muestra.
   */
  private refine(index: number, point: THREE.Vector3): TrackProjection {
    const n = this.samples.length;
    const here = this.samples[index];
    const prev = this.sampleAt(index - 1);
    const next = this.sampleAt(index + 1);

    // Elegimos el segmento (prev→here) o (here→next) sobre el que cae el punto.
    let a = here;
    let b = next;
    let baseIndex = index;
    const toNext = new THREE.Vector3().subVectors(point, here.position).dot(here.tangent);
    if (toNext < 0) {
      a = prev;
      b = here;
      baseIndex = index - 1;
    }

    const seg = new THREE.Vector3().subVectors(b.position, a.position);
    const segLenSq = Math.max(seg.lengthSq(), 1e-6);
    const s = THREE.MathUtils.clamp(
      new THREE.Vector3().subVectors(point, a.position).dot(seg) / segLenSq,
      0,
      1,
    );

    const center = new THREE.Vector3().lerpVectors(a.position, b.position, s);
    const tangent = new THREE.Vector3().lerpVectors(a.tangent, b.tangent, s).normalize();
    const right = new THREE.Vector3().lerpVectors(a.right, b.right, s).normalize();
    const up = new THREE.Vector3().crossVectors(right, tangent).normalize();
    const halfWidth = THREE.MathUtils.lerp(a.halfWidth, b.halfWidth, s);
    const curvature = THREE.MathUtils.lerp(a.curvature, b.curvature, s);

    // Distancia acumulada, cuidando el salto del cierre del lazo.
    let distA = a.distance;
    let distB = b.distance;
    if (distB < distA) distB = this.totalLength;
    const distance = THREE.MathUtils.lerp(distA, distB, s);

    const offset = new THREE.Vector3().subVectors(point, center);
    const lateral = offset.dot(right);

    // Altura de la superficie. Sobre el asfalto es el plano peraltado; pasado
    // el borde hay que seguir la banquina, que baja hacia afuera. Sin esto el
    // kart sale de la pista y queda flotando sobre el pasto, porque la física
    // prolongaba el plano del asfalto mientras la malla ya había bajado.
    const offsetFromEdge = Math.max(0, Math.abs(lateral) - halfWidth);
    const surfaceY = center.y + lateral * right.y + shoulderLift(offsetFromEdge) * up.y;

    return {
      index: ((baseIndex + Math.round(s)) % n + n) % n,
      distance,
      t: distance / this.totalLength,
      lateral,
      surfaceY,
      tangent,
      right,
      up,
      halfWidth,
      curvature,
      offTrack: Math.abs(lateral) > halfWidth,
    };
  }

  /** Posición y orientación de largada, sobre la línea de meta. */
  startTransform(slot = 0): { position: THREE.Vector3; yaw: number } {
    const sample = this.samples[0];
    // Los slots se alternan a izquierda y derecha, escalonados hacia atrás.
    const side = slot % 2 === 0 ? -1 : 1;
    const row = Math.floor(slot / 2);
    const lateral = side * sample.halfWidth * 0.42;
    const back = this.sampleAt(-Math.round((row * 6) / (this.totalLength / this.samples.length)));

    // Apenas por encima del asfalto: elevarlo más hacía que los karts
    // arrancaran flotando y se cayeran al empezar la cuenta regresiva.
    const position = back.position
      .clone()
      .addScaledVector(back.right, lateral)
      .addScaledVector(back.up, 0.05);
    const yaw = Math.atan2(back.tangent.x, back.tangent.z);
    return { position, yaw };
  }
}
