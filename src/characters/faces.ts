import * as THREE from 'three';
import type { CharacterAppearance, FacialHair, KartLivery } from './CharacterSpec';

/**
 * Caras de los personajes.
 *
 * Todo se dibuja por código sobre un canvas: no hay ni un archivo de imagen en
 * el proyecto. La contra es que cada rasgo hay que pensarlo; la ventaja es que
 * un personaje nuevo son diez líneas de parámetros y que la misma cara sirve
 * para el retrato del menú y para el piloto en pista, así que en la carrera se
 * reconoce a quién elegiste.
 *
 * Las caricaturas son de estilo propio, inspiradas en las fotos que pasó el
 * jugador: no son un calco ni un retrato fotográfico de nadie.
 */

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** Mezcla dos colores. `t` 0 = a, 1 = b. */
function mix(a: number, b: number, t: number): string {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

function shade(color: number, amount: number): string {
  return amount < 0 ? mix(color, 0x000000, -amount) : mix(color, 0xffffff, amount);
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('No se pudo crear el contexto 2D');
  return [c, ctx];
}

function toTexture(c: HTMLCanvasElement): THREE.Texture {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Cara del piloto: sólo los rasgos, sobre fondo transparente.
 *
 * El volumen de la cabeza y el color de piel los pone la geometría 3D; esta
 * textura va sobre un casquete al frente. Separarlo así permite cambiar la
 * expresión sin tocar el modelo.
 */
export function makeFaceTexture(a: CharacterAppearance): THREE.Texture {
  return toTexture(makeFaceCanvas(a));
}

/** Medidas de la cara, derivadas de los parámetros del personaje. */
interface Layout {
  cx: number;
  eyeY: number;
  eyeDx: number;
  eyeRx: number;
  eyeRy: number;
  browY: number;
  noseTop: number;
  noseY: number;
  noseW: number;
  mouthY: number;
  chinY: number;
}

const S = 512;

function layoutFor(a: CharacterAppearance): Layout {
  const adult = a.adult === true;
  const w = a.faceWidth ?? 1;
  // Proporciones: en un chico los ojos son grandes y están bajos en la cara; en
  // un adulto son más chicos, más separados y suben. Es el ajuste que hace que
  // una misma construcción sirva para los dos sin que el adulto parezca un nene.
  return {
    cx: S / 2,
    eyeY: adult ? 232 : 246,
    eyeDx: (adult ? 84 : 78) * w,
    eyeRx: (adult ? 27 : 32) * w,
    eyeRy: adult ? 25 : 34,
    browY: adult ? 176 : 172,
    noseTop: adult ? 236 : 252,
    noseY: adult ? 300 : 306,
    noseW: (adult ? 30 : 25) * (a.noseWidth ?? 1),
    mouthY: adult ? 350 : 348,
    chinY: adult ? 420 : 404,
  };
}

/** Los rasgos sueltos, sobre fondo transparente. */
function makeFaceCanvas(a: CharacterAppearance): HTMLCanvasElement {
  const [c, ctx] = canvas(S, S);
  const L = layoutFor(a);

  // El sombreado va en su propio canvas y se recorta con una máscara ovalada
  // antes de pegarlo. Pintado directo sobre la cara, los degradados llegan al
  // borde del canvas y en el modelo 3D se ve el recuadro del casquete marcado
  // sobre la mejilla.
  const [shadeCanvas, shadeCtx] = canvas(S, S);
  drawSkinShading(shadeCtx, a, L);
  shadeCtx.globalCompositeOperation = 'destination-in';
  const mask = shadeCtx.createRadialGradient(S / 2, S * 0.5, S * 0.12, S / 2, S * 0.5, S * 0.52);
  mask.addColorStop(0, 'rgba(0,0,0,1)');
  mask.addColorStop(0.7, 'rgba(0,0,0,1)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  shadeCtx.fillStyle = mask;
  shadeCtx.fillRect(0, 0, S, S);
  ctx.drawImage(shadeCanvas, 0, 0);

  drawEyes(ctx, a, L);
  drawBrows(ctx, a, L);
  drawNose(ctx, a, L);
  drawMouth(ctx, a, L);
  drawFacialHair(ctx, a, L);
  if (a.freckles) drawFreckles(ctx, a, L);

  return c;
}

/**
 * Sombras y luces de la piel.
 *
 * La cabeza es una esfera de color plano; sin esto la cara se ve de goma. Con
 * cuatro washes translúcidos —pómulos, sienes, bajo la nariz y bajo el
 * mentón— aparece el volumen sin tener que modelar nada.
 */
function drawSkinShading(ctx: CanvasRenderingContext2D, a: CharacterAppearance, L: Layout): void {
  const dark = shade(a.skin, -0.3);

  const alpha = (css: string, value: number) =>
    css.replace('rgb', 'rgba').replace(')', `, ${value})`);

  // Sienes y costados: oscurecen el contorno y afinan la cara.
  for (const side of [-1, 1]) {
    const g = ctx.createLinearGradient(L.cx + side * 168, 0, L.cx + side * 78, 0);
    g.addColorStop(0, alpha(dark, 0.4));
    g.addColorStop(1, alpha(dark, 0));
    ctx.fillStyle = g;
    ctx.fillRect(side < 0 ? 0 : L.cx, 110, L.cx, 320);
  }

  // Pómulos: un toque cálido, más marcado en los chicos.
  ctx.fillStyle = a.adult ? 'rgba(198, 96, 84, 0.13)' : 'rgba(224, 112, 104, 0.18)';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(L.cx + side * 132, L.eyeY + 72, 52, 34, side * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Sombra bajo el labio inferior: insinúa el mentón sin dibujarle una barba.
  ctx.fillStyle = alpha(dark, 0.2);
  ctx.beginPath();
  ctx.ellipse(L.cx, L.mouthY + 52, 46, 16, 0, 0, Math.PI * 2);
  ctx.fill();

  // Brillo de la frente.
  const fore = ctx.createRadialGradient(L.cx, 150, 10, L.cx, 150, 150);
  fore.addColorStop(0, 'rgba(255,255,255,0.18)');
  fore.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = fore;
  ctx.fillRect(L.cx - 150, 20, 300, 260);
}

/**
 * Ojos almendrados con párpado, iris con fibras y dos brillos.
 *
 * El detalle que más cambia el parecido es el iris: un disco de color plano se
 * lee como un botón, mientras que unas rayas radiales y un anillo oscuro en el
 * borde lo vuelven una mirada.
 */
function drawEyes(ctx: CanvasRenderingContext2D, a: CharacterAppearance, L: Layout): void {
  const ink = '#241f1c';
  const squint = a.expression === 'risa';

  for (const side of [-1, 1]) {
    const x = L.cx + side * L.eyeDx;

    if (squint) {
      // Ojos apretados de risa: un arco grueso hacia arriba y nada más.
      ctx.lineWidth = 17;
      ctx.lineCap = 'round';
      ctx.strokeStyle = ink;
      ctx.beginPath();
      ctx.arc(x, L.eyeY + 20, 36, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
      continue;
    }

    const rx = L.eyeRx;
    const ry = L.eyeRy;

    // Contorno almendrado: dos curvas, la de arriba más alta hacia la nariz.
    const almond = new Path2D();
    almond.moveTo(x - rx, L.eyeY + 2);
    almond.quadraticCurveTo(x - rx * 0.2, L.eyeY - ry * 1.25, x + rx, L.eyeY - 2);
    almond.quadraticCurveTo(x + rx * 0.1, L.eyeY + ry * 1.12, x - rx, L.eyeY + 2);
    almond.closePath();

    ctx.save();
    ctx.clip(almond);

    // Esclerótica con una sombra arriba, que es lo que hunde el ojo en la órbita.
    ctx.fillStyle = '#f7f3ef';
    ctx.fillRect(x - rx - 4, L.eyeY - ry - 6, rx * 2 + 8, ry * 2 + 12);
    const lid = ctx.createLinearGradient(0, L.eyeY - ry, 0, L.eyeY);
    lid.addColorStop(0, 'rgba(90, 70, 60, 0.42)');
    lid.addColorStop(1, 'rgba(90, 70, 60, 0)');
    ctx.fillStyle = lid;
    ctx.fillRect(x - rx - 4, L.eyeY - ry - 6, rx * 2 + 8, ry + 6);

    // Iris.
    const irisR = Math.min(rx * 0.85, ry * 0.95);
    const iris = ctx.createRadialGradient(x, L.eyeY + 2, irisR * 0.2, x, L.eyeY + 2, irisR);
    iris.addColorStop(0, shade(a.eyes, 0.3));
    iris.addColorStop(0.65, hex(a.eyes));
    iris.addColorStop(1, shade(a.eyes, -0.45));
    ctx.fillStyle = iris;
    ctx.beginPath();
    ctx.arc(x, L.eyeY + 2, irisR, 0, Math.PI * 2);
    ctx.fill();

    // Fibras del iris.
    ctx.strokeStyle = shade(a.eyes, -0.3);
    ctx.lineWidth = 1.6;
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(ang) * irisR * 0.32, L.eyeY + 2 + Math.sin(ang) * irisR * 0.32);
      ctx.lineTo(x + Math.cos(ang) * irisR * 0.92, L.eyeY + 2 + Math.sin(ang) * irisR * 0.92);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Anillo del limbo y pupila.
    ctx.strokeStyle = 'rgba(30, 22, 18, 0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, L.eyeY + 2, irisR - 1, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#100c0a';
    ctx.beginPath();
    ctx.arc(x, L.eyeY + 2, irisR * 0.44, 0, Math.PI * 2);
    ctx.fill();

    // Dos brillos: uno grande arriba y uno chico abajo del otro lado. Con uno
    // solo el ojo queda opaco.
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.arc(x + irisR * 0.34, L.eyeY - irisR * 0.34, irisR * 0.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.arc(x - irisR * 0.42, L.eyeY + irisR * 0.42, irisR * 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.restore();

    // Línea del párpado superior. Más gruesa con pestañas marcadas.
    ctx.strokeStyle = ink;
    ctx.lineWidth = a.lashes ? 8 : 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - rx, L.eyeY + 2);
    ctx.quadraticCurveTo(x - rx * 0.2, L.eyeY - ry * 1.25, x + rx, L.eyeY - 2);
    ctx.stroke();

    // Pliegue del párpado.
    ctx.strokeStyle = 'rgba(70, 48, 38, 0.35)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - rx * 0.8, L.eyeY - ry * 0.75);
    ctx.quadraticCurveTo(x - rx * 0.1, L.eyeY - ry * 1.5, x + rx * 0.85, L.eyeY - ry * 0.55);
    ctx.stroke();

    if (a.lashes) {
      ctx.strokeStyle = ink;
      ctx.lineWidth = 4;
      for (let i = 0; i < 3; i++) {
        const t = 0.62 + i * 0.16;
        const px = x - rx + rx * 2 * t;
        const py = L.eyeY - ry * (1.05 - Math.abs(t - 0.5) * 0.9);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + side * 12, py - 11);
        ctx.stroke();
      }
    }

    // Línea inferior, suave: cierra el ojo sin encerrarlo.
    ctx.strokeStyle = 'rgba(60, 42, 34, 0.45)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - rx * 0.85, L.eyeY + ry * 0.55);
    ctx.quadraticCurveTo(x, L.eyeY + ry * 1.1, x + rx * 0.85, L.eyeY + ry * 0.45);
    ctx.stroke();
  }
}

/**
 * Cejas dibujadas pelo por pelo.
 *
 * Un trazo grueso único se lee como una franja pintada. Con veinte pelitos que
 * cambian de largo y de inclinación a lo largo del arco, la ceja tiene punta y
 * cola y la mirada gana carácter.
 */
function drawBrows(ctx: CanvasRenderingContext2D, a: CharacterAppearance, L: Layout): void {
  const color = a.brows ?? a.hair;
  const weight = a.browWeight ?? 1;
  // La inclinación es lo que define la actitud: bajando por dentro se ve
  // decidido; bajando por fuera, preocupado, que no es lo que queremos.
  const angry = a.expression === 'seria' || a.expression === 'segura';
  const innerDrop = angry ? 18 : -4;
  const raise = a.expression === 'pilla' ? -16 : 0;

  for (const side of [-1, 1]) {
    const inner = L.cx + side * (L.eyeDx - L.eyeRx - 2);
    const outer = L.cx + side * (L.eyeDx + L.eyeRx + 14);
    const innerY = L.browY + innerDrop;
    const outerY = L.browY + (side > 0 ? raise : 0);

    for (let i = 0; i <= 18; i++) {
      const t = i / 18;
      const x = inner + (outer - inner) * t;
      // Arco: la ceja sube hasta dos tercios y después cae.
      const arch = Math.sin(t * Math.PI) * 13;
      const y = innerY + (outerY - innerY) * t - arch;
      // Gruesa y erizada en el nacimiento, fina y peinada en la cola.
      const len = (17 - t * 11) * weight;
      const tilt = -0.55 - t * 0.5;
      ctx.strokeStyle = color === a.hair ? shade(a.hair, -0.12) : hex(color);
      ctx.lineWidth = (5.5 - t * 2.6) * weight;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, y + len * 0.4);
      ctx.lineTo(x + side * Math.cos(tilt) * len * 0.5, y - len * 0.6);
      ctx.stroke();
    }
  }
}

/** Nariz: sombra lateral, punta y fosas. No se dibuja el contorno entero. */
function drawNose(ctx: CanvasRenderingContext2D, a: CharacterAppearance, L: Layout): void {
  const dark = shade(a.skin, -0.32);
  const light = shade(a.skin, 0.35);
  const w = L.noseW;

  // Sombra del lomo, sólo de un lado: es lo que le da relieve.
  const g = ctx.createLinearGradient(L.cx - w * 0.9, 0, L.cx + w * 0.4, 0);
  g.addColorStop(0, dark.replace('rgb', 'rgba').replace(')', ', 0.42)'));
  g.addColorStop(1, dark.replace('rgb', 'rgba').replace(')', ', 0)'));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(L.cx - w * 0.5, L.noseTop);
  ctx.lineTo(L.cx - w * 1.15, L.noseY + 4);
  ctx.quadraticCurveTo(L.cx, L.noseY + 26, L.cx + w * 1.15, L.noseY + 4);
  ctx.lineTo(L.cx + w * 0.5, L.noseTop);
  ctx.closePath();
  ctx.fill();

  // Punta iluminada.
  ctx.fillStyle = light.replace('rgb', 'rgba').replace(')', ', 0.6)');
  ctx.beginPath();
  ctx.ellipse(L.cx + 3, L.noseY - 4, w * 0.5, w * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();

  // Sombra bajo la nariz y fosas.
  ctx.fillStyle = dark.replace('rgb', 'rgba').replace(')', ', 0.5)');
  ctx.beginPath();
  ctx.ellipse(L.cx, L.noseY + 12, w * 1.05, w * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(48, 30, 24, 0.75)';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(L.cx + side * w * 0.62, L.noseY + 8, w * 0.21, w * 0.15, side * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Boca con labios de verdad, y dientes cuando la expresión los pide. */
function drawMouth(ctx: CanvasRenderingContext2D, a: CharacterAppearance, L: Layout): void {
  const y = L.mouthY;
  const lips = a.lips ?? 0xb97466;
  const ink = '#2b1f1b';
  const open = a.expression === 'risa' || a.expression === 'dientito';

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (open) {
    const halfW = a.expression === 'risa' ? 100 : 82;
    const depth = a.expression === 'risa' ? 74 : 56;

    // Hueco de la boca.
    ctx.fillStyle = '#5a2b2b';
    ctx.beginPath();
    ctx.moveTo(L.cx - halfW, y - 6);
    ctx.quadraticCurveTo(L.cx, y + depth, L.cx + halfW, y - 6);
    ctx.quadraticCurveTo(L.cx, y - 26, L.cx - halfW, y - 6);
    ctx.closePath();
    ctx.fill();

    // Dientes de arriba.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(L.cx - halfW, y - 6);
    ctx.quadraticCurveTo(L.cx, y + depth, L.cx + halfW, y - 6);
    ctx.quadraticCurveTo(L.cx, y - 26, L.cx - halfW, y - 6);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = '#fbf7f2';
    ctx.fillRect(L.cx - halfW, y - 14, halfW * 2, depth * 0.52);
    // Separaciones.
    ctx.strokeStyle = 'rgba(120, 96, 90, 0.35)';
    ctx.lineWidth = 3;
    for (let i = -2; i <= 2; i++) {
      const x = L.cx + i * (halfW * 0.34);
      ctx.beginPath();
      ctx.moveTo(x, y - 14);
      ctx.lineTo(x, y + depth * 0.4);
      ctx.stroke();
    }
    if (a.expression === 'dientito') {
      // El hueco del diente que se le cayó: angosto, corto y apenas corrido del
      // centro. Centrado y ancho no se lee como un diente menos sino como dos
      // colmillos.
      ctx.fillStyle = '#5a2b2b';
      ctx.fillRect(L.cx + 6, y - 14, 22, 26);
    }
    // Lengua, al fondo.
    ctx.fillStyle = '#c4626a';
    ctx.beginPath();
    ctx.ellipse(L.cx, y + depth * 0.62, halfW * 0.52, depth * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Labios alrededor.
    ctx.strokeStyle = shade(lips, -0.25);
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(L.cx - halfW, y - 6);
    ctx.quadraticCurveTo(L.cx, y + depth, L.cx + halfW, y - 6);
    ctx.stroke();
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(L.cx - halfW, y - 6);
    ctx.quadraticCurveTo(L.cx, y - 26, L.cx + halfW, y - 6);
    ctx.stroke();
    return;
  }

  // Boca cerrada: dos labios llenos y la línea que los separa.
  const halfW = a.expression === 'segura' ? 66 : 62;
  const curve = a.expression === 'sonrisa' ? 20 : a.expression === 'pilla' ? 14 : 4;

  // Labio superior, con el arco de Cupido.
  ctx.fillStyle = shade(lips, -0.12);
  ctx.beginPath();
  ctx.moveTo(L.cx - halfW, y);
  ctx.quadraticCurveTo(L.cx - halfW * 0.5, y - 20, L.cx - 9, y - 9);
  ctx.quadraticCurveTo(L.cx, y - 17, L.cx + 9, y - 9);
  ctx.quadraticCurveTo(L.cx + halfW * 0.5, y - 20, L.cx + halfW, y);
  ctx.quadraticCurveTo(L.cx, y + 8 - curve * 0.2, L.cx - halfW, y);
  ctx.closePath();
  ctx.fill();

  // Labio inferior, más lleno y más claro.
  ctx.fillStyle = hex(lips);
  ctx.beginPath();
  ctx.moveTo(L.cx - halfW, y);
  ctx.quadraticCurveTo(L.cx, y + 10 - curve * 0.2, L.cx + halfW, y);
  ctx.quadraticCurveTo(L.cx, y + 34 + curve, L.cx - halfW, y);
  ctx.closePath();
  ctx.fill();

  // Brillo del labio inferior.
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.beginPath();
  ctx.ellipse(L.cx + 6, y + 15 + curve * 0.3, halfW * 0.3, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  // Línea entre labios: la sonrisa vive acá.
  ctx.strokeStyle = ink;
  ctx.lineWidth = 5;
  ctx.beginPath();
  if (a.expression === 'pilla') {
    // Media sonrisa: un lado sube más que el otro.
    ctx.moveTo(L.cx - halfW, y + 8);
    ctx.quadraticCurveTo(L.cx, y + 16, L.cx + halfW, y - 10);
  } else {
    ctx.moveTo(L.cx - halfW, y);
    ctx.quadraticCurveTo(L.cx, y + 6 + curve, L.cx + halfW, y);
  }
  ctx.stroke();

  // Hoyuelos en las comisuras cuando sonríe.
  if (curve > 10) {
    ctx.strokeStyle = 'rgba(120, 76, 60, 0.45)';
    ctx.lineWidth = 4;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(L.cx + side * (halfW + 6), y - 4);
      ctx.quadraticCurveTo(L.cx + side * (halfW + 16), y + 6, L.cx + side * (halfW + 8), y + 18);
      ctx.stroke();
    }
  }
}

/** Bigote, candado o perilla, dibujados con pelitos cortos. */
function drawFacialHair(ctx: CanvasRenderingContext2D, a: CharacterAppearance, L: Layout): void {
  const kind: FacialHair = a.facialHair ?? 'ninguno';
  if (kind === 'ninguno') return;

  const color = shade(a.hair, -0.05);
  const y = L.mouthY;

  const strokes = (cx: number, cy: number, halfW: number, halfH: number, count: number) => {
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1 || 1);
      const x = cx - halfW + halfW * 2 * t;
      const h = halfH * (1 - Math.abs(t - 0.5) * 0.9);
      ctx.strokeStyle = color;
      ctx.lineWidth = 3.4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, cy - h);
      ctx.lineTo(x + (t - 0.5) * 14, cy + h);
      ctx.stroke();
    }
  };

  if (kind === 'bigote' || kind === 'candado') {
    // Bigote fino, justo sobre el labio, con el hueco del filtro en el medio.
    for (const side of [-1, 1]) {
      strokes(L.cx + side * 34, y - 26, 26, 10, 12);
    }
  }

  if (kind === 'candado' || kind === 'perilla') {
    // Mosca bajo el labio: chica y centrada.
    strokes(L.cx, y + 52, 15, 13, 9);
  }

  if (kind === 'perilla') {
    // La perilla además rodea el mentón.
    strokes(L.cx, y + 80, 44, 14, 20);
  }

  if (kind === 'candado') {
    // Sombra de barba apenas insinuada en el mentón y la mandíbula.
    ctx.fillStyle = `${shade(a.hair, -0.1).replace('rgb', 'rgba').replace(')', ', 0.16)')}`;
    ctx.beginPath();
    ctx.ellipse(L.cx, y + 58, 96, 56, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawFreckles(ctx: CanvasRenderingContext2D, a: CharacterAppearance, L: Layout): void {
  ctx.fillStyle = `${shade(a.skin, -0.35).replace('rgb', 'rgba').replace(')', ', 0.5)')}`;
  // Sin azar: el mismo personaje tiene siempre las mismas pecas.
  for (let i = 0; i < 18; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const t = (i * 0.137) % 1;
    const x = L.cx + side * (40 + t * 96);
    const y = L.noseY - 26 + ((i * 53) % 44);
    ctx.beginPath();
    ctx.arc(x, y, 2.6 + ((i * 7) % 3) * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Geometría de la cara: un casquete esférico, no un plano.
 *
 * Un plano tangente a la cabeza pelea por el mismo Z que la esfera y deja un
 * recuadro visible sobre el rostro; adelantarlo lo despega de costado. El
 * casquete sigue la curvatura de la cabeza y, al ir apenas por fuera del
 * cráneo, nunca se interpenetra. El mapeo UV de la esfera lleva la textura
 * derecha, sin espejar.
 */
/**
 * Cuánto de la cabeza ocupa la cara.
 *
 * Esto era lo que más arruinaba el resultado y no se notaba mirando texturas: el
 * casquete cubría 86° de ancho y 79° de alto, o sea un óvalo chico en el medio
 * de un cráneo grande, y por más que la foto estuviera perfecta lo que se veía
 * era un ojo de buey con una cara adentro y una cabeza pelada alrededor.
 *
 * Una cara real no termina donde termina el mentón: la mejilla sigue doblando
 * hasta la oreja y la frente hasta la coronilla. Así que el casquete tiene que
 * dar la vuelta hasta las orejas (137°) y bajar hasta debajo del mentón. Lo que
 * queda fuera del rostro en la textura no es relleno: es esa parte de la
 * cabeza, y por eso se rellena estirando la piel del borde y no con un color.
 */
export const FACE_THETA_START = Math.PI * 0.17;
export const FACE_THETA_LENGTH = Math.PI * 0.59;
const FACE_PHI_SPAN = 2.4;

/**
 * Convierte una esfera en una cabeza.
 *
 * Una esfera escalada —que es lo que había— no es una cabeza por más que se la
 * achate: en una esfera el ancho de la mandíbula es el mismo que el de la
 * frente, y esa sola cosa alcanza para que una cabeza se lea como un muñeco. En
 * una cabeza de verdad pasan cuatro cosas, y son las cuatro que hace esto:
 *
 * 1. la mandíbula se afina hacia abajo, bastante más en ancho que en fondo;
 * 2. la nuca es plana, no redonda —el cráneo crece hacia atrás y arriba, no
 *    hacia atrás y abajo—;
 * 3. el mentón sale hacia adelante en vez de seguir la curva de la esfera;
 * 4. el cráneo es un poco más alto que ancho.
 *
 * Va como deformación de vértices y no como escalado del objeto porque el
 * cráneo y el casquete de la cara TIENEN que deformarse igual. Si el casquete
 * se escalara por separado, los dos dejarían de ser concéntricos y la foto se
 * hundiría en la cabeza de un lado y flotaría del otro; así los dos salen de
 * esta misma función y se apoyan uno sobre el otro en todos los ángulos.
 */
export function shapeHead(geo: THREE.BufferGeometry, radius: number): THREE.BufferGeometry {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);

    const t = y / radius; // -1 abajo, +1 arriba

    // 1. Mandíbula. El ancho se cierra más rápido que el fondo: una cabeza vista
    //    de frente se afina mucho, vista de costado casi nada.
    if (t < 0) {
      const d = Math.min(1, -t);
      x *= 1 - 0.30 * Math.pow(d, 1.5);
      z *= 1 - 0.16 * Math.pow(d, 1.5);
    } else {
      // Arriba, apenas más angosto en la coronilla.
      x *= 1 - 0.05 * Math.pow(t, 3);
    }

    // 2. Nuca plana.
    if (z < 0) z *= 0.88;

    // 3. Mentón hacia adelante: sólo en el frente y sólo en el tercio de abajo.
    if (z > 0 && t < -0.25) {
      const d = Math.min(1, (-t - 0.25) / 0.75);
      z += radius * 0.10 * Math.pow(d, 1.4) * (z / radius);
    }

    // 4. Un poco más alta que ancha.
    y *= 1.06;

    pos.setXYZ(i, x, y, z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

export function buildFaceGeometry(headRadius: number): THREE.BufferGeometry {
  // El casquete va apenas por fuera del cráneo para no interpenetrarlo, y se
  // deforma con la MISMA función, así que sigue la mandíbula y el mentón en vez
  // de quedar como una calcomanía plana sobre una pelota.
  return shapeHead(
    new THREE.SphereGeometry(
      headRadius * 1.012,
      28,
      22,
      Math.PI / 2 - FACE_PHI_SPAN / 2,
      FACE_PHI_SPAN,
      FACE_THETA_START,
      FACE_THETA_LENGTH,
    ),
    headRadius,
  );
}

/**
 * Cuello. Sin él la cabeza se apoya directamente sobre el torso y se lee como
 * una pelota puesta encima, que es media distancia de lo que hacía ver los
 * personajes como muñecos de peluche.
 */
export function buildNeck(a: CharacterAppearance, headRadius = 0.42): THREE.Mesh {
  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(headRadius * 0.40, headRadius * 0.56, headRadius * 0.62, 14, 1, true),
    new THREE.MeshLambertMaterial({ color: shade(a.skin, -0.12), side: THREE.DoubleSide }),
  );
  // Nace dentro del cráneo y baja: así no hay junta visible arriba.
  neck.position.set(0, -headRadius * 0.72, -headRadius * 0.06);
  neck.castShadow = true;
  return neck;
}

/**
 * Recorta la cáscara del pelo por una línea de nacimiento en vez de por un
 * paralelo de la esfera.
 *
 * Los vértices que quedan por debajo de la línea no se borran: se DESLIZAN
 * hasta ella sobre la propia cáscara. Borrarlos dejaría el borde dentado
 * siguiendo la cuadrícula de la esfera. Y subirlos en línea recta —que es lo
 * primero que uno hace— es peor todavía: todos terminan a la misma altura pero
 * conservando su distancia al eje, o sea formando un disco horizontal, y ese
 * disco se ve como la visera de una gorra cruzándole la frente al personaje.
 * Deslizarlos sobre la esfera los deja en la superficie del pelo, y el borde
 * queda donde tiene que estar sin agregar nada.
 *
 * La altura de la línea depende de hacia dónde mira cada punto: arriba en el
 * medio de la frente, bien abajo en las sienes, y abajo del todo atrás, donde
 * de todas formas la tapa la pieza de la nuca.
 */
function hairline(geo: THREE.BufferGeometry, radius: number, shortHair: boolean): THREE.BufferGeometry {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const front = shortHair ? 0.60 : 0.64;   // frente: dónde arranca el pelo
  const temple = shortHair ? 0.12 : 0.02;  // sienes: baja hasta adelante de la oreja
  const back = shortHair ? -0.32 : -0.38;  // nuca: el pelo sigue bastante más abajo
  const v = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const len = v.length() || 1;
    // Hacia dónde mira este punto: +1 de frente, 0 al costado, -1 atrás.
    const facing = v.z / len;
    // Tres alturas y dos tramos: de la sien hacia la frente la línea sube, de la
    // sien hacia la nuca baja. Separarlo en dos es lo que hace que el pelo tape
    // la nuca sin taparle la cara, que con una sola curva no se puede.
    const limit = radius * (facing >= 0
      ? temple + (front - temple) * Math.pow(facing, 0.75)
      : temple + (back - temple) * Math.pow(-facing, 0.9));

    if (v.y < limit) {
      // Mismo meridiano, altura del nacimiento del pelo, y otra vez sobre la
      // cáscara: el radio horizontal se recalcula para que el punto siga a
      // distancia `radius` del centro.
      const ring = Math.sqrt(Math.max(0, radius * radius - limit * limit));
      const flat = Math.hypot(v.x, v.z) || 1;
      pos.setXYZ(i, (v.x / flat) * ring, limit, (v.z / flat) * ring);
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/**
 * Patilla: un parche de pelo que baja por delante de la oreja.
 *
 * Va como trozo de esfera del mismo radio que la cáscara del pelo y no como una
 * caja. Una caja al costado de una cabeza redonda sobresale por el medio y se
 * hunde en las puntas, y lo que se ve desde adelante no es una patilla: es un
 * rectángulo marrón flotando donde debería estar la oreja. El trozo de esfera
 * apoya en toda su superficie y desaparece contra el pelo, que es lo que hace
 * una patilla.
 */
function sideburn(
  shell: number,
  side: number,
  mat: THREE.Material,
  drop: number,
  width: number,
): THREE.Mesh {
  // En la esfera de three.js el frente (+Z) cae en phi = π/2; los costados, en
  // 0 y π. La patilla se corre desde el costado hacia adelante.
  const phiCenter = side < 0 ? 0.30 : Math.PI - 0.30;
  const patch = new THREE.Mesh(
    new THREE.SphereGeometry(
      shell * 1.004,
      8,
      8,
      phiCenter - width / 2,
      width,
      Math.PI * 0.30,
      drop,
    ),
    mat,
  );
  patch.castShadow = true;
  return patch;
}

/** Orejas: dos discos achatados a los costados del cráneo. */
export function buildEars(a: CharacterAppearance, headRadius = 0.42): THREE.Group {
  const group = new THREE.Group();
  group.name = 'ears';
  const mat = new THREE.MeshLambertMaterial({ color: a.skin });
  const inner = new THREE.MeshLambertMaterial({ color: shade(a.skin, -0.28) });
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(headRadius * 0.27, 10, 8), mat);
    ear.scale.set(0.34, 1.15, 0.85);
    ear.position.set(side * headRadius * 0.99, -headRadius * 0.03, -headRadius * 0.06);
    ear.castShadow = true;
    const hole = new THREE.Mesh(new THREE.SphereGeometry(headRadius * 0.14, 8, 6), inner);
    hole.scale.set(0.5, 1.1, 0.8);
    hole.position.x = side * headRadius * 0.08;
    ear.add(hole);
    group.add(ear);
  }
  return group;
}

/**
 * Pelo en 3D. Va como geometría y no como textura para que la silueta del
 * personaje se distinga desde atrás, que es donde está la cámara casi siempre.
 */
export function buildHair(a: CharacterAppearance, headRadius = 0.42): THREE.Group {
  const style = a.hairStyle;
  const volume = a.hairVolume;
  const group = new THREE.Group();
  group.name = 'hair';
  const mat = new THREE.MeshLambertMaterial({
    color: a.hair,
    flatShading: true,
    side: THREE.DoubleSide,
  });
  const highlightMat = new THREE.MeshLambertMaterial({
    color: a.hairHighlight ?? a.hair,
    flatShading: true,
    side: THREE.DoubleSide,
  });

  // El pelo es una cáscara por fuera del cráneo, en dos piezas: una corona que
  // cubre toda la coronilla y una pieza trasera que baja por la nuca y los
  // costados dejando libre el frente. Una sola pieza que bajara hasta las
  // orejas taparía la cara.
  // Los peinados cortos llevan la cáscara casi pegada al cráneo. Con el mismo
  // margen que una melena, un pelo corto se ve como un casco puesto encima.
  // Largo es SÓLO la melena. Antes la lista se hacía al revés —se nombraban los
  // cortos— y quedaban afuera los rulos de Isma y el ondulado de Benja, así que
  // a los dos nenes les colgaba pelo por debajo de los hombros.
  const longHair = style === 'largo' || style === 'mechas';
  const shortHair = !longHair;
  // La cáscara del pelo tiene que quedar claramente por FUERA del casquete de la
  // cara (que va a 1.012). Con 1.015, que es lo que había, quedaban a tres
  // milésimas una de otra: a esa distancia las dos superficies se disputan el
  // mismo píxel y la foto se asoma por encima del pelo. Se veía como un parche
  // de piel en plena coronilla, con el borde dentado, y era lo más feo de la
  // cabeza de Isma.
  const shell = headRadius * (shortHair ? 1.045 : 1.075);
  // Una cáscara perfectamente esférica se lee como una gorra. Para el pelo
  // ondulado y la melena le ondulamos la silueta desplazando los vértices, que
  // sale mucho más natural que pegarle bultos encima.
  const wavy = style === 'ondulado' ? 0.11 : style === 'largo' || style === 'mechas' ? 0.06 : 0;

  // La corona se corta por una línea de nacimiento de pelo, no por un paralelo.
  // Terminada en un círculo, el pelo cruza la frente con un borde perfectamente
  // horizontal y de lejos parece una boina apoyada; el nacimiento real sube en
  // el medio de la frente y baja por las sienes hacia adelante de las orejas, y
  // esa curva es de las cosas que más dicen "cabeza" y no "muñeco".
  const crownGeo = waveGeometry(
    hairline(
      // La cáscara baja bastante más que el nacimiento del pelo más bajo: lo que
      // sobra lo recorta `hairline`, y le hace falta tener de dónde recortar.
      //
      // Va bien subdividida por una razón concreta: el recorte mueve cada
      // vértice a la altura que le toca, y si los paralelos están espaciados,
      // entre un vértice ya movido y su vecino todavía sin mover queda un
      // triángulo estirado. En la frente eso no se lee como pelo, se lee como
      // una sierra.
      new THREE.SphereGeometry(shell, 56, 40, 0, Math.PI * 2, 0, Math.PI * 0.64),
      shell,
      shortHair,
    ),
    wavy,
  );
  const crown = new THREE.Mesh(crownGeo, mat);
  crown.scale.y = 1.05;
  crown.castShadow = true;
  group.add(crown);

  // Melena: la parte que cae por debajo del nacimiento del pelo, por la nuca y
  // los costados. Va SÓLO en los peinados largos.
  //
  // Antes iba en todos, y en los cortos era el defecto más feo de la cabeza sin
  // que se entendiera de dónde salía: como es un trozo de esfera cortado en dos
  // meridianos, sus bordes son dos planos verticales, y esos meridianos caían
  // justo a la altura de las orejas. Desde adelante se veían dos rectángulos
  // marrones pegados a los costados de la cabeza, que uno lee como orejas mal
  // hechas. En los cortos ya no hace falta: la corona baja hasta el nacimiento
  // del pelo por toda la vuelta, nuca incluida.
  if (longHair) {
    // La melena va como una cortina con espesor, revolucionada alrededor de la
    // cabeza, y no como un trozo de esfera.
    //
    // Un trozo de esfera es una superficie sin espesor, y sus dos bordes son
    // cortes rectos: desde adelante se ven de canto, como dos tablones planos a
    // los costados de la cara, y encima se les ve la cara interna. Una cortina
    // sí tiene dos caras y un borde con grosor, así que se lee como pelo desde
    // cualquier ángulo. Y como su perfil es una curva, cae pegada arriba y se
    // abre abajo, que es lo que hace el pelo largo.
    const drop = headRadius * (1.5 + 1.0 * volume);
    const profile = [
      // Cara externa, de arriba hacia abajo: nace pegada a la cabeza y se abre.
      new THREE.Vector2(headRadius * 0.96, headRadius * 0.34),
      new THREE.Vector2(headRadius * 1.06, -headRadius * 0.25),
      new THREE.Vector2(headRadius * 1.10, -drop * 0.6),
      new THREE.Vector2(headRadius * 1.02, -drop),
      // Canto de abajo.
      new THREE.Vector2(headRadius * 0.86, -drop),
      // Cara interna, de vuelta hacia arriba.
      new THREE.Vector2(headRadius * 0.90, -drop * 0.6),
      new THREE.Vector2(headRadius * 0.88, -headRadius * 0.25),
      new THREE.Vector2(headRadius * 0.86, headRadius * 0.34),
    ];
    // `LatheGeometry` gira alrededor de Y arrancando en +Z, o sea en la cara:
    // hay que empezar más allá de la sien y dar la vuelta por la nuca.
    const curtain = waveGeometry(
      new THREE.LatheGeometry(profile, 34, Math.PI * 0.42, Math.PI * 1.16),
      wavy * 0.6,
    );
    const mane = new THREE.Mesh(curtain, mat);
    mane.castShadow = true;
    group.add(mane);

    // Y adelante, un mechón a cada lado enmarcando la cara. Con mechas van del
    // color claro: es exactamente donde se ven en la foto.
    for (const side of [-1, 1]) {
      const framing = new THREE.Mesh(
        new THREE.CapsuleGeometry(headRadius * 0.21, drop * 0.72, 4, 8),
        style === 'mechas' ? highlightMat : mat,
      );
      framing.position.set(
        side * headRadius * 0.93,
        headRadius * 0.24 - drop * 0.36,
        headRadius * 0.16,
      );
      framing.rotation.z = side * 0.09;
      framing.scale.z = 0.82;
      framing.castShadow = true;
      group.add(framing);
    }
  }

  switch (style) {
    case 'rulos': {
      // Rulos apretados: anillos de bollitos que desbordan la cáscara, que es
      // lo que da la silueta del pelo rizado corto.
      //
      // Los del frente van más arriba que los de atrás: a la misma altura
      // caerían sobre las cejas y los ojos.
      // Rulos cortos, al ras: bollitos chicos repartidos sobre la coronilla. Con
      // rulos grandes y bajos la silueta se comía media cara y el chico dejaba
      // de reconocerse, que es justamente lo que tiene que pasar al revés.
      const curl = new THREE.SphereGeometry(headRadius * 0.17 * volume, 8, 6);
      for (const [count, ring, height] of [
        [10, 0.86, 0.74],
        [7, 0.58, 1.0],
        [3, 0.2, 1.12],
      ] as const) {
        for (let i = 0; i < count; i++) {
          const angle = (i / count) * Math.PI * 2 + ring;
          // Los del frente suben todavía más: a la misma altura caerían sobre
          // las cejas.
          const frontness = Math.max(0, Math.sin(angle));
          const m = new THREE.Mesh(curl, mat);
          m.position.set(
            Math.cos(angle) * headRadius * ring,
            headRadius * (height + frontness * 0.3),
            Math.sin(angle) * headRadius * ring * 0.86,
          );
          group.add(m);
        }
      }
      break;
    }
    case 'corto': {
      // Patillas: bajan por delante de la oreja desde el nacimiento del pelo.
      for (const side of [-1, 1]) group.add(sideburn(shell, side, mat, 0.34, 0.30));
      break;
    }
    case 'puas': {
      // Pelo corto en los costados y levantado en púas arriba, peinado hacia
      // atrás. Las púas nacen detrás de la línea de la frente para no caer
      // sobre la cara.
      for (const side of [-1, 1]) group.add(sideburn(shell, side, mat, 0.40, 0.34));
      const spikeGeo = new THREE.ConeGeometry(headRadius * 0.16, headRadius * 0.62 * volume, 5);
      for (const [count, ring, lean] of [
        [5, 0.34, 0.3],
        [4, 0.66, 0.55],
      ] as const) {
        for (let i = 0; i < count; i++) {
          const angle = -0.6 + (i / Math.max(1, count - 1)) * 1.2;
          const spike = new THREE.Mesh(spikeGeo, mat);
          spike.position.set(
            Math.sin(angle) * headRadius * 0.72,
            headRadius * (1.02 - ring * 0.12),
            Math.cos(angle) * headRadius * (0.5 - ring * 0.7),
          );
          // Inclinadas hacia atrás: es el peinado, no una cresta.
          spike.rotation.x = -0.35 - lean * 0.4;
          spike.rotation.z = -Math.sin(angle) * 0.35;
          spike.castShadow = true;
          group.add(spike);
        }
      }
      break;
    }
    case 'ondulado': {
      // Encima de la cáscara ondulada, un mechón barrido hacia un costado: es
      // lo que da la raya al lado y rompe la simetría del casquete.
      // Mechón barrido al costado, apoyado sobre la coronilla: da la raya al
      // lado sin agregar volumen, que es lo que hace parecer largo un pelo que
      // no lo es.
      const sweep = new THREE.Mesh(new THREE.SphereGeometry(headRadius * 0.36, 12, 9), mat);
      sweep.scale.set(1.45 * volume, 0.45, 0.95);
      sweep.position.set(headRadius * 0.26, headRadius * 0.9, headRadius * 0.24);
      sweep.rotation.z = -0.34;
      sweep.castShadow = true;
      group.add(sweep);

      const tuft = new THREE.Mesh(new THREE.SphereGeometry(headRadius * 0.22, 10, 8), mat);
      tuft.scale.set(1.1, 0.6, 0.9);
      tuft.position.set(-headRadius * 0.46, headRadius * 0.95, headRadius * 0.08);
      tuft.rotation.z = 0.45;
      group.add(tuft);
      break;
    }
    case 'mechas':
    case 'largo': {
      // Melena: mechones laterales largos, cortina por delante de los hombros y
      // masa por detrás. El largo lo gobierna `hairVolume`.
      const strand = new THREE.CapsuleGeometry(
        headRadius * 0.36,
        headRadius * 1.6 * volume,
        4,
        8,
      );
      for (const side of [-1, 1]) {
        // Con mechas, los mechones que enmarcan la cara van del color claro:
        // es exactamente donde se ven en la foto.
        const m = new THREE.Mesh(strand, style === 'mechas' ? highlightMat : mat);
        m.position.set(
          side * headRadius * 0.86,
          -headRadius * (0.5 + 0.35 * volume),
          -headRadius * 0.1,
        );
        m.rotation.z = side * 0.1;
        m.castShadow = true;
        group.add(m);
      }
      const bulk = new THREE.Mesh(
        new THREE.CapsuleGeometry(headRadius * 0.62, headRadius * 1.5 * volume, 4, 10),
        mat,
      );
      bulk.position.set(0, -headRadius * (0.4 + 0.3 * volume), -headRadius * 0.55);
      bulk.scale.z = 0.72;
      bulk.castShadow = true;
      group.add(bulk);

      if (style === 'mechas') {
        // Un par de mechas claras sobre la coronilla, hacia atrás.
        for (const side of [-1, 1]) {
          const streak = new THREE.Mesh(
            new THREE.CapsuleGeometry(headRadius * 0.11, headRadius * 0.9, 3, 6),
            highlightMat,
          );
          streak.position.set(side * headRadius * 0.42, headRadius * 0.62, -headRadius * 0.5);
          streak.rotation.set(0.5, 0, side * 0.3);
          group.add(streak);
        }
      }
      break;
    }
  }

  // Flequillo recto sobre la frente.
  if (a.fringe) {
    // Fino y apoyado en el nacimiento del pelo: una tabla gruesa sobre la
    // frente se lee como una visera, no como un flequillo.
    const fringe = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.08, 0.24), mat);
    fringe.position.set(0, headRadius * 0.83, headRadius * 0.3);
    fringe.rotation.x = -0.2;
    group.add(fringe);
  }

  return group;
}

/**
 * Retrato del personaje para las tarjetas del menú.
 *
 * No es la cabeza del modelo 3D fotografiada, sino un busto dibujado en 2D con
 * los mismos parámetros: cuello y hombros con la ropa, orejas, pelo con su
 * silueta y las mismas facciones. Así la tarjeta se ve como un retrato y no como
 * una captura del juego, y sigue siendo inconfundiblemente el mismo personaje.
 */
export function makeAvatarDataUrl(a: CharacterAppearance): string {
  const P = 512;
  const [c, ctx] = canvas(P, P);
  const cx = P / 2;
  const cy = P / 2 + 14;
  const r = 168 * (a.faceWidth ?? 1);
  const ry = r * (a.adult ? 1.12 : 1.05);

  // Fondo: un halo suave del color de la remera, para que el retrato no flote.
  const bg = ctx.createRadialGradient(cx, cy - 40, 40, cx, cy, P * 0.62);
  bg.addColorStop(0, mix(a.shirtAccent, 0xffffff, 0.55));
  bg.addColorStop(1, mix(a.shirt, 0x101820, 0.7));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, P, P);

  // Melena por detrás de la cabeza.
  if (a.hairStyle === 'largo' || a.hairStyle === 'mechas') {
    ctx.fillStyle = hex(a.hair);
    ctx.beginPath();
    ctx.ellipse(cx, cy + 56 * a.hairVolume, r * 1.34, ry * 1.5 * a.hairVolume, 0, 0, Math.PI * 2);
    ctx.fill();
    if (a.hairHighlight !== undefined) {
      ctx.fillStyle = hex(a.hairHighlight);
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(
          cx + side * r * 0.98,
          cy + 60 * a.hairVolume,
          r * 0.3,
          ry * 1.1 * a.hairVolume,
          side * 0.08,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
  }

  // Hombros y ropa.
  drawBust(ctx, a, cx, cy, r);

  // Cuello.
  ctx.fillStyle = shade(a.skin, -0.2);
  ctx.fillRect(cx - r * 0.34, cy + ry * 0.55, r * 0.68, ry * 0.62);

  // Orejas.
  ctx.fillStyle = shade(a.skin, -0.08);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + side * r * 0.97, cy + ry * 0.06, r * 0.14, ry * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Cabeza, con degradado para que tenga volumen.
  const skin = ctx.createRadialGradient(cx - r * 0.3, cy - ry * 0.4, r * 0.15, cx, cy, r * 1.25);
  skin.addColorStop(0, shade(a.skin, 0.18));
  skin.addColorStop(0.6, hex(a.skin));
  skin.addColorStop(1, shade(a.skin, -0.26));
  ctx.fillStyle = skin;
  ctx.beginPath();
  // Mentón: redondo en los chicos, más marcado en los adultos.
  if (a.adult) {
    ctx.moveTo(cx - r, cy - ry * 0.2);
    ctx.quadraticCurveTo(cx - r, cy - ry * 1.15, cx, cy - ry * 1.15);
    ctx.quadraticCurveTo(cx + r, cy - ry * 1.15, cx + r, cy - ry * 0.2);
    ctx.quadraticCurveTo(cx + r * 0.9, cy + ry * 0.72, cx, cy + ry * 0.95);
    ctx.quadraticCurveTo(cx - r * 0.9, cy + ry * 0.72, cx - r, cy - ry * 0.2);
  } else {
    ctx.ellipse(cx, cy, r, ry, 0, 0, Math.PI * 2);
  }
  ctx.closePath();
  ctx.fill();

  // Pelo por delante: casquete y, según el estilo, los agregados.
  drawPortraitHair(ctx, a, cx, cy, r, ry);

  // Rasgos: exactamente el mismo dibujo que lleva el piloto en pista.
  const face = makeFaceCanvas(a);
  ctx.drawImage(face, cx - r * 1.05, cy - ry * 0.95, r * 2.1, r * 2.1);

  return c.toDataURL('image/png');
}

/** Hombros con la ropa del personaje. */
function drawBust(
  ctx: CanvasRenderingContext2D,
  a: CharacterAppearance,
  cx: number,
  cy: number,
  r: number,
): void {
  const top = cy + r * 0.95;
  ctx.fillStyle = hex(a.shirt);
  ctx.beginPath();
  ctx.moveTo(cx - r * 2.1, cy + r * 2.2);
  ctx.quadraticCurveTo(cx - r * 1.1, top, cx, top);
  ctx.quadraticCurveTo(cx + r * 1.1, top, cx + r * 2.1, cy + r * 2.2);
  ctx.closePath();
  ctx.fill();

  switch (a.shirtPattern) {
    case 'rayas': {
      ctx.save();
      ctx.clip();
      ctx.fillStyle = hex(a.shirtAccent);
      for (let x = cx - r * 2.1; x < cx + r * 2.1; x += r * 0.42) {
        ctx.fillRect(x, top - 10, r * 0.21, r * 2);
      }
      ctx.restore();
      break;
    }
    case 'camisa': {
      // Cuello de camisa abierto: dos solapas y la sombra del escote.
      ctx.fillStyle = shade(a.shirt, -0.12);
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + side * r * 0.14, top);
        ctx.lineTo(cx + side * r * 0.95, top + r * 0.18);
        ctx.lineTo(cx + side * r * 0.3, top + r * 0.78);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = shade(a.skin, -0.12);
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.3, top);
      ctx.lineTo(cx + r * 0.3, top);
      ctx.lineTo(cx, top + r * 0.75);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'musculosa': {
      // Breteles finos y escote: queda el hombro a la vista.
      ctx.fillStyle = shade(a.skin, -0.06);
      ctx.beginPath();
      ctx.moveTo(cx - r * 2.1, cy + r * 2.2);
      ctx.quadraticCurveTo(cx - r * 1.1, top, cx, top);
      ctx.quadraticCurveTo(cx + r * 1.1, top, cx + r * 2.1, cy + r * 2.2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = hex(a.shirt);
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.95, cy + r * 2.2);
      ctx.lineTo(cx - r * 0.62, top + r * 0.1);
      ctx.lineTo(cx, top + r * 0.62);
      ctx.lineTo(cx + r * 0.62, top + r * 0.1);
      ctx.lineTo(cx + r * 0.95, cy + r * 2.2);
      ctx.closePath();
      ctx.fill();
      // Cadenita.
      ctx.strokeStyle = '#e8c86a';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.42, top + r * 0.12);
      ctx.quadraticCurveTo(cx, top + r * 0.72, cx + r * 0.42, top + r * 0.12);
      ctx.stroke();
      break;
    }
    case 'capucha': {
      ctx.fillStyle = hex(a.shirtAccent);
      ctx.beginPath();
      ctx.ellipse(cx, top + r * 0.2, r * 1.15, r * 0.42, 0, 0, Math.PI);
      ctx.fill();
      break;
    }
    default: {
      ctx.fillStyle = hex(a.shirtAccent);
      ctx.fillRect(cx - r * 2.1, top + r * 0.62, r * 4.2, r * 0.22);
      break;
    }
  }
}

/** Pelo del retrato: la silueta cambia bastante según el estilo. */
function drawPortraitHair(
  ctx: CanvasRenderingContext2D,
  a: CharacterAppearance,
  cx: number,
  cy: number,
  r: number,
  ry: number,
): void {
  ctx.fillStyle = hex(a.hair);

  // Casquete base sobre la frente. En el adulto nace un poco más atrás.
  const capY = cy - ry * (a.adult ? 0.42 : 0.36);
  ctx.beginPath();
  ctx.ellipse(cx, capY, r * 1.04, ry * 0.7, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(cx - r * 1.04, capY - 4, r * 2.08, ry * 0.18);

  switch (a.hairStyle) {
    case 'rulos': {
      for (const [count, ring, lift] of [
        [11, 1.02, 0.3],
        [7, 0.72, 0.62],
      ] as const) {
        for (let i = 0; i < count; i++) {
          const angle = Math.PI * 1.04 + (i / (count - 1)) * Math.PI * 0.92;
          ctx.beginPath();
          ctx.arc(
            cx + Math.cos(angle) * r * ring,
            cy - r * lift + Math.sin(angle) * r * 0.6,
            44 * a.hairVolume,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
      }
      break;
    }
    case 'puas': {
      // Costados rapados y púas sobre la coronilla, hacia arriba y atrás.
      ctx.fillStyle = shade(a.hair, -0.08);
      ctx.beginPath();
      ctx.ellipse(cx, capY + ry * 0.1, r * 1.02, ry * 0.5, 0, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hex(a.hair);
      for (let i = 0; i < 9; i++) {
        const t = i / 8;
        const x = cx + (t - 0.5) * r * 1.75;
        const base = capY - ry * 0.2 + Math.abs(t - 0.5) * ry * 0.4;
        const h = (48 + Math.sin(i * 2.1) * 16) * a.hairVolume;
        ctx.beginPath();
        ctx.moveTo(x - 20, base + 12);
        ctx.lineTo(x + (t - 0.5) * 46, base - h);
        ctx.lineTo(x + 20, base + 12);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'ondulado': {
      ctx.beginPath();
      ctx.ellipse(cx + r * 0.38, cy - r * 0.5, r * 0.64, r * 0.32, -0.38, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx - r * 0.55, cy - r * 0.44, r * 0.35, r * 0.24, 0.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'mechas': {
      // Raíz oscura arriba y las mechas claras enmarcando la cara.
      ctx.fillStyle = hex(a.hairHighlight ?? a.hair);
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + side * r * 0.2, capY - ry * 0.3);
        ctx.quadraticCurveTo(
          cx + side * r * 1.12,
          cy - ry * 0.3,
          cx + side * r * 0.96,
          cy + ry * 0.85,
        );
        ctx.quadraticCurveTo(cx + side * r * 1.3, cy - ry * 0.2, cx + side * r * 0.48, capY - ry * 0.34);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = hex(a.hair);
      ctx.beginPath();
      ctx.ellipse(cx, capY - ry * 0.1, r * 0.82, ry * 0.42, 0, Math.PI, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'largo': {
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(
          cx + side * r * 0.98,
          cy + ry * 0.4,
          r * 0.3,
          ry * 0.95 * a.hairVolume,
          side * 0.1,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      break;
    }
  }

  if (a.fringe) {
    ctx.fillStyle = hex(a.hair);
    ctx.beginPath();
    ctx.ellipse(cx, cy - ry * 0.48, r * 0.92, ry * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Ondula la silueta de una cáscara de pelo desplazando sus vértices en radio
 * según el ángulo. `amount` 0 la deja intacta.
 */
function waveGeometry(geo: THREE.BufferGeometry, amount: number): THREE.BufferGeometry {
  if (amount <= 0) return geo;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const angle = Math.atan2(v.z, v.x);
    const k =
      1 + amount * Math.sin(angle * 3 + 1.1) + amount * 0.55 * Math.sin(angle * 5 - 0.4);
    v.x *= k;
    v.z *= k;
    v.y *= 1 + (k - 1) * 0.35;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/**
 * Camiseta a rayas verticales. La geometría de la cápsula envuelve la textura
 * alrededor del torso, así que basta con rayas a lo ancho del canvas.
 */
export function makeStripedShirtTexture(a: CharacterAppearance): THREE.Texture {
  const W = 256;
  const H = 64;
  const [c, ctx] = canvas(W, H);
  ctx.fillStyle = hex(a.shirt);
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = hex(a.shirtAccent);
  for (let x = 0; x < W; x += 42) ctx.fillRect(x, 0, 21, H);
  const tex = toTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/**
 * Panel con el número del kart. Se dibuja como una chapa con el número
 * centrado, y opcionalmente rayas verticales de color.
 */
export function makeNumberTexture(livery: KartLivery): THREE.Texture {
  const W = 256;
  const H = 192;
  const [c, ctx] = canvas(W, H);

  ctx.fillStyle = hex(livery.numberPanel);
  ctx.fillRect(0, 0, W, H);

  if (livery.numberStripes !== null) {
    ctx.fillStyle = hex(livery.numberStripes);
    // Rayas anchas, alineadas para que el número quede sobre el blanco.
    for (const x of [16, 76, 164, 224]) ctx.fillRect(x, 0, 24, H);
  }

  // Borde.
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, W - 8, H - 8);

  ctx.fillStyle = hex(livery.numberInk);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const size = livery.number.length > 1 ? 132 : 158;
  ctx.font = `900 ${size}px Impact, "Arial Black", system-ui, sans-serif`;
  ctx.fillText(livery.number, W / 2, H / 2 + 6);

  return toTexture(c);
}

export { shade as shadeColor };

/** Sombra de barba en 3D: un tono más oscuro sobre el mentón del adulto. */
export function skinShade(color: number, amount: number): string {
  return shade(color, amount);
}
