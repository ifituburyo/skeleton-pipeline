/**
 * Procedural, stylised reference-skeleton geometry.
 *
 * Generated in code by this project (MIT) — no third-party anatomy asset, so there is
 * no external licence to audit (FR-07/FR-20/AC-12). Shapes are schematic and
 * educational; proportions follow a generic adult, not the user.
 *
 * Conventions: long bones span y∈[0,1] with unit end radius. Rigid regions (rib cage,
 * pelvis, skull, scapulae) are built in a local frame X = person's left, Y = up,
 * Z = anterior, in the units noted on each builder.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const merge = (geos: THREE.BufferGeometry[]): THREE.BufferGeometry => {
  // mergeGeometries requires matching attributes; strip uv/indices differences.
  const prepared = geos.map((g) => {
    const ng = g.index ? g.toNonIndexed() : g;
    ng.deleteAttribute('uv');
    if (!ng.getAttribute('normal')) ng.computeVertexNormals();
    return ng;
  });
  const out = mergeGeometries(prepared, false);
  if (!out) throw new Error('Failed to merge skeleton geometry');
  out.computeBoundingSphere();
  return out;
};

/** Long bone (humerus, femur …): bulbous epiphyses, narrow diaphysis. */
export function longBoneGeometry(shaft = 0.42, segments = 14): THREE.BufferGeometry {
  const prof: [number, number][] = [
    [0.0, 0.0], [0.62, 0.005], [0.95, 0.035], [1.0, 0.075], [0.82, 0.13], [shaft + 0.08, 0.22],
    [shaft, 0.4], [shaft, 0.6], [shaft + 0.08, 0.78], [0.82, 0.87], [1.0, 0.925], [0.95, 0.965],
    [0.62, 0.995], [0.0, 1.0],
  ];
  return new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), segments);
}

/** Vertebra: body (cylinder) + spinous process (posterior) + transverse processes. Unit = body radius. */
export function vertebraGeometry(): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(1, 1, 0.75, 16, 1);
  const spinous = new THREE.BoxGeometry(0.28, 0.4, 1.3);
  spinous.rotateX(-0.45);
  spinous.translate(0, -0.15, -1.55);
  const arch = new THREE.TorusGeometry(0.6, 0.16, 6, 12, Math.PI);
  arch.rotateX(Math.PI / 2);
  arch.rotateZ(Math.PI);
  arch.translate(0, 0, -0.95);
  const transverse = new THREE.BoxGeometry(2.7, 0.25, 0.3);
  transverse.translate(0, 0, -0.9);
  return merge([body, spinous, arch, transverse]);
}

/** Rib cage + sternum, torso-local frame. Units: torso length (mid-hip → mid-shoulder). */
export function ribcageGeometry(): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  for (let k = 1; k <= 12; k++) {
    const y = 1.0 - (k - 1) * 0.048;
    const zb = -(0.125 + 0.04 * Math.sin((Math.PI * (k - 1)) / 11));
    const w = k <= 8 ? 0.12 + 0.17 * Math.sin(((k - 0.3) / 8) * (Math.PI / 2)) : 0.29 - 0.025 * (k - 8);
    const zf = 0.06 + 0.055 * (k / 12);
    const s = 1 + k * 0.06;
    for (const side of [1, -1]) {
      const pts: THREE.Vector3[] = [
        new THREE.Vector3(0.025 * side, y, zb),
        new THREE.Vector3(0.55 * w * side, y - 0.012, zb - 0.025),
        new THREE.Vector3(w * side, y - 0.06 * s, zb + 0.1),
      ];
      if (k <= 10) {
        pts.push(new THREE.Vector3(0.78 * w * side, y - 0.11 * s, zf - 0.035));
        const endY = k <= 7 ? y - 0.135 * s : 0.5 + (10 - k) * 0.012;
        pts.push(new THREE.Vector3((k <= 7 ? 0.035 : 0.1 + (k - 8) * 0.03) * side, endY, zf));
      } else {
        pts.push(new THREE.Vector3(0.85 * w * side, y - 0.1 * s, zb + 0.2)); // floating ribs
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      geos.push(new THREE.TubeGeometry(curve, 24, 0.011, 6, false));
    }
  }
  // Sternum: manubrium + body + xiphoid.
  const manubrium = new THREE.BoxGeometry(0.085, 0.085, 0.018);
  manubrium.translate(0, 0.875, 0.075);
  const body = new THREE.BoxGeometry(0.055, 0.25, 0.016);
  body.rotateX(-0.12);
  body.translate(0, 0.71, 0.095);
  const xiphoid = new THREE.ConeGeometry(0.018, 0.05, 6);
  xiphoid.rotateX(Math.PI);
  xiphoid.translate(0, 0.565, 0.11);
  geos.push(manubrium, body, xiphoid);
  return merge(geos);
}

/** Scapulae (left and right), torso-local frame, torso-length units. */
export function scapulaGeometry(): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  for (const side of [1, -1]) {
    const shape = new THREE.Shape();
    shape.moveTo(0.11 * side, 0.97);
    shape.lineTo(0.31 * side, 0.99);
    shape.lineTo(0.13 * side, 0.6);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.006, bevelSegments: 1 });
    g.translate(0, 0, -0.19);
    // Spine of scapula / acromion ridge.
    const ridge = new THREE.CylinderGeometry(0.009, 0.006, 0.26, 6);
    ridge.rotateZ(Math.PI / 2 - side * 0.08);
    ridge.translate(0.24 * side, 0.93, -0.17);
    geos.push(g, ridge);
  }
  return merge(geos);
}

/** Pelvis, hip-local frame. Units: distance between the two hip landmarks. */
export function pelvisGeometry(): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  for (const side of [1, -1]) {
    const ilium = new THREE.SphereGeometry(1, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.62);
    ilium.scale(0.33, 0.42, 0.09);
    ilium.rotateY(side * 0.55);
    ilium.rotateZ(-side * 0.18);
    ilium.translate(0.4 * side, 0.32, -0.12);
    const acetabulum = new THREE.TorusGeometry(0.12, 0.035, 6, 16);
    acetabulum.rotateY(Math.PI / 2);
    acetabulum.translate(0.45 * side, 0.02, 0.0);
    const obturator = new THREE.TorusGeometry(0.15, 0.045, 6, 18);
    obturator.rotateY(side * 0.35);
    obturator.translate(0.23 * side, -0.17, 0.1);
    const ischium = new THREE.CylinderGeometry(0.05, 0.035, 0.28, 8);
    ischium.rotateZ(side * 0.4);
    ischium.translate(0.33 * side, -0.12, -0.02);
    geos.push(ilium, acetabulum, obturator, ischium);
  }
  const sacrum = new THREE.ConeGeometry(0.2, 0.55, 10, 1);
  sacrum.rotateX(Math.PI - 0.35);
  sacrum.translate(0, 0.12, -0.3);
  const symphysis = new THREE.BoxGeometry(0.1, 0.12, 0.06);
  symphysis.translate(0, -0.15, 0.22);
  geos.push(sacrum, symphysis);
  return merge(geos);
}

/** Skull in head-local frame; cranium is a unit sphere, scaled per user by the renderer. */
export function skullGeometry(): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  const cranium = new THREE.SphereGeometry(1, 28, 20);
  cranium.scale(1, 0.98, 1.08);
  cranium.translate(0, 0.12, -0.08);
  geos.push(cranium);
  for (const side of [1, -1]) {
    const orbit = new THREE.TorusGeometry(0.22, 0.06, 8, 18);
    orbit.translate(0.36 * side, -0.12, 0.86);
    const zygoma = new THREE.CylinderGeometry(0.07, 0.05, 0.55, 8);
    zygoma.rotateZ(Math.PI / 2);
    zygoma.rotateY(side * 0.5);
    zygoma.translate(0.62 * side, -0.38, 0.55);
    geos.push(orbit, zygoma);
  }
  // Maxilla + nasal aperture.
  const maxilla = new THREE.TorusGeometry(0.42, 0.08, 8, 20, Math.PI);
  maxilla.rotateX(Math.PI / 2);
  maxilla.scale(1, 1, 0.9);
  maxilla.translate(0, -0.62, 0.42);
  const nasal = new THREE.ConeGeometry(0.12, 0.3, 3);
  nasal.rotateX(Math.PI);
  nasal.translate(0, -0.36, 0.93);
  // Mandible: U-shaped curve.
  const jaw = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.78, -0.28, 0.02),
    new THREE.Vector3(0.72, -0.78, 0.12),
    new THREE.Vector3(0.48, -0.98, 0.55),
    new THREE.Vector3(0.0, -1.06, 0.82),
    new THREE.Vector3(-0.48, -0.98, 0.55),
    new THREE.Vector3(-0.72, -0.78, 0.12),
    new THREE.Vector3(-0.78, -0.28, 0.02),
  ]);
  const mandible = new THREE.TubeGeometry(jaw, 40, 0.08, 8, false);
  geos.push(maxilla, nasal, mandible);
  return merge(geos);
}

/** Small sphere used for patella, talus, joint markers. */
export function nodeGeometry(): THREE.BufferGeometry {
  return new THREE.SphereGeometry(1, 14, 10);
}
