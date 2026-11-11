import * as THREE from 'three';

export type RenderStyle = 'xray' | 'solid';

/**
 * "X-ray-style" fresnel material: bright silhouettes, translucent centres, additive.
 * It is a visual style only — the model is a generic reference skeleton, not a radiograph.
 */
export function createXrayMaterial(color: THREE.ColorRepresentation, opacity = 0.9): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
      uDim: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uDim;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        // Orthographic cameras give a constant view vector; fall back to +Z.
        vec3 view = length(vView) > 0.0 ? vView : vec3(0.0, 0.0, 1.0);
        float facing = abs(dot(normalize(vNormal), view));
        float rim = pow(1.0 - facing, 1.6);
        float a = uOpacity * uDim * (0.18 + 0.82 * rim);
        gl_FragColor = vec4(uColor * (0.55 + 0.75 * rim), a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

export function createSolidMaterial(color: THREE.ColorRepresentation, opacity = 1): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.65,
    metalness: 0.0,
    transparent: opacity < 1,
    opacity,
    side: THREE.DoubleSide,
  });
}

export interface LayerPalette {
  bone: string;
  spine: string;
  ribs: string;
  skull: string;
}

export const XRAY_PALETTE: LayerPalette = { bone: '#cfe8ff', spine: '#7fe3ff', ribs: '#bcdcff', skull: '#e3f1ff' };
export const SOLID_PALETTE: LayerPalette = { bone: '#e8dcc2', spine: '#f0c987', ribs: '#e3d6bb', skull: '#efe5cf' };

/** A material pair: normal + dimmed (for bones whose landmarks are held/low confidence). */
export class LayerMaterial {
  normal: THREE.Material;
  dim: THREE.Material;
  constructor(style: RenderStyle, color: string, opacity: number) {
    if (style === 'xray') {
      const n = createXrayMaterial(color, opacity);
      const d = createXrayMaterial(color, opacity);
      d.uniforms.uDim.value = 0.35;
      this.normal = n;
      this.dim = d;
    } else {
      this.normal = createSolidMaterial(color, opacity);
      this.dim = createSolidMaterial(color, opacity * 0.35);
      (this.dim as THREE.MeshStandardMaterial).transparent = true;
    }
  }
  dispose(): void {
    this.normal.dispose();
    this.dim.dispose();
  }
}
