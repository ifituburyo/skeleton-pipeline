import { describe, expect, it } from 'vitest';
import { OneEuroFilter } from '../tracking/OneEuroFilter';
import { LandmarkTracker } from '../tracking/LandmarkTracker';
import { DemoPoseSource } from '../vision/DemoPoseSource';
import { buildAnatomyPose } from '../anatomy/rigMapping';
import { computeMeasurements } from '../anatomy/measurements';
import { blendPose } from '../anatomy/blend';
import { LM, LANDMARK_COUNT } from '../anatomy/landmarks';
import { angleDeg, dot, len, v } from '../anatomy/vec';
import type { PoseFrame } from '../types/pose';

// Node has performance.now(); DemoPoseSource.estimate only needs it.
const demoFrame = (seconds: number, opts: Partial<ConstructorParameters<typeof DemoPoseSource>[0]> = {}): PoseFrame => {
  const d = new DemoPoseSource({ noise: 0, ...opts });
  // t0 = 0 so timestamp == elapsed ms
  return d.estimate(null, seconds * 1000)!;
};

describe('OneEuroFilter', () => {
  it('passes the first sample through and converges on a constant', () => {
    const f = new OneEuroFilter(1, 0.5);
    expect(f.filter(5, 0)).toBe(5);
    let y = 0;
    for (let i = 1; i <= 200; i++) y = f.filter(10, i / 60);
    expect(y).toBeCloseTo(10, 3);
  });

  it('reduces jitter on a noisy stationary signal', () => {
    const f = new OneEuroFilter(0.8, 0.3);
    const raw: number[] = [];
    const out: number[] = [];
    for (let i = 0; i < 300; i++) {
      const x = 0.5 + (i % 2 ? 0.01 : -0.01);
      raw.push(x);
      out.push(f.filter(x, i / 30));
    }
    const sd = (a: number[]) => {
      const m = a.reduce((s, x) => s + x, 0) / a.length;
      return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length);
    };
    expect(sd(out.slice(50))).toBeLessThan(sd(raw.slice(50)) * 0.5);
  });
});

describe('vector utilities', () => {
  it('computes right angles', () => {
    expect(angleDeg(v(1, 0, 0), v(0, 0, 0), v(0, 1, 0))).toBeCloseTo(90);
    expect(angleDeg(v(1, 0, 0), v(0, 0, 0), v(-1, 0, 0))).toBeCloseTo(180);
  });
});

describe('DemoPoseSource', () => {
  it('produces 33 image + world landmarks inside the frame', () => {
    for (const t of [0, 3.3, 7.1, 12.4, 18.9]) {
      const f = demoFrame(t);
      expect(f.image).toHaveLength(LANDMARK_COUNT);
      expect(f.world).toHaveLength(LANDMARK_COUNT);
      for (const l of f.image) {
        expect(l.x).toBeGreaterThan(0);
        expect(l.x).toBeLessThan(1);
        expect(l.y).toBeGreaterThan(0);
        expect(l.y).toBeLessThan(1);
      }
      // Person faces the camera: their left shoulder appears on the image right.
      expect(f.image[LM.LEFT_SHOULDER].x).toBeGreaterThan(f.image[LM.RIGHT_SHOULDER].x);
      // Head above hips (image y grows downward).
      expect(f.image[LM.NOSE].y).toBeLessThan(f.image[LM.LEFT_HIP].y);
    }
  });

  it('keeps limb lengths constant (rigid forward kinematics)', () => {
    const lens = [0, 6, 11, 16].map((t) => {
      const { body } = DemoPoseSource.bodyAt(t);
      const d = (a: number, b: number) => Math.hypot(body[a].x - body[b].x, body[a].y - body[b].y, body[a].z - body[b].z);
      return [d(LM.LEFT_SHOULDER, LM.LEFT_ELBOW), d(LM.LEFT_HIP, LM.LEFT_KNEE), d(LM.RIGHT_KNEE, LM.RIGHT_ANKLE)];
    });
    for (const l of lens) {
      expect(l[0]).toBeCloseTo(0.29, 5);
      expect(l[1]).toBeCloseTo(0.43, 5);
      expect(l[2]).toBeCloseTo(0.42, 5);
    }
  });

  it('bends the knees during the squat segment', () => {
    const f = demoFrame(6.25); // segment 1 (squat, 5–10 s), first rep at its deepest
    const tracker = new LandmarkTracker({ smoothing: 0, minVisibility: 0.5, holdMs: 500, maxJump: 1 });
    const m = computeMeasurements(tracker.update(f), 16 / 9);
    const knee = m.angles.find((a) => a.id === 'lKnee')!;
    expect(knee.value).toBeLessThan(120);
    const stand = computeMeasurements(new LandmarkTracker({ smoothing: 0, minVisibility: 0.5, holdMs: 500, maxJump: 1 }).update(demoFrame(0.01)), 16 / 9);
    expect(stand.angles.find((a) => a.id === 'lKnee')!.value).toBeGreaterThan(165);
  });
});

describe('LandmarkTracker', () => {
  const base = demoFrame(0.5);
  const at = (ms: number, mutate?: (f: PoseFrame) => void): PoseFrame => {
    const f: PoseFrame = { ...base, image: base.image.map((l) => ({ ...l })), world: base.world!.map((l) => ({ ...l })), captureTime: ms };
    mutate?.(f);
    return f;
  };

  it('holds an occluded joint briefly, then drops it', () => {
    const tr = new LandmarkTracker();
    tr.update(at(0));
    const occl = (f: PoseFrame) => (f.image[LM.LEFT_WRIST].visibility = 0.05);
    const held = tr.update(at(100, occl));
    expect(held.image[LM.LEFT_WRIST].state).toBe('held');
    expect(held.image[LM.LEFT_WRIST].x).toBeCloseTo(base.image[LM.LEFT_WRIST].x, 5);
    const lost = tr.update(at(1000, occl));
    expect(lost.image[LM.LEFT_WRIST].state).toBe('lost');
    expect(lost.warnings.join(' ')).toMatch(/left wrist/);
  });

  it('rejects a single-frame outlier jump (AC-04)', () => {
    const tr = new LandmarkTracker();
    tr.update(at(0));
    tr.update(at(33));
    const glitch = tr.update(at(66, (f) => (f.image[LM.LEFT_KNEE].x += 0.4)));
    expect(Math.abs(glitch.image[LM.LEFT_KNEE].x - base.image[LM.LEFT_KNEE].x)).toBeLessThan(0.01);
    // A jump that persists is accepted as genuine movement.
    tr.update(at(99, (f) => (f.image[LM.LEFT_KNEE].x += 0.4)));
    const persisted = tr.update(at(132, (f) => (f.image[LM.LEFT_KNEE].x += 0.4)));
    expect(persisted.image[LM.LEFT_KNEE].x).toBeGreaterThan(base.image[LM.LEFT_KNEE].x + 0.3);
  });

  it('reports high quality for a clean frame', () => {
    const q = new LandmarkTracker().update(at(0)).quality;
    expect(q).toBeGreaterThan(0.9);
  });
});

describe('anatomy alignment', () => {
  const tracked = new LandmarkTracker({ smoothing: 0, minVisibility: 0.5, holdMs: 500, maxJump: 1 }).update(demoFrame(0.2));

  it('builds an orthonormal torso frame with anterior toward the camera', () => {
    for (const space of ['image', 'world'] as const) {
      const p = buildAnatomyPose(tracked, space, 16 / 9)!;
      const { lateral, up, forward } = p.torso;
      expect(len(lateral)).toBeCloseTo(1, 5);
      expect(Math.abs(dot(lateral, up))).toBeLessThan(1e-6);
      expect(Math.abs(dot(up, forward))).toBeLessThan(1e-6);
      expect(up.y).toBeGreaterThan(0.9);
      expect(forward.z).toBeGreaterThan(0.5);
    }
  });

  it('marks inferred anatomy as not observed and places the spine behind the torso', () => {
    const p = buildAnatomyPose(tracked, 'world')!;
    expect(p.joints.lShoulder.observed).toBe(true);
    expect(p.joints.T6.observed).toBe(false);
    expect(p.joints.T6.p.z).toBeLessThan(p.joints.midShoulder.p.z);
    expect(p.joints.sternumBottom.p.z).toBeGreaterThan(p.joints.T6.p.z);
    // Spine control points ascend.
    for (let i = 1; i < p.spine.length; i++) expect(p.spine[i].y).toBeGreaterThan(p.spine[i - 1].y);
  });

  it('returns null when the torso is lost (no misleading overlay)', () => {
    const f = demoFrame(0.2);
    for (const i of [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER]) f.image[i].visibility = 0;
    const tr = new LandmarkTracker({ smoothing: 0, minVisibility: 0.5, holdMs: 0, maxJump: 1 });
    expect(buildAnatomyPose(tr.update(f), 'image', 1)).toBeNull();
  });

  it('estimates the hips from the shoulders when only the upper body is in view', () => {
    const f = demoFrame(0.2);
    const lower = [LM.LEFT_HIP, LM.RIGHT_HIP, LM.LEFT_KNEE, LM.RIGHT_KNEE, LM.LEFT_ANKLE, LM.RIGHT_ANKLE];
    for (const i of lower) f.image[i].visibility = 0;
    const tr = new LandmarkTracker({ smoothing: 0, minVisibility: 0.5, holdMs: 0, maxJump: 1 });
    const t = tr.update(f);
    const full = buildAnatomyPose(tracked, 'image', 16 / 9)!;
    for (const space of ['image', 'world'] as const) {
      const p = buildAnatomyPose(t, space, 16 / 9)!;
      expect(p).not.toBeNull();
      expect(p.hipsEstimated).toBe(true);
      expect(p.joints.lHip.observed).toBe(false);
      // Estimated hips are low-confidence (rendered dimmed) but present; legs stay hidden.
      expect(p.joints.lHip.conf).toBeGreaterThan(0);
      expect(p.joints.lHip.conf).toBeLessThan(0.55);
      expect(p.joints.lKnee.conf).toBe(0);
      expect(p.joints.midHip.p.y).toBeLessThan(p.joints.midShoulder.p.y);
      expect(p.torso.up.y).toBeGreaterThan(0.9);
      expect(Math.abs(dot(p.torso.lateral, p.torso.up))).toBeLessThan(1e-6);
    }
    // Torso length is in the right ballpark of the real one.
    const est = buildAnatomyPose(t, 'image', 16 / 9)!;
    expect(est.torsoLength / full.torsoLength).toBeGreaterThan(0.7);
    expect(est.torsoLength / full.torsoLength).toBeLessThan(1.4);
    expect(full.hipsEstimated).toBe(false);
  });

  it('blendPose interpolates joints and keeps frames orthonormal', () => {
    const a = buildAnatomyPose(tracked, 'world')!;
    const b = buildAnatomyPose(
      new LandmarkTracker({ smoothing: 0, minVisibility: 0.5, holdMs: 500, maxJump: 1 }).update(demoFrame(2.5)),
      'world',
    )!;
    const m = blendPose(a, b, 0.5);
    const w = m.joints.lWrist.p;
    expect(w.y).toBeGreaterThan(Math.min(a.joints.lWrist.p.y, b.joints.lWrist.p.y) - 1e-9);
    expect(w.y).toBeLessThan(Math.max(a.joints.lWrist.p.y, b.joints.lWrist.p.y) + 1e-9);
    expect(len(m.torso.forward)).toBeCloseTo(1, 5);
  });
});

describe('measurements', () => {
  it('reports near-level posture for the neutral demo pose and flags confidence', () => {
    const tracked = new LandmarkTracker({ smoothing: 0, minVisibility: 0.5, holdMs: 500, maxJump: 1 }).update(demoFrame(0.01));
    const m = computeMeasurements(tracked, 16 / 9);
    expect(m.angles).toHaveLength(8);
    expect(m.angles[0].basis).toBe('3D');
    for (const p of m.posture) expect(Math.abs(p.value)).toBeLessThan(5);
    for (const s of m.symmetry) expect(s.difference).toBeLessThan(3);
    expect(m.angles.every((a) => a.reliable)).toBe(true);
  });
});
