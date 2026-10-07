import * as THREE from 'three';
import type { TrackPath } from './TrackPath';
import { buildScenery } from './scenery';
import { THEMES, type ThemePalette } from './themes';
import {
  BARRIER_OFFSET,
  SHOULDER_DROP,
  SHOULDER_INNER,
  SHOULDER_WIDTH,
  shoulderLift,
} from './TrackSpec';
import {
  makeCurbTexture,
  makeFinishTexture,
  makeGroundTexture,
  makeWaterTexture,
  makeRoadTexture,
  makeWallTexture,
} from './textures';

interface RibbonOptions {
  /** Offset lateral interno, en metros desde el centro (con signo). */
  inner: (halfWidth: number) => number;
  /** Offset lateral externo, en metros desde el centro (con signo). */
  outer: (halfWidth: number) => number;
  /** Altura sobre la superficie del asfalto, por borde. */
  liftInner?: number;
  liftOuter?: number;
  /** Repeticiones de la textura a lo largo (por metro) y a lo ancho. */
  repeatAlong: number;
  repeatAcross: number;
}

/**
 * Construye una cinta de geometría siguiendo la línea central del circuito.
 * La usamos para el asfalto, los pianos y las banquinas.
 */
function buildRibbon(path: TrackPath, opts: RibbonOptions): THREE.BufferGeometry {
  const n = path.samples.length;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= n; i++) {
    const s = path.sampleAt(i);
    const innerOff = opts.inner(s.halfWidth);
    const outerOff = opts.outer(s.halfWidth);

    const pi = s.position
      .clone()
      .addScaledVector(s.right, innerOff)
      .addScaledVector(s.up, opts.liftInner ?? 0);
    const po = s.position
      .clone()
      .addScaledVector(s.right, outerOff)
      .addScaledVector(s.up, opts.liftOuter ?? 0);

    positions.push(pi.x, pi.y, pi.z, po.x, po.y, po.z);
    normals.push(s.up.x, s.up.y, s.up.z, s.up.x, s.up.y, s.up.z);

    const v = s.distance * opts.repeatAlong;
    uvs.push(0, v, opts.repeatAcross, v);

    if (i < n) {
      // Orden antihorario visto desde arriba: con el orden invertido las caras
      // miran hacia abajo y el backface culling deja la pista invisible.
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}

/** Toda la geometría estática del circuito, agrupada en un único Object3D. */
export function buildTrackMesh(path: TrackPath): THREE.Group {
  const palette = THEMES[path.spec.theme];
  const group = new THREE.Group();
  group.name = 'track';

  // --- Asfalto ---
  const road = new THREE.Mesh(
    buildRibbon(path, {
      inner: (hw) => -hw,
      outer: (hw) => hw,
      repeatAlong: 1 / 9,
      repeatAcross: 1,
    }),
    new THREE.MeshLambertMaterial({ map: makeRoadTexture(palette) }),
  );
  road.receiveShadow = true;
  road.name = 'road';
  group.add(road);

  // --- Pianos a ambos lados ---
  const curbMat = new THREE.MeshLambertMaterial({ map: makeCurbTexture(palette) });
  const curbLeft = new THREE.Mesh(
    buildRibbon(path, {
      inner: (hw) => -hw - 1.6,
      outer: (hw) => -hw,
      liftInner: 0.16,
      liftOuter: 0.03,
      repeatAlong: 1 / 2.2,
      repeatAcross: 1,
    }),
    curbMat,
  );
  const curbRight = new THREE.Mesh(
    buildRibbon(path, {
      inner: (hw) => hw,
      outer: (hw) => hw + 1.6,
      liftInner: 0.03,
      liftOuter: 0.16,
      repeatAlong: 1 / 2.2,
      repeatAcross: 1,
    }),
    curbMat,
  );
  curbLeft.name = 'curb-left';
  curbRight.name = 'curb-right';
  group.add(curbLeft, curbRight);

  // --- Banquinas, que siguen la elevación del trazado ---
  const groundMat = new THREE.MeshLambertMaterial({ map: makeGroundTexture(palette) });
  const shoulderLeft = new THREE.Mesh(
    buildRibbon(path, {
      inner: (hw) => -hw - SHOULDER_WIDTH,
      outer: (hw) => -hw - SHOULDER_INNER,
      liftInner: -SHOULDER_DROP,
      liftOuter: 0,
      repeatAlong: 1 / 6,
      repeatAcross: 7,
    }),
    groundMat,
  );
  const shoulderRight = new THREE.Mesh(
    buildRibbon(path, {
      inner: (hw) => hw + SHOULDER_INNER,
      outer: (hw) => hw + SHOULDER_WIDTH,
      liftInner: 0,
      liftOuter: -SHOULDER_DROP,
      repeatAlong: 1 / 6,
      repeatAcross: 7,
    }),
    groundMat,
  );
  shoulderLeft.receiveShadow = true;
  shoulderRight.receiveShadow = true;
  group.add(shoulderLeft, shoulderRight);

  // --- Suelo lejano, para que el horizonte no se vea vacío ---
  let minY = Infinity;
  let maxR = 0;
  for (const s of path.samples) {
    minY = Math.min(minY, s.position.y);
    maxR = Math.max(maxR, Math.hypot(s.position.x, s.position.z));
  }
  // Con agua, la tierra se recorta a un anillo de costa y el resto es mar; sin
  // ella, el suelo llega hasta el horizonte como hasta ahora.
  const landRadius = palette.water ? maxR + palette.water.shore : maxR + 700;
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(landRadius, 64),
    new THREE.MeshLambertMaterial({ color: palette.groundFar }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = minY - 6;
  ground.name = 'ground';
  group.add(ground);

  if (palette.water) {
    const sea = new THREE.Mesh(
      new THREE.CircleGeometry(maxR + 1400, 72),
      new THREE.MeshLambertMaterial({ map: makeWaterTexture(palette.water.color) }),
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = minY - 6 - palette.water.drop;
    sea.name = 'water';
    group.add(sea);
  }

  // --- Línea de largada / meta ---
  const start = path.samples[0];
  const finish = new THREE.Mesh(
    new THREE.PlaneGeometry(start.halfWidth * 2, 4),
    new THREE.MeshLambertMaterial({ map: makeFinishTexture() }),
  );
  finish.position.copy(start.position).addScaledVector(start.up, 0.03);
  // La base tiene que ser derecha (X × Y = Z) o la malla queda espejada y sus
  // caras terminan mirando hacia abajo.
  finish.quaternion.setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(start.right.clone(), start.tangent.clone(), start.up.clone()),
  );
  finish.name = 'finish-line';
  group.add(finish);

  group.add(buildBarrierWall(path, palette));
  group.add(buildScenery(path, palette));
  return group;
}

/**
 * Muro perimetral, a la distancia exacta de la barrera de la física.
 *
 * Antes el kart rebotaba contra una pared invisible y parecía un bug. Ahora la
 * barrera se ve: vallas en el estadio, guardarraíl en el neón, cerco en los
 * otros dos.
 */
function buildBarrierWall(path: TrackPath, palette: ThemePalette): THREE.Group {
  const wall = new THREE.Group();
  wall.name = 'barrier-wall';

  const texture = makeWallTexture(palette);
  const material = new THREE.MeshLambertMaterial({ map: texture, side: THREE.DoubleSide });
  const height = 2.6;
  const n = path.samples.length;

  for (const side of [-1, 1]) {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i <= n; i++) {
      const s = path.sampleAt(i);
      const lateral = side * (s.halfWidth + BARRIER_OFFSET);
      const base = s.position.clone().addScaledVector(s.right, lateral);
      // La banquina baja hacia afuera; apoyamos el muro en su altura real y lo
      // hundimos un poco para que no se le vea el borde inferior.
      base.addScaledVector(s.up, shoulderLift(BARRIER_OFFSET) - 0.3);
      const top = base.clone().addScaledVector(s.up, height);

      positions.push(base.x, base.y, base.z, top.x, top.y, top.z);
      // La normal mira hacia la pista.
      const inward = s.right.clone().multiplyScalar(-side);
      normals.push(inward.x, inward.y, inward.z, inward.x, inward.y, inward.z);

      const u = s.distance / 14;
      uvs.push(u, 0, u, 1);

      if (i < n) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeBoundingSphere();

    const mesh = new THREE.Mesh(geo, material);
    mesh.name = `barrier-${side < 0 ? 'left' : 'right'}`;
    mesh.castShadow = true;
    wall.add(mesh);
  }

  return wall;
}
