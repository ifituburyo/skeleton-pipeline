/**
 * Render-rate interpolation between pose-inference updates (NFR-01: inference may run
 * slower than rendering). Exponentially approaches the latest target pose.
 */
import type { AnatomyPose, Frame, JointName } from './rigMapping';
import { cross, lerp, norm } from './vec';

function blendFrame(a: Frame, b: Frame, t: number): Frame {
  const up = norm(lerp(a.up, b.up, t), b.up);
  const lateralRaw = norm(lerp(a.lateral, b.lateral, t), b.lateral);
  const forward = norm(cross(lateralRaw, up), b.forward);
  const lateral = norm(cross(up, forward), b.lateral);
  return { lateral, up, forward };
}

export function blendPose(a: AnatomyPose | null, b: AnatomyPose, t: number): AnatomyPose {
  if (!a || a.space !== b.space || t >= 1) return b;
  const joints = {} as AnatomyPose['joints'];
  for (const k of Object.keys(b.joints) as JointName[]) {
    const ja = a.joints[k];
    const jb = b.joints[k];
    // Snap joints that just re-appeared rather than sliding them in from a stale spot.
    joints[k] = ja && ja.conf > 0 && jb.conf > 0 ? { ...jb, p: lerp(ja.p, jb.p, t) } : jb;
  }
  return {
    ...b,
    joints,
    torso: blendFrame(a.torso, b.torso, t),
    head: { ...blendFrame(a.head, b.head, t), size: lerp(a.head.size, b.head.size, t) },
    spine: b.spine.map((p, i) => (a.spine[i] ? lerp(a.spine[i], p, t) : p)),
    torsoLength: a.torsoLength + (b.torsoLength - a.torsoLength) * t,
    shoulderWidth: a.shoulderWidth + (b.shoulderWidth - a.shoulderWidth) * t,
    hipWidth: a.hipWidth + (b.hipWidth - a.hipWidth) * t,
  };
}
