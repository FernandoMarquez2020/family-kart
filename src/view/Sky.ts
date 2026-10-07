import * as THREE from 'three';
import type { ThemePalette } from '../track/themes';

/**
 * Domo de cielo con degradado vertical.
 *
 * Es una esfera invertida con un shader mínimo: cuesta un draw call, no
 * necesita texturas y da un horizonte mucho más agradable que un color plano.
 */
export function buildSky(palette: ThemePalette, radius = 2000): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(palette.skyTop) },
      middleColor: { value: new THREE.Color(palette.skyMiddle) },
      bottomColor: { value: new THREE.Color(palette.skyBottom) },
      offset: { value: 120 },
      exponent: { value: 0.85 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 topColor;
      uniform vec3 middleColor;
      uniform vec3 bottomColor;
      uniform float offset;
      uniform float exponent;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
        vec3 color = h > 0.0
          ? mix(middleColor, topColor, pow(h, exponent))
          : mix(middleColor, bottomColor, pow(-h, exponent));
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });

  const sky = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 16), material);
  sky.name = 'sky';
  sky.frustumCulled = false;
  return sky;
}
