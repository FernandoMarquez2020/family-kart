import * as THREE from 'three';
import type { ThemePalette } from './themes';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('No se pudo crear el contexto 2D para las texturas');
  return [c, ctx];
}

function finish(c: HTMLCanvasElement): THREE.Texture {
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Asfalto con líneas de borde y, según el tema, línea central discontinua. */
export function makeRoadTexture(p: ThemePalette): THREE.Texture {
  const W = 256;
  const H = 256;
  const [c, ctx] = canvas(W, H);

  ctx.fillStyle = p.road;
  ctx.fillRect(0, 0, W, H);

  // Grano: ruido sutil para que el piso no se vea plano.
  ctx.fillStyle = p.roadSpeckle;
  ctx.globalAlpha = 0.35;
  for (let i = 0; i < 4000; i++) {
    ctx.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = p.edgeLine;
  ctx.fillRect(6, 0, 5, H);
  ctx.fillRect(W - 11, 0, 5, H);

  if (p.centerDashed) {
    ctx.fillStyle = p.centerLine;
    for (let y = 0; y < H; y += 64) ctx.fillRect(W / 2 - 3, y, 6, 34);
  }

  return finish(c);
}

/** Piano de dos colores para los bordes de la pista. */
export function makeCurbTexture(p: ThemePalette): THREE.Texture {
  const [c, ctx] = canvas(64, 64);
  ctx.fillStyle = p.curbB;
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = p.curbA;
  ctx.fillRect(0, 0, 64, 32);
  return finish(c);
}

/** Damero de largada / meta. */
export function makeFinishTexture(): THREE.Texture {
  const [c, ctx] = canvas(128, 128);
  const cell = 16;
  for (let y = 0; y < 128 / cell; y++) {
    for (let x = 0; x < 128 / cell; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#f8f8f8' : '#14171d';
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  return finish(c);
}

/**
 * Pelota de fútbol: blanca con parches oscuros.
 *
 * Sin esto las esferas blancas del estadio se leen como pelotas de golf, que
 * era justamente el problema.
 */
export function makeBallTexture(): THREE.Texture {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  ctx.fillStyle = '#f6f6f6';
  ctx.fillRect(0, 0, S, S);

  // Parches: pentágonos repartidos en dos filas, más un par de recortes en los
  // bordes para que al envolver la esfera no queden zonas blancas grandes.
  ctx.fillStyle = '#1b1f27';
  const pentagon = (cx: number, cy: number, r: number, rot = 0) => {
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = rot + (i / 5) * Math.PI * 2 - Math.PI / 2;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  };

  for (const [x, y, r, rot] of [
    [40, 70, 26, 0],
    [128, 52, 24, 0.6],
    [216, 74, 26, 0.2],
    [84, 150, 27, Math.PI],
    [172, 148, 27, Math.PI * 0.8],
    [20, 216, 24, 0.4],
    [128, 226, 25, Math.PI],
    [236, 214, 24, 0.9],
  ] as const) {
    pentagon(x, y, r, rot);
  }

  return finish(c);
}

/** Red del arco: rejilla blanca sobre fondo transparente. */
export function makeNetTexture(): THREE.Texture {
  const S = 128;
  const [c, ctx] = canvas(S, S);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 3;
  for (let i = 0; i <= S; i += 16) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, S);
    ctx.moveTo(0, i);
    ctx.lineTo(S, i);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Frente de tribuna: filas de butacas de colores. */
export function makeStandTexture(colors: number[]): THREE.Texture {
  const W = 128;
  const H = 64;
  const [c, ctx] = canvas(W, H);
  ctx.fillStyle = '#20242c';
  ctx.fillRect(0, 0, W, H);

  // Bloques de hinchada: cada fila alterna colores, con huecos oscuros que
  // leen como gente y no como una pared lisa.
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 16; col++) {
      if ((row * 7 + col * 3) % 5 === 0) continue;
      const hexColor = colors[(row + col) % colors.length];
      ctx.fillStyle = `#${hexColor.toString(16).padStart(6, '0')}`;
      ctx.fillRect(col * 8 + 1, row * 8 + 1, 6, 6);
    }
  }
  return finish(c);
}

/**
 * Muro perimetral, distinto por tema: vallas publicitarias en el estadio,
 * guardarraíl luminoso en el circuito neón, cerco de cubos en el mundo de
 * bloques y cerco a rayas en el mundo rosa.
 */
export function makeWallTexture(p: ThemePalette): THREE.Texture {
  const W = 256;
  const H = 64;
  const [c, ctx] = canvas(W, H);
  const colors = p.sceneryColors.map((v) => `#${v.toString(16).padStart(6, '0')}`);

  switch (p.scenery) {
    case 'estadio': {
      // Paneles de colores separados por franjas blancas, como las vallas que
      // rodean una cancha. Sin texto: no imitamos marcas de nadie.
      ctx.fillStyle = '#20242c';
      ctx.fillRect(0, 0, W, H);
      const panel = 64;
      for (let i = 0; i < W / panel; i++) {
        ctx.fillStyle = colors[i % colors.length];
        ctx.fillRect(i * panel + 3, 6, panel - 6, H - 12);
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillRect(i * panel + 3, H - 14, panel - 6, 5);
      }
      break;
    }
    case 'neon': {
      ctx.fillStyle = '#10131f';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = p.edgeLine;
      ctx.fillRect(0, 10, W, 5);
      ctx.fillRect(0, H - 18, W, 5);
      ctx.fillStyle = p.centerLine;
      for (let x = 0; x < W; x += 48) ctx.fillRect(x, 24, 22, 14);
      break;
    }
    case 'bloques': {
      const cell = 32;
      for (let y = 0; y < H / cell; y++) {
        for (let x = 0; x < W / cell; x++) {
          ctx.fillStyle = colors[(x + y * 3) % colors.length];
          ctx.fillRect(x * cell + 1, y * cell + 1, cell - 2, cell - 2);
        }
      }
      break;
    }
    // Muelle: chapa corrugada con la franja de seguridad amarilla y negra.
    case 'puerto': {
      ctx.fillStyle = '#7d838c';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      for (let x = 0; x < W; x += 12) ctx.fillRect(x, 0, 5, H);
      ctx.fillStyle = '#20242c';
      ctx.fillRect(0, H - 22, W, 22);
      ctx.fillStyle = '#ffd23d';
      for (let x = -H; x < W; x += 44) {
        ctx.beginPath();
        ctx.moveTo(x, H);
        ctx.lineTo(x + 22, H);
        ctx.lineTo(x + 22 + 22, H - 22);
        ctx.lineTo(x + 22, H - 22);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    // Costanera: baranda blanca sobre un zócalo turquesa.
    case 'miami': {
      ctx.fillStyle = '#2fd6d0';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#fff6ea';
      ctx.fillRect(0, 0, W, 12);
      ctx.fillRect(0, H - 14, W, 14);
      for (let x = 0; x < W; x += 24) ctx.fillRect(x, 12, 9, H - 26);
      ctx.fillStyle = 'rgba(255,95,168,0.55)';
      ctx.fillRect(0, H - 22, W, 6);
      break;
    }
    case 'dulce': {
      ctx.fillStyle = '#fff4fa';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = p.curbB;
      for (let x = -H; x < W; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, H);
        ctx.lineTo(x + 20, H);
        ctx.lineTo(x + 20 + H, 0);
        ctx.lineTo(x + H, 0);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
  }

  return finish(c);
}

/** Suelo de los costados. El patrón lo define el tema. */
export function makeGroundTexture(p: ThemePalette): THREE.Texture {
  const W = 128;
  const [c, ctx] = canvas(W, W);
  ctx.fillStyle = p.ground;
  ctx.fillRect(0, 0, W, W);

  switch (p.groundPattern) {
    // Césped: ruido fino.
    case 'cesped': {
      ctx.fillStyle = p.groundAccent;
      ctx.globalAlpha = 0.4;
      for (let i = 0; i < 2500; i++) ctx.fillRect(Math.random() * W, Math.random() * W, 3, 3);
      break;
    }
    // Rayas de cortadora, como una cancha.
    case 'rayas': {
      ctx.fillStyle = p.groundAccent;
      for (let x = 0; x < W; x += 32) ctx.fillRect(x, 0, 16, W);
      ctx.fillStyle = p.ground;
      ctx.globalAlpha = 0.25;
      for (let i = 0; i < 1200; i++) ctx.fillRect(Math.random() * W, Math.random() * W, 3, 3);
      break;
    }
    // Grilla luminosa.
    case 'grilla': {
      ctx.strokeStyle = p.groundAccent;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 2;
      for (let i = 0; i <= W; i += 32) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, W);
        ctx.moveTo(0, i);
        ctx.lineTo(W, i);
        ctx.stroke();
      }
      break;
    }
    // Cuadrícula de bloques con borde marcado.
    case 'bloques': {
      const cell = 32;
      for (let y = 0; y < W / cell; y++) {
        for (let x = 0; x < W / cell; x++) {
          ctx.fillStyle = (x + y) % 2 === 0 ? p.ground : p.groundAccent;
          ctx.fillRect(x * cell, y * cell, cell, cell);
        }
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.lineWidth = 2;
      for (let i = 0; i <= W; i += cell) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, W);
        ctx.moveTo(0, i);
        ctx.lineTo(W, i);
        ctx.stroke();
      }
      break;
    }
    // Losas de hormigón del muelle, con juntas y manchas de aceite.
    case 'hormigon': {
      const cell = 64;
      ctx.strokeStyle = 'rgba(0,0,0,0.22)';
      ctx.lineWidth = 3;
      for (let i = 0; i <= W; i += cell) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, W);
        ctx.moveTo(0, i);
        ctx.lineTo(W, i);
        ctx.stroke();
      }
      ctx.fillStyle = p.groundAccent;
      ctx.globalAlpha = 0.5;
      for (let i = 0; i < 900; i++) ctx.fillRect(Math.random() * W, Math.random() * W, 2, 2);
      ctx.globalAlpha = 0.09;
      ctx.fillStyle = '#000000';
      for (let i = 0; i < 14; i++) {
        ctx.beginPath();
        ctx.ellipse(Math.random() * W, Math.random() * W, 6 + Math.random() * 10, 4 + Math.random() * 7, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    // Arena: grano fino y alguna ondulación del viento.
    case 'arena': {
      ctx.fillStyle = p.groundAccent;
      ctx.globalAlpha = 0.45;
      for (let i = 0; i < 3000; i++) ctx.fillRect(Math.random() * W, Math.random() * W, 2, 2);
      ctx.globalAlpha = 0.18;
      ctx.strokeStyle = '#b89a68';
      ctx.lineWidth = 2;
      for (let y = 6; y < W; y += 17) {
        ctx.beginPath();
        for (let x = 0; x <= W; x += 8) {
          const yy = y + Math.sin((x / W) * Math.PI * 4 + y) * 3;
          if (x === 0) ctx.moveTo(x, yy);
          else ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
      break;
    }
    // Brillitos dispersos.
    case 'brillos': {
      ctx.fillStyle = p.groundAccent;
      for (let i = 0; i < 90; i++) {
        const x = Math.random() * W;
        const y = Math.random() * W;
        const r = 1.5 + Math.random() * 2.5;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
  }

  ctx.globalAlpha = 1;
  return finish(c);
}

/**
 * Agua: bandas de color y destellos.
 *
 * No hace falta simular olas para que se lea como mar; alcanza con romper el
 * color plano, que es lo que delata a una superficie falsa desde lejos.
 */
export function makeWaterTexture(color: number): THREE.Texture {
  const W = 256;
  const [c, ctx] = canvas(W, W);
  const base = `#${color.toString(16).padStart(6, '0')}`;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, W);

  ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#ffffff';
  for (let y = 0; y < W; y += 12) {
    ctx.beginPath();
    for (let x = 0; x <= W; x += 8) {
      const yy = y + Math.sin((x / W) * Math.PI * 6 + y * 0.3) * 3;
      if (x === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.lineTo(W, y + 4);
    ctx.lineTo(0, y + 4);
    ctx.closePath();
    ctx.fill();
  }

  ctx.globalAlpha = 0.5;
  for (let i = 0; i < 160; i++) {
    ctx.fillRect(Math.random() * W, Math.random() * W, 3, 1.5);
  }
  ctx.globalAlpha = 1;

  const tex = finish(c);
  tex.repeat.set(24, 24);
  return tex;
}
