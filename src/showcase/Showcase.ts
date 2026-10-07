import * as THREE from 'three';
import { CHARACTERS, displayName, getCharacter } from '../characters/CharacterSpec';
import { FACE_PHOTOS } from '../characters/photos';
import { KartView } from '../kart/KartView';
import { THEMES } from '../track/themes';

/**
 * Renders de presentación.
 *
 * El juego en pista es low-poly y de colores planos a propósito: tiene que
 * correr a 60 en un celular. La portada no tiene esa restricción, así que acá se
 * renderiza cada vehículo una sola vez, fuera de línea, con otra calidad:
 * materiales PBR con reflejos de un entorno de estudio, luz de recorte, sombra
 * de contacto blanda y cuatro veces la resolución. La misma geometría, pero
 * fotografiada en un estudio en lugar de dibujada.
 *
 * El resultado son PNG que quedan embebidos en el bundle (`figures.ts`), así que
 * la presentación aparece al instante y sin montar una segunda escena 3D en el
 * arranque, que es justo el momento en que el navegador está más ocupado.
 *
 * Este módulo no se usa en el juego: lo invoca `scripts/build-figures.mjs`.
 */

export interface ShowcaseResult {
  figures: Record<string, string>;
  hero: string;
}

/**
 * Entorno de estudio: una caja con paneles emisivos.
 *
 * Es lo que da los reflejos largos en la chapa. Sin un `envMap`, un material
 * metálico se ve negro —no tiene nada que reflejar— y la carrocería queda peor
 * que con el material plano del juego.
 */
function studioEnvironment(): THREE.Scene {
  const scene = new THREE.Scene();
  const room = new THREE.BoxGeometry(1, 1, 1);
  room.deleteAttribute('uv');

  const panel = (
    color: number,
    intensity: number,
    [x, y, z]: number[],
    [sx, sy, sz]: number[],
  ) => {
    const mesh = new THREE.Mesh(
      room,
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity }),
    );
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    scene.add(mesh);
  };

  // Caja envolvente gris: el "cuarto".
  const shell = new THREE.Mesh(
    room,
    new THREE.MeshStandardMaterial({ side: THREE.BackSide, color: 0x9aa4b4 }),
  );
  shell.scale.set(28, 18, 28);
  shell.position.y = 6;
  scene.add(shell);

  // Cenital grande: el reflejo principal a lo largo del capó.
  panel(0xffffff, 6, [0, 14.2, 0], [16, 0.4, 16]);
  // Laterales fríos y cálidos: le dan volumen a los costados.
  panel(0xbfd8ff, 3.2, [-11, 6, 0], [0.4, 9, 18]);
  panel(0xffd9b0, 2.4, [11, 6, 2], [0.4, 8, 14]);
  // Contra: recorta la silueta contra el fondo.
  panel(0xffffff, 3.6, [0, 7, -12], [14, 6, 0.4]);

  return scene;
}

/**
 * Pasa el modelo de Lambert a materiales PBR.
 *
 * Reutiliza la geometría y los colores que ya tiene el kart; sólo cambia cómo
 * responden a la luz. El reparto de metal y rugosidad va por nombre y por color,
 * que es más robusto que marcar pieza por pieza: si mañana se agrega un
 * vehículo, hereda el tratamiento sin tocar nada.
 */
function upgradeMaterials(root: THREE.Object3D, env: THREE.Texture, inDriver = false): void {
  // El piloto no puede recibir el mismo tratamiento que la chapa: con metalness
  // alto, el pelo y la remera se ven cromados. Por eso se recorre a mano
  // llevando la cuenta de si vamos dentro del grupo del piloto, en vez de usar
  // `traverse`, que pierde el contexto del padre.
  const driver = inDriver || root.name === 'driver';

  const mesh = root as THREE.Mesh;
  if (mesh.isMesh) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const upgraded = list.map((m) => {
      const old = m as THREE.MeshLambertMaterial;
      // Lo que ya era MeshBasic (auras, llamas, brillos) se deja: son efectos,
      // no superficies, y pasarlos a PBR los apaga.
      if (!(old as unknown as { isMeshLambertMaterial?: boolean }).isMeshLambertMaterial) return m;

      const isTyre = old.color.getHex() === 0x1b1e24;
      const soft = driver || isTyre;

      return new THREE.MeshStandardMaterial({
        color: old.color,
        map: old.map,
        transparent: old.transparent,
        opacity: old.opacity,
        side: old.side,
        depthWrite: old.depthWrite,
        flatShading: old.flatShading,
        envMap: env,
        envMapIntensity: soft ? 0.45 : 1.1,
        metalness: soft ? 0.02 : 0.55,
        roughness: driver ? 0.78 : isTyre ? 0.9 : 0.3,
      });
    });

    mesh.material = Array.isArray(mesh.material) ? upgraded : upgraded[0];
  }

  for (const child of root.children) upgradeMaterials(child, env, driver);
}

/** Deja pasar unos frames para que terminen de aplicarse las texturas. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 260));
}

/** Espera a que las fotos de las caras estén decodificadas. */
async function preloadPhotos(): Promise<void> {
  await Promise.all(
    Object.values(FACE_PHOTOS).map(
      (src) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.src = src;
        }),
    ),
  );
  // Un frame más: `KartView` aplica la textura desde el callback de la imagen.
  await new Promise((r) => setTimeout(r, 120));
}

function makeRenderer(width: number, height: number, alpha: boolean): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    alpha,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(width, height, false);
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.5;
  return renderer;
}

/** Luces de estudio: principal con sombra, relleno frío y recorte por detrás. */
function studioLights(scene: THREE.Scene, spread: number): void {
  const key = new THREE.DirectionalLight(0xfff3e0, 2.6);
  key.position.set(spread * 0.9, spread * 1.5, spread * 1.1);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = spread * 6;
  const box = key.shadow.camera as THREE.OrthographicCamera;
  box.left = -spread * 1.6;
  box.right = spread * 1.6;
  box.top = spread * 1.6;
  box.bottom = -spread * 1.6;
  box.updateProjectionMatrix();
  key.shadow.bias = -0.0009;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xbcd6ff, 0.9);
  fill.position.set(-spread * 1.2, spread * 0.7, spread * 0.8);
  scene.add(fill);

  // De atrás y bajo: dibuja el borde del vehículo, que es lo que lo despega del
  // fondo y hace que se lea como una foto y no como un recorte plano.
  const rim = new THREE.DirectionalLight(0xffffff, 2.2);
  rim.position.set(-spread * 0.6, spread * 0.5, -spread * 1.4);
  scene.add(rim);

  scene.add(new THREE.HemisphereLight(0xdceaff, 0x6a707c, 1.35));
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
}

/** Encuadra la cámara sobre un objeto, mirándolo desde tres cuartos. */
function frame(
  camera: THREE.PerspectiveCamera,
  target: THREE.Object3D,
  yaw: number,
  pitch: number,
  margin: number,
): void {
  const box = new THREE.Box3().setFromObject(target);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z) * margin;
  const distance = radius / Math.tan((camera.fov * Math.PI) / 360);

  camera.position.set(
    center.x + Math.sin(yaw) * Math.cos(pitch) * distance,
    center.y + Math.sin(pitch) * distance,
    center.z + Math.cos(yaw) * Math.cos(pitch) * distance,
  );
  camera.lookAt(center);
  camera.near = distance * 0.05;
  camera.far = distance * 8;
  camera.updateProjectionMatrix();
}

/** Piso que sólo recibe sombra: da el contacto sin tapar el fondo. */
function shadowFloor(size: number, y: number): THREE.Mesh {
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.ShadowMaterial({ opacity: 0.42 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = y;
  floor.receiveShadow = true;
  return floor;
}

/** Un vehículo con su piloto, recortado sobre fondo transparente. */
async function renderFigure(id: string, size: number, env: THREE.Texture): Promise<string> {
  const renderer = makeRenderer(size, size, true);
  const scene = new THREE.Scene();
  const view = new KartView(getCharacter(id));
  scene.add(view.group);
  // La foto de la cara entra por el `onload` de una imagen, así que hay que
  // darle un respiro antes de convertir los materiales y renderizar: si no, la
  // portada sale con la cara dibujada en lugar de la real.
  await settle();
  upgradeMaterials(view.group, env);
  studioLights(scene, 4);

  const box = new THREE.Box3().setFromObject(view.group);
  scene.add(shadowFloor(30, box.min.y + 0.01));

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  // Tres cuartos desde adelante y apenas por encima: se ven la trompa, el
  // costado con el número y la cara del piloto a la vez.
  // El modelo mira a +Z: la cámara tiene que quedar de ese lado o se ve la nuca.
  frame(camera, view.group, Math.PI * 0.21, 0.2, 0.62);
  renderer.render(scene, camera);

  const url = renderer.domElement.toDataURL('image/webp', 0.92);
  view.dispose();
  renderer.dispose();
  return url;
}

/**
 * Retratos de control de las cabezas, para mirarlas de cerca y de varios lados.
 *
 * La cara se diseña mirando texturas de 512 px, pero lo que importa es cómo
 * queda puesta sobre el cráneo: si el casquete se hunde, si el nacimiento del
 * pelo cae donde va, si la mandíbula cierra. De frente casi todo parece bien;
 * los problemas aparecen a tres cuartos y de perfil, que es justo desde donde se
 * ve al piloto mientras se corre. Esto no entra en el juego, es para verificar.
 */
export async function renderHeadShots(size = 320): Promise<Record<string, string[]>> {
  const env = studioEnvironment();
  const pmrem = new THREE.PMREMGenerator(makeRenderer(4, 4, false));
  const envMap = pmrem.fromScene(env).texture;
  const out: Record<string, string[]> = {};

  for (const id of Object.keys(showcaseNames())) {
    const shots: string[] = [];
    for (const yaw of [0, Math.PI * 0.22, Math.PI * 0.5, Math.PI]) {
      const renderer = makeRenderer(size, size, false);
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x2a2f38);
      const view = new KartView(getCharacter(id));
      scene.add(view.group);
      await settle();
      upgradeMaterials(view.group, envMap);
      studioLights(scene, 2);

      const head = view.group.getObjectByName('driver-head');
      const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
      if (head) frame(camera, head, yaw, 0.06, 0.78);
      renderer.render(scene, camera);
      shots.push(renderer.domElement.toDataURL('image/webp', 0.92));
      view.dispose();
      renderer.dispose();
    }
    out[id] = shots;
  }
  pmrem.dispose();
  return out;
}

/**
 * El fondo de la presentación y del menú.
 *
 * Es el escenario vacío: cielo de atardecer, piso pulido y niebla en el
 * horizonte. Los vehículos NO van acá: entran encima, uno por uno, con la
 * animación de la portada. Separarlos permite animarlos de verdad en vez de
 * mostrar una foto de grupo quieta, y deja el mismo fondo servido para el menú.
 */
async function renderBackdrop(width: number, height: number, env: THREE.Texture): Promise<string> {
  const renderer = makeRenderer(width, height, false);
  const scene = new THREE.Scene();
  const sky = THEMES.miami;

  const backdrop = new THREE.Mesh(
    new THREE.SphereGeometry(400, 32, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        top: { value: new THREE.Color(0x061024) },
        middle: { value: new THREE.Color(sky.skyMiddle) },
        bottom: { value: new THREE.Color(0x0a0f1a) },
      },
      vertexShader: `varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 top; uniform vec3 middle; uniform vec3 bottom; varying vec3 vPos;
        void main(){
          float h = normalize(vPos).y;
          vec3 c = h > 0.0 ? mix(middle, top, pow(h, 0.55)) : mix(middle, bottom, pow(-h, 0.3));
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  scene.add(backdrop);

  // Piso: un degradado pintado, no una superficie iluminada. Con una luz real,
  // el reflejo del foco deja un charco blanco enorme en una esquina y el resto
  // en negro; pintado, el fondo queda parejo y se puede leer el título encima.
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(256, 200, 20, 256, 256, 300);
  grad.addColorStop(0, '#2a3548');
  grad.addColorStop(0.45, '#161d2c');
  grad.addColorStop(1, '#080b13');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);
  // Brillo de la línea del horizonte.
  ctx.fillStyle = 'rgba(120, 190, 235, 0.16)';
  ctx.fillRect(0, 0, 512, 26);
  const floorTexture = new THREE.CanvasTexture(canvas);
  floorTexture.colorSpace = THREE.SRGBColorSpace;

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(240, 240),
    new THREE.MeshBasicMaterial({ map: floorTexture }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const camera = new THREE.PerspectiveCamera(34, width / height, 0.1, 900);
  // La cámara mira apenas hacia abajo para que el horizonte quede en el tercio
  // superior: los vehículos de la portada tienen que apoyarse sobre el piso, no
  // flotar sobre la línea del cielo.
  camera.position.set(0, 3.4, 16);
  camera.lookAt(0, 0.9, -2);
  renderer.render(scene, camera);

  const url = renderer.domElement.toDataURL('image/webp', 0.9);
  renderer.dispose();
  void env;
  return url;
}

/** Renderiza todo. La llama el script de build, no el juego. */
export async function renderShowcase(figureSize = 900): Promise<ShowcaseResult> {
  await preloadPhotos();

  const pmremRenderer = makeRenderer(4, 4, true);
  const pmrem = new THREE.PMREMGenerator(pmremRenderer);
  const env = pmrem.fromScene(studioEnvironment(), 0.04).texture;

  const figures: Record<string, string> = {};
  for (const character of CHARACTERS) {
    figures[character.id] = await renderFigure(character.id, figureSize, env);
  }
  const hero = await renderBackdrop(1920, 1080, env);

  pmrem.dispose();
  pmremRenderer.dispose();
  return { figures, hero };
}

/** Nombres por defecto, para rotular la presentación. */
export function showcaseNames(): Record<string, string> {
  return Object.fromEntries(CHARACTERS.map((c) => [c.id, displayName(c, {})]));
}
