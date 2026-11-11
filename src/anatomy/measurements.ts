/**
 * Estimated joint angles and symmetry indicators (FR-13).
 * These are educational estimates from a monocular pose model — NOT clinical
 * goniometry. The UI labels them accordingly (§10.2).
 */
import type { TrackedPose } from '../tracking/LandmarkTracker';
import { LM } from './landmarks';
import { toSpace } from './rigMapping';
import { angleDeg, mid, sub } from './vec';

export interface Measurement {
  id: string;
  label: string;
  /** Degrees. */
  value: number;
  /** Min visibility of the landmarks involved (0–1). */
  confidence: number;
  /** All involved landmarks currently tracked (not held/lost). */
  reliable: boolean;
  /** 3D (world landmarks) or 2D (image plane). */
  basis: '3D' | '2D';
}

export interface SymmetryIndicator {
  id: string;
  label: string;
  /** Absolute left/right difference in degrees. */
  difference: number;
  reliable: boolean;
}

export interface MeasurementSet {
  angles: Measurement[];
  posture: Measurement[];
  symmetry: SymmetryIndicator[];
}

const TRIPLETS: { id: string; label: string; idx: [number, number, number] }[] = [
  { id: 'lElbow', label: 'Left elbow flexion angle', idx: [LM.LEFT_SHOULDER, LM.LEFT_ELBOW, LM.LEFT_WRIST] },
  { id: 'rElbow', label: 'Right elbow flexion angle', idx: [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW, LM.RIGHT_WRIST] },
  { id: 'lShoulder', label: 'Left shoulder (trunk–arm)', idx: [LM.LEFT_HIP, LM.LEFT_SHOULDER, LM.LEFT_ELBOW] },
  { id: 'rShoulder', label: 'Right shoulder (trunk–arm)', idx: [LM.RIGHT_HIP, LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW] },
  { id: 'lHip', label: 'Left hip (trunk–thigh)', idx: [LM.LEFT_SHOULDER, LM.LEFT_HIP, LM.LEFT_KNEE] },
  { id: 'rHip', label: 'Right hip (trunk–thigh)', idx: [LM.RIGHT_SHOULDER, LM.RIGHT_HIP, LM.RIGHT_KNEE] },
  { id: 'lKnee', label: 'Left knee angle', idx: [LM.LEFT_HIP, LM.LEFT_KNEE, LM.LEFT_ANKLE] },
  { id: 'rKnee', label: 'Right knee angle', idx: [LM.RIGHT_HIP, LM.RIGHT_KNEE, LM.RIGHT_ANKLE] },
];

const PAIRS: [string, string, string][] = [
  ['elbow', 'lElbow', 'rElbow'],
  ['shoulder', 'lShoulder', 'rShoulder'],
  ['hip', 'lHip', 'rHip'],
  ['knee', 'lKnee', 'rKnee'],
];

/** Signed angle (deg) of a 2D image-plane vector from the horizontal. */
function tiltDeg(dx: number, dy: number): number {
  let a = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (a > 90) a -= 180;
  if (a < -90) a += 180;
  return a;
}

export function computeMeasurements(pose: TrackedPose, aspect: number): MeasurementSet {
  const use3D = !!pose.world;
  const P = (i: number) =>
    use3D ? toSpace(pose.world![i], 'world', 1) : toSpace(pose.image[i], 'image', aspect);
  const vis = (i: number) => (pose.image[i].state === 'lost' ? 0 : pose.image[i].visibility);
  const ok = (i: number) => pose.image[i].state === 'tracked';

  const angles: Measurement[] = TRIPLETS.map(({ id, label, idx: [a, b, c] }) => ({
    id,
    label,
    value: angleDeg(P(a), P(b), P(c)),
    confidence: Math.min(vis(a), vis(b), vis(c)),
    reliable: ok(a) && ok(b) && ok(c),
    basis: use3D ? '3D' : '2D',
  }));

  // Posture indicators in the image plane (what the learner sees).
  const I = (i: number) => toSpace(pose.image[i], 'image', aspect);
  const ls = I(LM.LEFT_SHOULDER), rs = I(LM.RIGHT_SHOULDER), lh = I(LM.LEFT_HIP), rh = I(LM.RIGHT_HIP);
  const sh = sub(ls, rs);
  const hp = sub(lh, rh);
  const trunk = sub(mid(ls, rs), mid(lh, rh));
  const torsoIdx = [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_HIP, LM.RIGHT_HIP];
  const tConf = Math.min(...torsoIdx.map(vis));
  const tOk = torsoIdx.every(ok);
  const posture: Measurement[] = [
    { id: 'shoulderTilt', label: 'Shoulder line tilt', value: tiltDeg(sh.x, sh.y), confidence: Math.min(vis(11), vis(12)), reliable: ok(11) && ok(12), basis: '2D' },
    { id: 'hipTilt', label: 'Hip line tilt', value: tiltDeg(hp.x, hp.y), confidence: Math.min(vis(23), vis(24)), reliable: ok(23) && ok(24), basis: '2D' },
    { id: 'trunkLean', label: 'Trunk lateral lean', value: (Math.atan2(trunk.x, trunk.y) * 180) / Math.PI, confidence: tConf, reliable: tOk, basis: '2D' },
  ];

  const byId = Object.fromEntries(angles.map((m) => [m.id, m]));
  const symmetry: SymmetryIndicator[] = PAIRS.map(([name, l, r]) => ({
    id: name,
    label: `${name[0].toUpperCase()}${name.slice(1)} L/R difference`,
    difference: Math.abs(byId[l].value - byId[r].value),
    reliable: byId[l].reliable && byId[r].reliable,
  }));

  return { angles, posture, symmetry };
}
