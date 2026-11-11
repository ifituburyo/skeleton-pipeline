/**
 * Anatomy alignment engine (FR-08, §6.2).
 *
 * Converts tracked landmarks into a set of named joints and an orthonormal torso
 * frame used to pose the generic reference skeleton.
 *
 * Engineering principle (Appendix B): observed landmarks and inferred anatomy are kept
 * separate. Every joint carries `observed`; spine, sternum, skull base, pelvis
 * are *inferred* from generic proportions and are illustrative only.
 */
import type { Vec3 } from '../types/pose';
import type { TrackedLandmark, TrackedPose } from '../tracking/LandmarkTracker';
import { LM } from './landmarks';
import { add, comb, cross, dist, dot, lerp, mid, norm, scale, sub, v } from './vec';

export type Space = 'image' | 'world';

export interface Joint {
  p: Vec3;
  conf: number;
  observed: boolean;
}

export const OBSERVED_JOINTS = {
  nose: LM.NOSE,
  lEye: LM.LEFT_EYE,
  rEye: LM.RIGHT_EYE,
  lEar: LM.LEFT_EAR,
  rEar: LM.RIGHT_EAR,
  lMouth: LM.MOUTH_LEFT,
  rMouth: LM.MOUTH_RIGHT,
  lShoulder: LM.LEFT_SHOULDER,
  rShoulder: LM.RIGHT_SHOULDER,
  lElbow: LM.LEFT_ELBOW,
  rElbow: LM.RIGHT_ELBOW,
  lWrist: LM.LEFT_WRIST,
  rWrist: LM.RIGHT_WRIST,
  lIndex: LM.LEFT_INDEX,
  rIndex: LM.RIGHT_INDEX,
  lPinky: LM.LEFT_PINKY,
  rPinky: LM.RIGHT_PINKY,
  lThumb: LM.LEFT_THUMB,
  rThumb: LM.RIGHT_THUMB,
  lHip: LM.LEFT_HIP,
  rHip: LM.RIGHT_HIP,
  lKnee: LM.LEFT_KNEE,
  rKnee: LM.RIGHT_KNEE,
  lAnkle: LM.LEFT_ANKLE,
  rAnkle: LM.RIGHT_ANKLE,
  lHeel: LM.LEFT_HEEL,
  rHeel: LM.RIGHT_HEEL,
  lToe: LM.LEFT_FOOT_INDEX,
  rToe: LM.RIGHT_FOOT_INDEX,
} as const;

export type ObservedJointName = keyof typeof OBSERVED_JOINTS;
export type InferredJointName =
  | 'midHip'
  | 'midShoulder'
  | 'sternumTop'
  | 'sternumBottom'
  | 'headCentre'
  | 'skullBase'
  | 'sacrum'
  | 'L3'
  | 'T12'
  | 'T6'
  | 'C7';
export type JointName = ObservedJointName | InferredJointName;

export interface Frame {
  /** Unit vector toward the person's anatomical left. */
  lateral: Vec3;
  /** Unit vector from pelvis toward neck. */
  up: Vec3;
  /** Unit vector out of the person's chest (anterior). */
  forward: Vec3;
}

export interface AnatomyPose {
  space: Space;
  joints: Record<JointName, Joint>;
  torso: Frame;
  head: Frame & { size: Vec3 };
  /** Inferred spinal curve control points, inferior → superior. */
  spine: Vec3[];
  torsoLength: number;
  shoulderWidth: number;
  hipWidth: number;
  quality: number;
  /** True when both hips were out of view and were estimated from the shoulders. */
  hipsEstimated: boolean;
}

/** Convert a tracked landmark into the 3D space used by the renderer. */
export function toSpace(lm: TrackedLandmark, space: Space, aspect: number): Vec3 {
  if (space === 'world') return v(lm.x, -lm.y, -lm.z);
  // Image space: x∈[0,aspect], y∈[0,1] up, z toward camera — same units as x.
  return v(lm.x * aspect, 1 - lm.y, -lm.z * aspect);
}

const conf = (l: TrackedLandmark) => (l.state === 'lost' ? 0 : l.visibility);

/**
 * Build the anatomy pose. Returns null when the torso itself cannot be located
 * (both shoulders lost, or both hips lost and only one shoulder visible) — the
 * renderer then hides the model rather than drawing something misleading
 * (confidence-aware fallback). If both hips are out of view but both shoulders
 * are visible, the hips are estimated (dimmed, `observed: false`).
 */
export function buildAnatomyPose(tracked: TrackedPose, space: Space, aspect = 1): AnatomyPose | null {
  const src = space === 'world' ? tracked.world : tracked.image;
  if (!src) return null;

  const joints = {} as Record<JointName, Joint>;
  for (const [name, idx] of Object.entries(OBSERVED_JOINTS) as [ObservedJointName, number][]) {
    const lm = src[idx];
    // World landmarks share visibility with image landmarks (same detection).
    const c = conf(tracked.image[idx]);
    joints[name] = { p: toSpace(lm, space, aspect), conf: c, observed: true };
  }

  const J = joints;
  if (Math.max(J.lShoulder.conf, J.rShoulder.conf) === 0) return null;
  let hipsEstimated = false;
  if (Math.max(J.lHip.conf, J.rHip.conf) === 0) {
    // Upper-body framing (e.g. sitting at a desk): estimate the hips from the shoulders.
    if (!estimateHipsFromShoulders(J)) return null;
    hipsEstimated = true;
  }
  const torsoConf = Math.min(J.lShoulder.conf, J.rShoulder.conf, J.lHip.conf, J.rHip.conf);

  const midShoulder = mid(J.lShoulder.p, J.rShoulder.p);
  const midHip = mid(J.lHip.p, J.rHip.p);
  const torsoLength = Math.max(dist(midShoulder, midHip), 1e-4);
  const shoulderWidth = dist(J.lShoulder.p, J.rShoulder.p);
  const hipWidth = dist(J.lHip.p, J.rHip.p);

  // Torso frame, orthonormalised. `lateral` from shoulders+hips (more stable than either alone).
  const up = norm(sub(midShoulder, midHip));
  const latRaw = add(sub(J.lShoulder.p, J.rShoulder.p), sub(J.lHip.p, J.rHip.p));
  let lateral = norm(sub(latRaw, scale(up, dot(latRaw, up))), v(1, 0, 0));
  let forward = norm(cross(lateral, up), v(0, 0, 1));
  if (space === 'image') {
    // Monocular image-z is noisy; bias the anterior axis toward the camera for a stable overlay.
    forward = norm(lerp(forward, v(0, 0, Math.sign(forward.z) || 1), 0.5));
    lateral = norm(cross(up, forward));
  }
  const T = torsoLength;
  const torso: Frame = { lateral, up, forward };

  // Head frame from face landmarks (fallback: generic offset above the shoulders).
  const earMid = mid(J.lEar.p, J.rEar.p);
  const faceConf = Math.min(J.nose.conf, Math.max(J.lEar.conf, J.rEar.conf));
  const earDist = dist(J.lEar.p, J.rEar.p);
  const headW = faceConf > 0 ? Math.max(earDist, T * 0.28) : T * 0.32;
  let headCentre: Vec3;
  let headFwd = forward;
  let headUp = up;
  if (faceConf > 0) {
    const nose = J.nose.p;
    headFwd = norm(lerp(norm(sub(nose, earMid), forward), forward, 0.3));
    const eyeMid = mid(J.lEye.p, J.rEye.p);
    const mouthMid = mid(J.lMouth.p, J.rMouth.p);
    const upRaw = sub(eyeMid, mouthMid);
    headUp = norm(sub(upRaw, scale(headFwd, dot(upRaw, headFwd))), up);
    headCentre = add(earMid, scale(headUp, headW * 0.18));
  } else {
    headCentre = add(midShoulder, scale(up, T * 0.42));
  }
  const headLat = norm(cross(headUp, headFwd), lateral);
  const head = {
    lateral: headLat,
    up: headUp,
    forward: headFwd,
    size: v(headW * 0.55, headW * 0.68, headW * 0.66),
  };

  // Inferred axial skeleton (illustrative proportions of a generic adult).
  const along = (t: number) => lerp(midHip, midShoulder, t);
  const back = (k: number) => scale(forward, -k * T);
  const sacrum = add(add(along(0.02), back(0.1)), scale(up, -0.04 * T));
  const L3 = add(along(0.24), back(0.08));
  const T12 = add(along(0.45), back(0.11));
  const T6 = add(along(0.74), back(0.16));
  const C7 = add(add(midShoulder, scale(up, 0.08 * T)), back(0.12));
  const skullBase = add(add(headCentre, scale(headUp, -head.size.y * 0.75)), scale(headFwd, -head.size.z * 0.25));
  const sternumTop = comb([midShoulder, 1], [up, -0.08 * T], [forward, 0.07 * T]);
  const sternumBottom = comb([along(0.56), 1], [forward, 0.11 * T]);

  const inf = (p: Vec3, c: number): Joint => ({ p, conf: c, observed: false });
  const shoulderConf = Math.min(J.lShoulder.conf, J.rShoulder.conf);
  J.midHip = inf(midHip, Math.min(J.lHip.conf, J.rHip.conf));
  J.midShoulder = inf(midShoulder, shoulderConf);
  J.sternumTop = inf(sternumTop, shoulderConf);
  J.sternumBottom = inf(sternumBottom, torsoConf);
  J.headCentre = inf(headCentre, faceConf > 0 ? faceConf : shoulderConf * 0.5);
  J.skullBase = inf(skullBase, J.headCentre.conf);
  J.sacrum = inf(sacrum, J.midHip.conf);
  J.L3 = inf(L3, torsoConf);
  J.T12 = inf(T12, torsoConf);
  J.T6 = inf(T6, torsoConf);
  J.C7 = inf(C7, shoulderConf);

  return {
    space,
    joints,
    torso,
    head,
    spine: [sacrum, L3, T12, T6, C7, skullBase],
    torsoLength: T,
    shoulderWidth,
    hipWidth,
    quality: tracked.quality,
    hipsEstimated,
  };
}

/** Typical adult ratios between MediaPipe landmark distances (illustrative). */
const TORSO_PER_SHOULDER_WIDTH = 1.35; // mid-shoulder → mid-hip ÷ shoulder width
const TORSO_PER_EAR_WIDTH = 3.2; // mid-shoulder → mid-hip ÷ ear-to-ear distance
const HIP_PER_SHOULDER_WIDTH = 0.65; // hip width ÷ shoulder width
/** Confidence given to estimated hips, as a fraction of shoulder confidence (renders dimmed). */
const ESTIMATED_HIP_CONF = 0.35;

/**
 * When both hips are out of frame, place them below the shoulders using generic
 * proportions so the upper-body skeleton can still be drawn. The hips are marked
 * `observed: false` with low confidence, so they and the pelvis render dimmed and
 * leg bones (which need knees) stay hidden. Needs both shoulders; returns false otherwise.
 */
function estimateHipsFromShoulders(J: Record<JointName, Joint>): boolean {
  const ls = J.lShoulder;
  const rs = J.rShoulder;
  if (ls.conf === 0 || rs.conf === 0) return false;
  const shoulderWidth = dist(ls.p, rs.p);
  if (shoulderWidth < 1e-4) return false;
  const lat = norm(sub(ls.p, rs.p), v(1, 0, 0));
  const midShoulder = mid(ls.p, rs.p);

  // "Up" is vertical in both spaces (y up), tilted toward the head when the face is visible.
  let upRaw = v(0, 1, 0);
  const ears = Math.min(J.lEar.conf, J.rEar.conf) > 0;
  const earMid = ears ? mid(J.lEar.p, J.rEar.p) : J.nose.conf > 0 ? J.nose.p : null;
  if (earMid) upRaw = lerp(upRaw, norm(sub(earMid, midShoulder), upRaw), 0.5);
  // Keep it perpendicular to the shoulder line.
  const up = norm(sub(upRaw, scale(lat, dot(upRaw, lat))), v(0, 1, 0));

  // Torso length from shoulder width; use the head as a floor when the person turns sideways.
  let T = shoulderWidth * TORSO_PER_SHOULDER_WIDTH;
  if (ears) T = Math.max(T, dist(J.lEar.p, J.rEar.p) * TORSO_PER_EAR_WIDTH);
  const midHip = sub(midShoulder, scale(up, T));
  const halfHip = (shoulderWidth * HIP_PER_SHOULDER_WIDTH) / 2;
  const c = Math.min(ls.conf, rs.conf) * ESTIMATED_HIP_CONF;
  J.lHip = { p: add(midHip, scale(lat, halfHip)), conf: c, observed: false };
  J.rHip = { p: sub(midHip, scale(lat, halfHip)), conf: c, observed: false };
  return true;
}
