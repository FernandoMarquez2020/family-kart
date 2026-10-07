import * as THREE from 'three';

/**
 * Aspecto y efectos de los proyectiles.
 *
 * Vive aparte de `ItemSystem` porque son dos cosas distintas: allá está la
 * lógica (a quién persigue, a quién pega) y acá el espectáculo. La bola de fuego
 * era una esfera lisa de color naranja y no se leía como fuego; un proyectil
 * tiene que verse aunque pase por el costado de la pantalla en una décima.
 */

const TRAIL_LENGTH = 14;

/** Textura radial suave: la base de todo lo que brilla, sin archivos externos. */
function makeGlowTexture(inner: string, outer: string): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, outer);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Recursos compartidos por todos los proyectiles de una carrera.
 *
 * Geometrías y texturas se crean una sola vez: durante una carrera se lanzan
 * decenas de proyectiles y crear una textura por disparo tira el frame rate.
 */
export class ProjectileAssets {
  readonly glow = makeGlowTexture('rgba(255,255,255,1)', 'rgba(255,150,40,0.85)');
  readonly spark = makeGlowTexture('rgba(255,255,255,1)', 'rgba(120,200,255,0.8)');
  readonly smoke = makeGlowTexture('rgba(210,215,225,0.85)', 'rgba(150,155,170,0.35)');

  readonly core = new THREE.IcosahedronGeometry(0.42, 1);
  readonly shell = new THREE.IcosahedronGeometry(0.72, 1);
  readonly cone = new THREE.ConeGeometry(0.34, 1.5, 10);
  readonly fin = new THREE.BoxGeometry(0.06, 0.34, 0.3);
  readonly ring = new THREE.RingGeometry(0.6, 1, 28);
  readonly quad = new THREE.PlaneGeometry(1, 1);

  dispose(): void {
    this.glow.dispose();
    this.spark.dispose();
    this.smoke.dispose();
    this.core.dispose();
    this.shell.dispose();
    this.cone.dispose();
    this.fin.dispose();
    this.ring.dispose();
    this.quad.dispose();
  }
}

/**
 * Estela: una fila de destellos que quedan atrás del proyectil.
 *
 * En vez de un sistema de partículas con velocidades propias, cada destello
 * guarda una posición pasada del proyectil y se desvanece según su lugar en la
 * fila. Es mucho más barato y, al ir pegado al recorrido real, se lee mejor que
 * una nube difusa.
 */
export class Trail {
  readonly group = new THREE.Group();
  private readonly sprites: THREE.Sprite[] = [];
  private readonly points: THREE.Vector3[] = [];
  private readonly materials: THREE.SpriteMaterial[] = [];

  constructor(assets: ProjectileAssets, color: number, size: number, texture: THREE.Texture) {
    for (let i = 0; i < TRAIL_LENGTH; i++) {
      const age = i / (TRAIL_LENGTH - 1);
      const material = new THREE.SpriteMaterial({
        map: texture,
        color,
        transparent: true,
        opacity: (1 - age) * 0.75,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const sprite = new THREE.Sprite(material);
      const scale = size * (1 - age * 0.72);
      sprite.scale.set(scale, scale, scale);
      this.sprites.push(sprite);
      this.materials.push(material);
      this.points.push(new THREE.Vector3());
      this.group.add(sprite);
    }
    void assets;
  }

  reset(position: THREE.Vector3): void {
    for (const p of this.points) p.copy(position);
    for (let i = 0; i < this.sprites.length; i++) this.sprites[i].position.copy(position);
  }

  /** Corre la fila un lugar y pone la cabeza en la posición actual. */
  update(position: THREE.Vector3): void {
    for (let i = this.points.length - 1; i > 0; i--) this.points[i].copy(this.points[i - 1]);
    this.points[0].copy(position);
    for (let i = 0; i < this.sprites.length; i++) this.sprites[i].position.copy(this.points[i]);
  }

  dispose(): void {
    for (const m of this.materials) m.dispose();
  }
}

/** Bola de fuego: núcleo blanco, envoltura naranja que late y estela de brasas. */
export function buildFireball(assets: ProjectileAssets): {
  group: THREE.Group;
  trail: Trail;
  update: (dt: number, life: number) => void;
} {
  const group = new THREE.Group();

  const core = new THREE.Mesh(
    assets.core,
    new THREE.MeshBasicMaterial({ color: 0xfff3c4 }),
  );
  const shell = new THREE.Mesh(
    assets.shell,
    new THREE.MeshBasicMaterial({
      color: 0xff7a1f,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: assets.glow,
      color: 0xff9b3c,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  halo.scale.set(3.2, 3.2, 3.2);

  group.add(core, shell, halo);

  const trail = new Trail(assets, 0xff8a2b, 1.9, assets.glow);

  let time = 0;
  const update = (dt: number, life: number) => {
    time += dt;
    // Latido rápido: el fuego nunca está quieto.
    const pulse = 1 + Math.sin(time * 26) * 0.16;
    shell.scale.setScalar(pulse);
    core.scale.setScalar(1 + Math.sin(time * 37 + 1.2) * 0.12);
    halo.scale.setScalar(3.2 * pulse);
    // Rotación en dos ejes para que las caras del icosaedro titilen.
    core.rotation.x += dt * 9;
    core.rotation.y += dt * 6;
    shell.rotation.y -= dt * 4;
    shell.rotation.z += dt * 3;
    // Al final de su vida se apaga en vez de desaparecer de golpe.
    const fade = Math.min(1, life / 0.6);
    (halo.material as THREE.SpriteMaterial).opacity = 0.9 * fade;
    (shell.material as THREE.MeshBasicMaterial).opacity = 0.75 * fade;
  };

  return { group, trail, update };
}

/** Misil: cuerpo de cono con aletas y llama de escape. */
export function buildMissile(assets: ProjectileAssets): {
  group: THREE.Group;
  trail: Trail;
  update: (dt: number, life: number) => void;
} {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    assets.cone,
    new THREE.MeshLambertMaterial({ color: 0xe8eefc, flatShading: true }),
  );
  // El cono apunta +Y; lo acostamos para que mire hacia adelante (+Z local).
  body.rotation.x = Math.PI / 2;
  const nose = new THREE.Mesh(
    assets.core,
    new THREE.MeshLambertMaterial({ color: 0x2f6bd8, flatShading: true }),
  );
  nose.position.z = 0.72;
  nose.scale.set(0.8, 0.8, 0.9);

  for (const side of [-1, 1]) {
    const fin = new THREE.Mesh(
      assets.fin,
      new THREE.MeshLambertMaterial({ color: 0x4aa8ff, flatShading: true }),
    );
    fin.position.set(side * 0.3, 0, -0.55);
    group.add(fin);
  }
  const topFin = new THREE.Mesh(
    assets.fin,
    new THREE.MeshLambertMaterial({ color: 0x4aa8ff, flatShading: true }),
  );
  topFin.rotation.z = Math.PI / 2;
  topFin.position.set(0, 0.28, -0.55);

  const flame = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: assets.spark,
      color: 0x9fd8ff,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  flame.position.z = -0.95;
  flame.scale.set(1.5, 1.5, 1.5);

  group.add(body, nose, topFin, flame);

  const trail = new Trail(assets, 0x8fc6ff, 1.4, assets.smoke);

  let time = 0;
  const update = (dt: number, life: number) => {
    time += dt;
    const flicker = 1 + Math.sin(time * 40) * 0.25;
    flame.scale.setScalar(1.5 * flicker);
    // Leve balanceo: delata que va corrigiendo el rumbo todo el tiempo.
    group.rotateZ(Math.sin(time * 9) * dt * 1.6);
    const fade = Math.min(1, life / 0.5);
    (flame.material as THREE.SpriteMaterial).opacity = 0.95 * fade;
  };

  return { group, trail, update };
}

interface Burst {
  group: THREE.Group;
  life: number;
  total: number;
  sprites: THREE.Sprite[];
  directions: THREE.Vector3[];
  ring: THREE.Mesh;
  flash: THREE.Sprite;
}

/**
 * Explosiones. Se reciclan: una carrera con cuatro karts tirándose poderes
 * produce muchas, y crear y tirar mallas en cada impacto se nota como tirones.
 */
export class Explosions {
  readonly group = new THREE.Group();
  private readonly active: Burst[] = [];
  private readonly pool: Burst[] = [];

  constructor(private readonly assets: ProjectileAssets) {
    this.group.name = 'explosions';
  }

  private make(): Burst {
    const group = new THREE.Group();
    const sprites: THREE.Sprite[] = [];
    const directions: THREE.Vector3[] = [];
    for (let i = 0; i < 12; i++) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.assets.glow,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      sprites.push(sprite);
      // Direcciones fijas repartidas en una semiesfera: sin azar, para que dos
      // partidas con los mismos inputs se vean igual (hace falta para el online).
      const angle = (i / 12) * Math.PI * 2;
      const lift = 0.25 + (i % 3) * 0.3;
      directions.push(new THREE.Vector3(Math.cos(angle), lift, Math.sin(angle)).normalize());
      group.add(sprite);
    }

    const ring = new THREE.Mesh(
      this.assets.ring,
      new THREE.MeshBasicMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    ring.rotation.x = -Math.PI / 2;

    const flash = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.assets.glow,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );

    group.add(ring, flash);
    group.visible = false;
    this.group.add(group);
    return { group, life: 0, total: 0.5, sprites, directions, ring, flash };
  }

  /** Dispara una explosión en un punto. `scale` la agranda para la bola de fuego. */
  spawn(position: THREE.Vector3, color: number, scale = 1): void {
    const burst = this.pool.pop() ?? this.make();
    burst.group.position.copy(position);
    burst.group.visible = true;
    burst.life = burst.total = 0.5;
    burst.group.scale.setScalar(scale);
    for (const s of burst.sprites) {
      s.position.set(0, 0, 0);
      (s.material as THREE.SpriteMaterial).color.setHex(color);
    }
    (burst.ring.material as THREE.MeshBasicMaterial).color.setHex(color);
    (burst.flash.material as THREE.SpriteMaterial).color.setHex(0xffffff);
    this.active.push(burst);
  }

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const b = this.active[i];
      b.life -= dt;
      if (b.life <= 0) {
        b.group.visible = false;
        this.active.splice(i, 1);
        this.pool.push(b);
        continue;
      }
      const t = 1 - b.life / b.total; // 0 → 1
      const ease = 1 - (1 - t) * (1 - t);

      for (let s = 0; s < b.sprites.length; s++) {
        const sprite = b.sprites[s];
        sprite.position.copy(b.directions[s]).multiplyScalar(ease * 5.5);
        // La gravedad les baja un poco la trayectoria: parecen brasas.
        sprite.position.y -= ease * ease * 1.6;
        const size = 2.2 * (1 - t * 0.55);
        sprite.scale.set(size, size, size);
        (sprite.material as THREE.SpriteMaterial).opacity = (1 - t) * 0.9;
      }

      const ringScale = 1 + ease * 6;
      b.ring.scale.set(ringScale, ringScale, ringScale);
      (b.ring.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.6;

      const flashSize = 7 * (1 - t) + 1;
      b.flash.scale.set(flashSize, flashSize, flashSize);
      (b.flash.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - t * 3);
    }
  }

  /** Cantidad de explosiones vivas. Lo usa el test. */
  get activeCount(): number {
    return this.active.length;
  }

  dispose(): void {
    this.group.clear();
    this.active.length = 0;
    this.pool.length = 0;
  }
}
