/**
 * Generic reference skeleton driven by an {@link AnatomyPose} (FR-07 – FR-09, FR-11).
 *
 * Limb bones are positioned between observed landmarks; the spine, rib cage, pelvis
 * and skull are rigid generic parts placed using the inferred torso / head frames.
 * Bones whose landmarks are "held" (temporarily occluded) are drawn dimmed;
 * bones whose landmarks are lost are hidden — never extrapolated.
 */
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { AnatomyPose, Frame, JointName } from '../anatomy/rigMapping';
import { catmullRom, cross, lerp, norm, sub } from '../anatomy/vec';
import type { Vec3 } from '../types/pose';
import {
  longBoneGeometry,
  nodeGeometry,
  pelvisGeometry,
  ribcageGeometry,
  scapulaGeometry,
  skullGeometry,
  vertebraGeometry,
} from './boneGeometry';
import { LayerMaterial, SOLID_PALETTE, XRAY_PALETTE, type RenderStyle } from './materials';

export type LayerName = 'skeleton' | 'spine' | 'ribcage' | 'pelvis' | 'skull' | 'joints' | 'labels';
export const LAYER_NAMES: LayerName[] = ['skeleton', 'spine', 'ribcage', 'pelvis', 'skull', 'joints', 'labels'];
export type LayerVisibility = Record<LayerName, boolean>;
export const DEFAULT_LAYERS: LayerVisibility = {
  skeleton: true, spine: true, ribcage: true, pelvis: true, skull: true, joints: false, labels: false,
};

const RELIABLE = 0.55;
const Y = new THREE.Vector3(0, 1, 0);
const tv = (p: Vec3) => new THREE.Vector3(p.x, p.y, p.z);

const LONG_GEO = longBoneGeometry();
const THIN_GEO = longBoneGeometry(0.5, 8);
const VERT_GEO = vertebraGeometry();
const RIB_GEO = ribcageGeometry();
const SCAP_GEO = scapulaGeometry();
const PELVIS_GEO = pelvisGeometry();
const SKULL_GEO = skullGeometry();
const NODE_GEO = nodeGeometry();

interface Segment {
  mesh: THREE.Mesh;
  a: JointName | ((p: AnatomyPose) => Vec3);
  b: JointName | ((p: AnatomyPose) => Vec3);
  /** Width as a fraction of torso length. */
  w: number;
  /** Which joints decide confidence. */
  conf: JointName[];
  /** Optional lateral offset (fraction of torso length) for paired bones. */
  offset?: number;
}

const SIDES = [
  { s: 'l', sign: 1 },
  { s: 'r', sign: -1 },
] as const;

export class SkeletonModel {
  readonly group = new THREE.Group();
  private layerGroups = {} as Record<LayerName, THREE.Group>;
  private mats!: Record<'bone' | 'spine' | 'ribs' | 'skull', LayerMaterial>;
  private segments: Segment[] = [];
  private vertebrae: THREE.Mesh[] = [];
  private ribcage: THREE.Mesh;
  private scapulae: THREE.Mesh;
  private pelvis: THREE.Mesh;
  private skull: THREE.Mesh;
  private patellae: THREE.Mesh[] = [];
  private jointMarkers: { name: JointName; mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; wire: THREE.MeshBasicMaterial }[] = [];
  /** `side`: which of the person's sides the label sits on (screen side resolved per frame). */
  private labels: { obj: CSS2DObject; at: (p: AnatomyPose) => Vec3 | null; side: 'left' | 'right' }[] = [];
  private lastPose: AnatomyPose | null = null;
  private style: RenderStyle = 'xray';
  private opacity = 0.9;

  constructor(opts: { style?: RenderStyle; opacity?: number; withLabels?: boolean } = {}) {
    this.style = opts.style ?? 'xray';
    this.opacity = opts.opacity ?? 0.9;
    for (const l of [...LAYER_NAMES]) {
      const g = new THREE.Group();
      g.name = l;
      this.layerGroups[l] = g;
      this.group.add(g);
    }
    this.buildMaterials();
    const G = this.layerGroups;
    const mesh = (geo: THREE.BufferGeometry, mat: LayerMaterial, parent: THREE.Group) => {
      const m = new THREE.Mesh(geo, mat.normal);
      m.frustumCulled = false;
      m.matrixAutoUpdate = true;
      parent.add(m);
      return m;
    };
    const bone = this.mats.bone;

    // ---- Limbs (observed endpoints) ----
    for (const { s, sign } of SIDES) {
      const j = (n: string) => `${s}${n}` as JointName;
      const add = (seg: Omit<Segment, 'mesh'>, geo = LONG_GEO) => this.segments.push({ ...seg, mesh: mesh(geo, bone, G.skeleton) });
      add({ a: 'sternumTop', b: j('Shoulder'), w: 0.026, conf: [j('Shoulder')] }); // clavicle
      add({ a: j('Shoulder'), b: j('Elbow'), w: 0.05, conf: [j('Shoulder'), j('Elbow')] }); // humerus
      add({ a: j('Elbow'), b: j('Wrist'), w: 0.03, conf: [j('Elbow'), j('Wrist')], offset: 0.018 * sign }); // radius
      add({ a: j('Elbow'), b: j('Wrist'), w: 0.028, conf: [j('Elbow'), j('Wrist')], offset: -0.018 * sign }); // ulna
      add({ a: j('Hip'), b: j('Knee'), w: 0.062, conf: [j('Hip'), j('Knee')] }); // femur
      add({ a: j('Knee'), b: j('Ankle'), w: 0.052, conf: [j('Knee'), j('Ankle')], offset: 0.008 * sign }); // tibia
      add({ a: j('Knee'), b: j('Ankle'), w: 0.024, conf: [j('Knee'), j('Ankle')], offset: -0.035 * sign }); // fibula
      // Hand rays: metacarpal + phalanx for thumb, index, middle, ring, little.
      const handTargets: [(p: AnatomyPose) => Vec3, number][] = [
        [(p) => p.joints[j('Thumb')].p, 0.85],
        [(p) => p.joints[j('Index')].p, 0.95],
        [(p) => lerp(p.joints[j('Index')].p, p.joints[j('Pinky')].p, 1 / 3), 1.0],
        [(p) => lerp(p.joints[j('Index')].p, p.joints[j('Pinky')].p, 2 / 3), 0.95],
        [(p) => p.joints[j('Pinky')].p, 0.75],
      ];
      for (const [tgt, ext] of handTargets) {
        const conf = [j('Wrist'), j('Index'), j('Pinky')];
        const tip = (p: AnatomyPose) => {
          const w = p.joints[j('Wrist')].p;
          const m = tgt(p);
          return lerp(w, m, 1 + ext);
        };
        add({ a: j('Wrist'), b: tgt, w: 0.012, conf }, THIN_GEO);
        add({ a: tgt, b: tip, w: 0.01, conf }, THIN_GEO);
      }
      // Foot: calcaneus + metatarsal rays.
      add({ a: j('Ankle'), b: j('Heel'), w: 0.045, conf: [j('Ankle'), j('Heel')] }, THIN_GEO);
      for (const o of [-0.03, 0, 0.03]) {
        add({ a: j('Ankle'), b: j('Toe'), w: 0.016, conf: [j('Ankle'), j('Toe')], offset: o }, THIN_GEO);
      }
      const pat = mesh(NODE_GEO, bone, G.skeleton);
      this.patellae.push(pat);
    }
    this.scapulae = mesh(SCAP_GEO, bone, G.skeleton);

    // ---- Axial skeleton (inferred, illustrative) ----
    for (let i = 0; i < 24; i++) this.vertebrae.push(mesh(VERT_GEO, this.mats.spine, G.spine));
    this.ribcage = mesh(RIB_GEO, this.mats.ribs, G.ribcage);
    this.pelvis = mesh(PELVIS_GEO, bone, G.pelvis);
    this.skull = mesh(SKULL_GEO, this.mats.skull, G.skull);

    // ---- Joint markers (observed landmarks) ----
    const markerJoints: JointName[] = [
      'lShoulder', 'rShoulder', 'lElbow', 'rElbow', 'lWrist', 'rWrist',
      'lHip', 'rHip', 'lKnee', 'rKnee', 'lAnkle', 'rAnkle', 'nose',
    ];
    for (const name of markerJoints) {
      const mat = new THREE.MeshBasicMaterial({ color: '#4ade80', transparent: true, opacity: 0.95, depthTest: false });
      const wire = new THREE.MeshBasicMaterial({ color: '#fbbf24', wireframe: true, transparent: true, opacity: 0.9, depthTest: false });
      const m = new THREE.Mesh(NODE_GEO, mat);
      m.renderOrder = 10;
      m.frustumCulled = false;
      G.joints.add(m);
      this.jointMarkers.push({ name, mesh: m, mat, wire });
    }

    if (opts.withLabels !== false) this.buildLabels();
    this.setLayers(DEFAULT_LAYERS);
    this.group.visible = false;
  }

  private buildMaterials(): void {
    const pal = this.style === 'xray' ? XRAY_PALETTE : SOLID_PALETTE;
    const old = this.mats;
    this.mats = {
      bone: new LayerMaterial(this.style, pal.bone, this.opacity),
      spine: new LayerMaterial(this.style, pal.spine, this.opacity),
      ribs: new LayerMaterial(this.style, pal.ribs, this.opacity * 0.85),
      skull: new LayerMaterial(this.style, pal.skull, this.opacity),
    };
    if (old) Object.values(old).forEach((m) => m.dispose());
  }

  private buildLabels(): void {
    const mk = (text: string, side: 'left' | 'right', at: (p: AnatomyPose) => Vec3 | null) => {
      const div = document.createElement('div');
      div.className = 'bone-label';
      const line = document.createElement('span');
      line.className = 'leader';
      const t = document.createElement('span');
      t.className = 'text';
      t.textContent = text;
      div.append(line, t);
      const obj = new CSS2DObject(div);
      this.layerGroups.labels.add(obj);
      this.labels.push({ obj, at, side });
    };
    const J = (p: AnatomyPose, n: JointName) => (p.joints[n].conf > 0 ? p.joints[n].p : null);
    const midOf = (p: AnatomyPose, a: JointName, b: JointName) =>
      p.joints[a].conf > 0 && p.joints[b].conf > 0 ? lerp(p.joints[a].p, p.joints[b].p, 0.5) : null;
    // Axial skeleton: one column on the person's right side.
    const out = (p: AnatomyPose, q: Vec3 | null, k: number) =>
      q ? { x: q.x - p.torso.lateral.x * k * p.torsoLength, y: q.y - p.torso.lateral.y * k * p.torsoLength, z: q.z - p.torso.lateral.z * k * p.torsoLength } : null;
    mk('Skull', 'right', (p) => out(p, J(p, 'headCentre'), 0.22));
    mk('Cervical spine (C1–C7)', 'right', (p) => out(p, midOf(p, 'C7', 'skullBase'), 0.1));
    mk('Sternum', 'right', (p) => J(p, 'sternumTop'));
    mk('Thoracic spine (T1–T12)', 'right', (p) => out(p, J(p, 'T6'), 0.12));
    mk('Rib cage', 'right', (p) => out(p, lerp(p.joints.T12.p, p.joints.T6.p, 0.3), 0.3));
    mk('Lumbar spine (L1–L5)', 'right', (p) => out(p, J(p, 'L3'), 0.1));
    mk('Pelvis', 'right', (p) => J(p, 'rHip'));
    // Appendicular skeleton: the person's left limbs.
    mk('Clavicle', 'left', (p) => midOf(p, 'sternumTop', 'lShoulder'));
    mk('Humerus', 'left', (p) => midOf(p, 'lShoulder', 'lElbow'));
    mk('Radius / Ulna', 'left', (p) => midOf(p, 'lElbow', 'lWrist'));
    mk('Femur', 'left', (p) => midOf(p, 'lHip', 'lKnee'));
    mk('Patella', 'left', (p) => J(p, 'lKnee'));
    mk('Tibia / Fibula', 'left', (p) => midOf(p, 'lKnee', 'lAnkle'));
  }

  /**
   * Place each label beside its anchor, on the outside of the body as seen on screen
   * (works with mirroring and when the person turns around).
   */
  arrangeLabels(camera: THREE.Camera): void {
    const p = this.lastPose;
    if (!p || !this.layerGroups.labels.visible) return;
    this.group.updateMatrixWorld();
    const proj = (q: Vec3) => this.group.localToWorld(new THREE.Vector3(q.x, q.y, q.z)).project(camera).x;
    const leftOnScreenRight = proj(p.joints.lShoulder.p) + proj(p.joints.lHip.p) > proj(p.joints.rShoulder.p) + proj(p.joints.rHip.p);
    for (const l of this.labels) {
      const toRight = (l.side === 'left') === leftOnScreenRight;
      l.obj.center.set(toRight ? 0 : 1, 0.5);
      l.obj.element.classList.toggle('to-left', !toRight);
    }
  }

  setLayers(layers: LayerVisibility): void {
    for (const l of LAYER_NAMES) this.layerGroups[l].visible = layers[l];
    // CSS2D labels ignore parent visibility in some three versions; toggle explicitly.
    for (const { obj } of this.labels) obj.element.style.display = layers.labels ? '' : 'none';
  }

  setStyle(style: RenderStyle, opacity: number): void {
    if (style === this.style && opacity === this.opacity) return;
    this.style = style;
    this.opacity = opacity;
    this.buildMaterials();
    // Materials are re-assigned on the next update() call.
  }

  /** Re-pose every part. Pass null to hide the model (no person / torso lost). */
  update(pose: AnatomyPose | null): void {
    if (!pose) {
      this.lastPose = null;
      this.group.visible = false;
      for (const { obj } of this.labels) obj.visible = false;
      return;
    }
    this.group.visible = true;
    this.lastPose = pose;
    const T = pose.torsoLength;
    const resolve = (x: Segment['a']) => (typeof x === 'function' ? x(pose) : pose.joints[x].p);

    for (const seg of this.segments) {
      const c = Math.min(...seg.conf.map((n) => pose.joints[n].conf));
      if (c <= 0) {
        seg.mesh.visible = false;
        continue;
      }
      seg.mesh.material = c >= RELIABLE ? this.mats.bone.normal : this.mats.bone.dim;
      let a = resolve(seg.a);
      let b = resolve(seg.b);
      if (seg.offset) {
        const dir = norm(sub(b, a));
        const side = norm(cross(dir, pose.torso.forward), pose.torso.lateral);
        const o = { x: side.x * seg.offset * T, y: side.y * seg.offset * T, z: side.z * seg.offset * T };
        a = { x: a.x + o.x, y: a.y + o.y, z: a.z + o.z };
        b = { x: b.x + o.x, y: b.y + o.y, z: b.z + o.z };
      }
      placeSegment(seg.mesh, a, b, seg.w * T);
    }

    // Patellae
    SIDES.forEach(({ s }, i) => {
      const knee = pose.joints[`${s}Knee` as JointName];
      const m = this.patellae[i];
      m.visible = knee.conf > 0;
      if (!m.visible) return;
      const f = pose.torso.forward;
      m.position.set(knee.p.x + f.x * 0.045 * T, knee.p.y + f.y * 0.045 * T + 0.02 * T, knee.p.z + f.z * 0.045 * T);
      m.scale.set(0.035 * T, 0.042 * T, 0.02 * T);
      m.material = knee.conf >= RELIABLE ? this.mats.bone.normal : this.mats.bone.dim;
    });

    // Rigid torso parts: scale the lateral axis by observed shoulder width (helps when turning).
    const torsoConf = pose.joints.sternumBottom.conf;
    const widthScale = Math.min(1.35, Math.max(0.7, pose.shoulderWidth / (0.76 * T)));
    placeRigid(this.ribcage, pose.joints.midHip.p, pose.torso, T * widthScale, T, T, torsoConf, this.mats.ribs);
    placeRigid(this.scapulae, pose.joints.midHip.p, pose.torso, T * widthScale, T, T, torsoConf, this.mats.bone);

    // Pelvis in its own frame: lateral from the hips, up from the torso.
    const H = Math.max(pose.hipWidth, 0.3 * T);
    const hipLat = norm(sub(pose.joints.lHip.p, pose.joints.rHip.p), pose.torso.lateral);
    const pelvisFrame: Frame = { lateral: hipLat, up: pose.torso.up, forward: norm(cross(hipLat, pose.torso.up), pose.torso.forward) };
    placeRigid(this.pelvis, pose.joints.midHip.p, pelvisFrame, H, H, H, pose.joints.midHip.conf, this.mats.bone);

    // Skull
    const hc = pose.joints.headCentre;
    placeRigid(this.skull, hc.p, pose.head, pose.head.size.x, pose.head.size.y, pose.head.size.z, hc.conf, this.mats.skull);

    // Spine: 5 lumbar, 12 thoracic, 7 cervical sampled along the inferred curve.
    const spineConf = Math.min(pose.joints.L3.conf, pose.joints.C7.conf);
    const ranges: [number, number, number, number][] = [
      // [count, tStart, tEnd, size (× T)]
      [5, 0.06, 0.37, 0.042],
      [12, 0.41, 0.79, 0.032],
      [7, 0.83, 0.985, 0.022],
    ];
    let vi = 0;
    for (const [count, t0, t1, size] of ranges) {
      for (let k = 0; k < count; k++) {
        const t = t0 + ((t1 - t0) * k) / Math.max(count - 1, 1);
        const m = this.vertebrae[vi++];
        m.visible = spineConf > 0;
        if (!m.visible) continue;
        const p = catmullRom(pose.spine, t);
        const tan = norm(sub(catmullRom(pose.spine, Math.min(t + 0.01, 1)), catmullRom(pose.spine, Math.max(t - 0.01, 0))));
        const lat = norm(sub(pose.torso.lateral, scaleV(tan, dotV(pose.torso.lateral, tan))));
        const fwd = norm(cross(lat, tan));
        const s = size * T;
        const mtx = new THREE.Matrix4().makeBasis(tv(lat).multiplyScalar(s), tv(tan).multiplyScalar(s), tv(fwd).multiplyScalar(s));
        mtx.setPosition(p.x, p.y, p.z);
        m.matrixAutoUpdate = false;
        m.matrix.copy(mtx);
        m.material = spineConf >= RELIABLE ? this.mats.spine.normal : this.mats.spine.dim;
      }
    }

    // Joint markers: solid = tracked, wireframe = held (shape, not just colour — NFR-11).
    for (const jm of this.jointMarkers) {
      const j = pose.joints[jm.name];
      jm.mesh.visible = j.conf > 0;
      if (!jm.mesh.visible) continue;
      jm.mesh.position.set(j.p.x, j.p.y, j.p.z);
      const r = 0.028 * T;
      jm.mesh.scale.set(r, r, r);
      const reliable = j.conf >= RELIABLE;
      jm.mesh.material = reliable ? jm.mat : jm.wire;
      jm.mat.color.set(j.conf > 0.8 ? '#4ade80' : '#a3e635');
    }

    for (const l of this.labels) {
      const p = l.at(pose);
      l.obj.visible = !!p;
      if (p) l.obj.position.set(p.x, p.y, p.z);
    }
  }

  dispose(): void {
    Object.values(this.mats).forEach((m) => m.dispose());
    this.jointMarkers.forEach((j) => {
      j.mat.dispose();
      j.wire.dispose();
    });
    this.labels.forEach((l) => l.obj.element.remove());
  }
}

const dotV = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const scaleV = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });

const _q = new THREE.Quaternion();
const _d = new THREE.Vector3();
function placeSegment(mesh: THREE.Mesh, a: Vec3, b: Vec3, width: number): void {
  _d.set(b.x - a.x, b.y - a.y, b.z - a.z);
  const L = _d.length();
  if (L < 1e-6) {
    mesh.visible = false;
    return;
  }
  mesh.visible = true;
  mesh.matrixAutoUpdate = true;
  mesh.position.set(a.x, a.y, a.z);
  _q.setFromUnitVectors(Y, _d.divideScalar(L));
  mesh.quaternion.copy(_q);
  mesh.scale.set(width, L, width);
}

function placeRigid(
  mesh: THREE.Mesh,
  origin: Vec3,
  f: Frame,
  sx: number,
  sy: number,
  sz: number,
  conf: number,
  mat: LayerMaterial,
): void {
  mesh.visible = conf > 0;
  if (!mesh.visible) return;
  mesh.matrixAutoUpdate = false;
  mesh.matrix.makeBasis(tv(f.lateral).multiplyScalar(sx), tv(f.up).multiplyScalar(sy), tv(f.forward).multiplyScalar(sz));
  mesh.matrix.setPosition(origin.x, origin.y, origin.z);
  mesh.material = conf >= RELIABLE ? mat.normal : mat.dim;
}
