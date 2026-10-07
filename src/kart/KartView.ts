import * as THREE from 'three';
import type { CharacterSpec } from '../characters/CharacterSpec';
import {
  buildEars,
  buildFaceGeometry,
  buildHair,
  buildNeck,
  makeFaceTexture,
  makeNumberTexture,
  makeStripedShirtTexture,
  shapeHead,
} from '../characters/faces';
import { FACE_PHOTOS, PHOTO_SKIN } from '../characters/photos';
import { buildChassis, type PanelSlot } from './chassis';
import { TUNING, type KartPhysics } from './KartPhysics';

const HEAD_RADIUS = 0.42;
/**
 * Cuánto se agranda la cabeza respecto del cuerpo.
 *
 * Es la proporción clásica del kart racer, y acá tiene una razón extra: la cara
 * es una foto y el juego se mira desde atrás y de lejos. Con una cabeza a escala
 * real, los rasgos ocupan cuatro píxeles y no se distingue quién va manejando,
 * que es medio motivo del juego.
 */
const HEAD_SCALE = 1.34;

/**
 * Representación visual del kart y su piloto.
 *
 * Está separada de la física a propósito. La física es determinista y podrá
 * correr también en el servidor para el modo online; esta clase sólo lee su
 * estado y lo dibuja. Todo lo que distingue a un personaje de otro —colores,
 * pelo, cara, número— entra por el `CharacterSpec`.
 */
export class KartView {
  readonly group = new THREE.Group();

  private readonly bodyPivot = new THREE.Group();
  private readonly wheels: THREE.Mesh[] = [];
  private readonly frontWheels: THREE.Object3D[] = [];
  private readonly faceMaterial: THREE.MeshLambertMaterial;
  private readonly sparks: THREE.Mesh[] = [];
  private readonly flame: THREE.Mesh;
  private readonly aura: THREE.Mesh;

  private wheelSpin = 0;
  private smoothedUp = new THREE.Vector3(0, 1, 0);
  private sparkPhase = 0;

  constructor(character: CharacterSpec) {
    const { kart } = character;
    // Con foto real, la piel del cuerpo toma el color del BORDE de la lámina de
    // la foto: es el último tono que se ve antes de que empiece el cráneo, así
    // que ahí no queda escalón. Con un tono sacado del medio de la mejilla
    // quedaba, y justo sobre la sien.
    const skin = PHOTO_SKIN[character.id] ?? character.appearance.skin;
    const appearance = { ...character.appearance, skin };
    this.group.name = `kart-${character.id}`;
    this.group.add(this.bodyPivot);

    const trimMat = new THREE.MeshLambertMaterial({ color: kart.trim, flatShading: true });
    const build = buildChassis(character.chassis ?? 'kart', kart);
    this.bodyPivot.add(build.group);

    this.addNumberPanels(kart, build.panels);

    // --- Piloto ---
    const driver = new THREE.Group();
    driver.name = 'driver';
    driver.scale.setScalar(appearance.scale);
    driver.position.copy(build.driver);
    this.bodyPivot.add(driver);

    // Cuerpo más grande que la cabeza en los adultos. La cabeza NO se toca: es
    // donde va la foto, y agrandarla rompería el encuadre de la cara.
    const bodyScale = appearance.bodyScale ?? 1;
    const lift = (bodyScale - 1) * 0.5;

    const striped = appearance.shirtPattern === 'rayas';
    const torso = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.33, 0.34, 4, 8),
      striped
        ? new THREE.MeshLambertMaterial({ map: makeStripedShirtTexture(appearance) })
        : new THREE.MeshLambertMaterial({ color: appearance.shirt }),
    );
    torso.position.set(0, 1.0 + lift * 0.5, -0.15);
    torso.scale.set(bodyScale, bodyScale, bodyScale);
    torso.castShadow = true;
    driver.add(torso);

    // La franja de acento sólo tiene sentido sobre una remera lisa; sobre las
    // rayas ensuciaría el dibujo.
    if (!striped) {
      const stripe = new THREE.Mesh(
        new THREE.CylinderGeometry(0.345, 0.345, 0.14, 10),
        new THREE.MeshLambertMaterial({ color: appearance.shirtAccent }),
      );
      stripe.position.set(0, 1.02 + lift * 0.5, -0.15);
      stripe.scale.set(bodyScale, 1, bodyScale);
      driver.add(stripe);
    }

    // Cuello de camisa abierto: dos solapas blancas sobre el pecho.
    if (appearance.shirtPattern === 'camisa') {
      const collarMat = new THREE.MeshLambertMaterial({
        color: appearance.shirt,
        flatShading: true,
        side: THREE.DoubleSide,
      });
      for (const side of [-1, 1]) {
        const lapel = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.26, 0.04), collarMat);
        lapel.position.set(side * 0.14 * bodyScale, 1.24 + lift * 0.7, 0.24);
        lapel.rotation.set(0.25, side * 0.55, side * 0.5);
        driver.add(lapel);
      }
      // El escote deja ver la piel: es lo que hace que se lea camisa abierta.
      const chest = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.22, 0.05),
        new THREE.MeshLambertMaterial({ color: appearance.skin }),
      );
      chest.position.set(0, 1.2 + lift * 0.7, 0.26);
      chest.rotation.x = 0.2;
      driver.add(chest);
    }

    // Musculosa: breteles finos y hombros al aire.
    if (appearance.shirtPattern === 'musculosa') {
      const skinMat = new THREE.MeshLambertMaterial({ color: appearance.skin });
      for (const side of [-1, 1]) {
        const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), skinMat);
        shoulder.position.set(side * 0.3 * bodyScale, 1.16 + lift * 0.6, -0.15);
        driver.add(shoulder);
        const strap = new THREE.Mesh(
          new THREE.BoxGeometry(0.07, 0.3, 0.06),
          new THREE.MeshLambertMaterial({ color: appearance.shirt }),
        );
        strap.position.set(side * 0.18 * bodyScale, 1.18 + lift * 0.6, -0.02);
        strap.rotation.z = side * 0.3;
        driver.add(strap);
      }
    }

    // Capucha caída sobre la espalda.
    if (appearance.shirtPattern === 'capucha') {
      const hoodGeo = new THREE.SphereGeometry(0.34, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.62);
      const hood = new THREE.Mesh(
        hoodGeo,
        new THREE.MeshLambertMaterial({ color: appearance.shirtAccent, side: THREE.DoubleSide }),
      );
      hood.position.set(0, 1.2 + lift * 0.6, -0.42);
      hood.rotation.x = Math.PI * 0.82;
      hood.scale.set(1.05, 1.15, 0.8);
      driver.add(hood);
    }

    // Brazos hacia el volante.
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.1, 0.42, 3, 6),
        new THREE.MeshLambertMaterial({ color: appearance.skin }),
      );
      arm.position.set(side * 0.3 * bodyScale, 0.95 + lift * 0.4, 0.24);
      arm.scale.setScalar(bodyScale);
      arm.rotation.set(-0.95, 0, side * 0.25);
      driver.add(arm);
    }

    // Cabeza: volumen real, con la cara aplicada sólo al frente. Así se lee
    // bien desde cualquier ángulo —de atrás se ve la nuca, no una cara
    // espejada— y el plano frontal queda como punto de inserción de la
    // caricatura del jugador.
    const head = new THREE.Group();
    // La cabeza sube con su propio tamaño: si no, el mentón se hunde en el
    // torso y la cara queda cortada por abajo.
    head.position.set(0, 1.58 + lift + (HEAD_SCALE - 1) * 0.42, -0.1);
    head.scale.setScalar(HEAD_SCALE);
    head.name = 'driver-head';

    // Cráneo con forma de cráneo: mandíbula que se afina, nuca plana y mentón
    // adelante. Sale de la misma función que el casquete de la cara, que es lo
    // que los mantiene concéntricos.
    const skull = new THREE.Mesh(
      shapeHead(new THREE.SphereGeometry(HEAD_RADIUS, 28, 22), HEAD_RADIUS),
      new THREE.MeshLambertMaterial({ color: appearance.skin }),
    );
    skull.castShadow = true;
    head.add(skull);

    head.add(buildNeck(appearance, HEAD_RADIUS));
    head.add(buildEars(appearance, HEAD_RADIUS));
    head.add(buildHair(appearance, HEAD_RADIUS));

    // La cara es un casquete curvo pegado al cráneo, no un plano: ver
    // buildFaceGeometry.
    // Lambert y no Basic: la cara tiene que recibir la MISMA luz que el cráneo.
    // Con un material sin iluminar, en la pista nocturna la cara quedaba a pleno
    // brillo sobre una cabeza en penumbra y se veía el recorte del casquete.
    this.faceMaterial = new THREE.MeshLambertMaterial({
      map: makeFaceTexture(appearance),
      transparent: true,
      depthWrite: false,
    });
    // La foto real, si el personaje tiene una. Se carga aparte porque una imagen
    // tarda en decodificar: hasta que llega se ve la cara dibujada, que es un
    // reemplazo mejor que una cabeza sin cara.
    loadPhotoFace(character.id, (texture) => this.setFaceTexture(texture, true));
    const face = new THREE.Mesh(
      buildFaceGeometry(HEAD_RADIUS),
      this.faceMaterial,
    );
    face.name = 'driver-face';
    head.add(face);

    driver.add(head);

    // --- Ruedas ---
    // Cada carrocería dice dónde y de qué tamaño van: el autoelevador las lleva
    // grandes adelante y chicas atrás, el deportivo al revés.
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x1b1e24, flatShading: true });
    for (const slot of build.wheels) {
      const wheelGeo = new THREE.CylinderGeometry(slot.radius, slot.radius, slot.width, 12);
      wheelGeo.rotateZ(Math.PI / 2);
      const hubGeo = new THREE.CylinderGeometry(slot.radius * 0.4, slot.radius * 0.4, slot.width + 0.02, 8);
      hubGeo.rotateZ(Math.PI / 2);

      const holder = new THREE.Group();
      holder.position.set(slot.x, slot.radius, slot.z);
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.castShadow = true;
      wheel.userData.radius = slot.radius;
      wheel.add(new THREE.Mesh(hubGeo, trimMat));
      holder.add(wheel);
      this.bodyPivot.add(holder);
      this.wheels.push(wheel);
      if (slot.front) this.frontWheels.push(holder);
    }

    // --- Efectos ---
    const sparkGeo = new THREE.IcosahedronGeometry(0.22, 0);
    for (const side of [-1, 1]) {
      const spark = new THREE.Mesh(
        sparkGeo,
        new THREE.MeshBasicMaterial({ color: 0x4aa8ff, transparent: true, opacity: 0.9 }),
      );
      spark.position.copy(build.sparks[side < 0 ? 0 : 1]);
      spark.visible = false;
      this.bodyPivot.add(spark);
      this.sparks.push(spark);
    }

    const flameGeo = new THREE.ConeGeometry(0.36, 1.5, 8);
    flameGeo.rotateX(Math.PI / 2);
    this.flame = new THREE.Mesh(
      flameGeo,
      new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.75 }),
    );
    this.flame.position.copy(build.exhaust);
    this.flame.visible = false;
    this.bodyPivot.add(this.flame);

    // Aura del rayo: mientras dura, el kart va envuelto en luz. Es la señal de
    // que a ese no se lo puede tocar.
    this.aura = new THREE.Mesh(
      new THREE.SphereGeometry(build.auraRadius, 16, 12),
      new THREE.MeshBasicMaterial({
        color: 0xfff04a,
        transparent: true,
        opacity: 0.3,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    );
    this.aura.position.y = build.auraHeight;
    this.aura.visible = false;
    this.bodyPivot.add(this.aura);
  }

  /** Chapas con el número, donde las quiera cada carrocería. */
  private addNumberPanels(kart: CharacterSpec['kart'], slots: PanelSlot[]): void {
    const material = new THREE.MeshBasicMaterial({
      map: makeNumberTexture(kart),
      side: THREE.DoubleSide,
    });

    for (const slot of slots) {
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(slot.size[0], slot.size[1]), material);
      panel.position.set(...slot.position);
      panel.rotation.set(...slot.rotation);
      this.bodyPivot.add(panel);
    }
  }

  /** Libera la geometría y los materiales propios de este kart. */
  dispose(): void {
    this.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of materials) {
        const mat = m as THREE.MeshBasicMaterial;
        // Las fotos son compartidas entre todos los karts del mismo piloto: si
        // las tirara el primero que se destruye, los demás se quedan sin cara.
        if (!mat.map?.userData.shared) mat.map?.dispose();
        mat.dispose();
      }
    });
  }

  /**
   * Reemplaza la cara del piloto.
   *
   * `opaque` distingue las dos texturas que pueden llegar acá. La cara dibujada
   * son rasgos sueltos sobre fondo transparente y necesita mezcla. La foto es
   * una lámina llena: alrededor del rostro ya trae la piel estirada, así que se
   * dibuja opaca y escribiendo profundidad. No es un detalle de rendimiento —
   * un casquete transparente se ordena contra el pelo y las orejas por
   * distancia al centro del objeto, y según el ángulo la cara terminaba
   * dibujándose por encima de un mechón que la tapaba, o al revés.
   */
  setFaceTexture(texture: THREE.Texture, opaque = false): void {
    if (!this.faceMaterial.map?.userData.shared) this.faceMaterial.map?.dispose();
    this.faceMaterial.map = texture;
    this.faceMaterial.transparent = !opaque;
    this.faceMaterial.depthWrite = opaque;
    this.faceMaterial.needsUpdate = true;
  }

  /** Copia el estado de la física al grafo de escena. */
  sync(physics: KartPhysics, dt: number): void {
    this.group.position.copy(physics.position);

    // Alineación con la superficie: se suaviza para que los baches y el peralte
    // no produzcan saltos bruscos de orientación.
    const targetUp = physics.grounded ? physics.projection.up : new THREE.Vector3(0, 1, 0);
    this.smoothedUp.lerp(targetUp, 1 - Math.exp(-8 * dt)).normalize();

    const yaw = physics.yaw + physics.visualDriftYaw;
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    forward.projectOnPlane(this.smoothedUp).normalize();
    // Eje X local del modelo. En un modelo que mira hacia +Z con Y arriba, el
    // +X local apunta a su izquierda; es lo que hace que la base sea derecha
    // (X × Y = Z) y el modelo no salga espejado.
    const localX = new THREE.Vector3().crossVectors(this.smoothedUp, forward).normalize();

    this.group.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(localX, this.smoothedUp, forward),
    );

    this.bodyPivot.rotation.z = physics.visualRoll;

    const steerVisual = THREE.MathUtils.clamp(
      physics.drift.active ? physics.drift.direction * 0.5 : 0,
      -0.55,
      0.55,
    );
    for (const holder of this.frontWheels) holder.rotation.y = -steerVisual;

    // Cada rueda gira según SU radio: si todas compartieran el mismo, en el
    // autoelevador las chicas de atrás se verían girando demasiado lento.
    const forwardSpeed = physics.velocity.dot(physics.forward);
    this.wheelSpin += forwardSpeed * dt;
    for (const wheel of this.wheels) {
      wheel.rotation.x = this.wheelSpin / (wheel.userData.radius as number);
    }

    this.updateEffects(physics, dt);
  }

  private updateEffects(physics: KartPhysics, dt: number): void {
    const tier = physics.drift.tier;
    this.sparkPhase += dt * 22;
    const tierColor = tier > 0 ? TUNING.driftTiers[tier - 1].color : 0x4aa8ff;

    for (const spark of this.sparks) {
      spark.visible = physics.drift.active && tier > 0;
      if (!spark.visible) continue;
      const pulse = 0.7 + Math.abs(Math.sin(this.sparkPhase)) * 0.7;
      spark.scale.setScalar(pulse);
      (spark.material as THREE.MeshBasicMaterial).color.setHex(tierColor);
    }

    this.flame.visible = physics.boostTime > 0;
    if (this.flame.visible) {
      const flicker = 0.8 + Math.sin(this.sparkPhase * 1.7) * 0.25;
      this.flame.scale.set(flicker, flicker, 1 + flicker * 0.6);
    }

    this.aura.visible = physics.immuneTime > 0;
    if (this.aura.visible) {
      const pulse = 1 + Math.sin(this.sparkPhase * 0.6) * 0.08;
      this.aura.scale.setScalar(pulse);
      (this.aura.material as THREE.MeshBasicMaterial).opacity =
        0.22 + Math.abs(Math.sin(this.sparkPhase * 0.4)) * 0.18;
    }
  }
}

/**
 * Carga la foto del piloto y la entrega cuando está lista.
 *
 * Las texturas se cachean por personaje: en una carrera de ocho karts puede
 * haber varias copias del mismo piloto, y decodificar seis veces la misma imagen
 * hace saltar el primer segundo de carrera.
 */
const photoCache = new Map<string, THREE.Texture>();

function loadPhotoFace(id: string, onReady: (texture: THREE.Texture) => void): void {
  const base = id.split('-')[0];
  const src = FACE_PHOTOS[base];
  if (!src) return;

  const cached = photoCache.get(base);
  if (cached) {
    onReady(cached);
    return;
  }

  const image = new Image();
  image.onload = () => {
    const texture = new THREE.Texture(image);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    texture.userData.shared = true;
    photoCache.set(base, texture);
    onReady(texture);
  };
  image.src = src;
}
