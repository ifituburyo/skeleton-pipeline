/**
 * Synthetic pose source for Demo mode (FR-16) and repeatable testing (§12).
 *
 * Generates the same 33-landmark format as MediaPipe from a parametric
 * forward-kinematics body performing a looping exercise routine. No camera, no
 * personal data. Optional noise and simulated occlusion let you evaluate the
 * tracking filter (AC-04) under controlled conditions.
 */
import type { Landmark, PoseEstimator, PoseFrame, Vec3 } from '../types/pose';
import { LM, LANDMARK_COUNT } from '../anatomy/landmarks';
import { add, cross, dot, norm, scale, sub, v } from '../anatomy/vec';

export interface DemoOptions {
  /** Landmark jitter, standard deviation as a fraction of frame height. */
  noise: number;
  /** Periodically hide the left forearm to test occlusion handling. */
  occlusion: boolean;
  /** Playback speed multiplier. */
  speed: number;
}

export const DEFAULT_DEMO_OPTIONS: DemoOptions = { noise: 0.004, occlusion: false, speed: 1 };

export const DEMO_SEGMENTS = ['Arm raise', 'Squat', 'Wave', 'Side bend + march'] as const;
const SEG_LEN = 5; // seconds per routine segment

interface BodyParams {
  lArmElev: number; lArmFwd: number; lElbow: number;
  rArmElev: number; rArmFwd: number; rElbow: number;
  lHipFlex: number; lHipAbd: number; lKnee: number;
  rHipFlex: number; rHipAbd: number; rKnee: number;
  pelvisDrop: number; trunkFlex: number; trunkSide: number; headTurn: number; sway: number;
}

const ZERO: BodyParams = {
  lArmElev: 0.12, lArmFwd: 0.2, lElbow: 0.25, rArmElev: 0.12, rArmFwd: 0.2, rElbow: 0.25,
  lHipFlex: 0, lHipAbd: 0.06, lKnee: 0.05, rHipFlex: 0, rHipAbd: 0.06, rKnee: 0.05,
  pelvisDrop: 0, trunkFlex: 0, trunkSide: 0, headTurn: 0, sway: 0,
};

const D2R = Math.PI / 180;
const ease = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, x)));

function segmentParams(seg: number, u: number, time: number): BodyParams {
  const p = { ...ZERO };
  const osc = 0.5 - 0.5 * Math.cos(2 * Math.PI * u * 2); // two reps per segment
  switch (seg) {
    case 0: // bilateral arm abduction
      p.lArmElev = p.rArmElev = (12 + 150 * osc) * D2R;
      p.lArmFwd = p.rArmFwd = 0.05;
      p.lElbow = p.rElbow = 0.1;
      break;
    case 1: { // squat with arms forward
      const s = osc;
      p.lHipFlex = p.rHipFlex = 85 * D2R * s;
      p.lKnee = p.rKnee = 95 * D2R * s;
      p.pelvisDrop = 0.33 * s;
      p.trunkFlex = 30 * D2R * s;
      p.lArmElev = p.rArmElev = (15 + 70 * s) * D2R;
      p.lArmFwd = p.rArmFwd = 85 * D2R;
      p.lElbow = p.rElbow = 0.1;
      p.lHipAbd = p.rHipAbd = 0.15;
      break;
    }
    case 2: // right-hand wave
      p.rArmElev = 95 * D2R;
      p.rArmFwd = 0.15;
      p.rElbow = (70 + 35 * Math.sin(2 * Math.PI * time * 1.6)) * D2R;
      p.headTurn = 0.25 * Math.sin(2 * Math.PI * u);
      break;
    case 3: { // side bend + march
      p.trunkSide = 14 * D2R * Math.sin(2 * Math.PI * u);
      const m = Math.sin(2 * Math.PI * time * 0.9);
      p.lHipFlex = Math.max(0, m) * 70 * D2R;
      p.lKnee = Math.max(0, m) * 85 * D2R + 0.05;
      p.rHipFlex = Math.max(0, -m) * 70 * D2R;
      p.rKnee = Math.max(0, -m) * 85 * D2R + 0.05;
      p.lArmElev = (15 + 20 * Math.max(0, -m)) * D2R;
      p.rArmElev = (15 + 20 * Math.max(0, m)) * D2R;
      p.lArmFwd = p.rArmFwd = 70 * D2R;
      p.lElbow = p.rElbow = 70 * D2R;
      break;
    }
  }
  p.sway = 0.015 * Math.sin(2 * Math.PI * time * 0.3);
  return p;
}

function blendParams(a: BodyParams, b: BodyParams, t: number): BodyParams {
  const out = { ...a };
  for (const k of Object.keys(a) as (keyof BodyParams)[]) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

/** Body landmarks in metres; y up, z toward the camera, person faces the camera. */
function forwardKinematics(p: BodyParams): Vec3[] {
  const pts: Vec3[] = Array.from({ length: LANDMARK_COUNT }, () => v());
  const pelvis = v(p.sway, -p.pelvisDrop, 0);
  const lat = v(Math.cos(p.trunkSide), -Math.sin(p.trunkSide), 0);
  const up = norm(v(Math.sin(p.trunkSide), Math.cos(p.trunkSide) * Math.cos(p.trunkFlex), Math.sin(p.trunkFlex)));
  const fwd = norm(cross(lat, up));

  pts[LM.LEFT_HIP] = add(pelvis, scale(lat, 0.1));
  pts[LM.RIGHT_HIP] = add(pelvis, scale(lat, -0.1));
  const shC = add(pelvis, scale(up, 0.5));
  pts[LM.LEFT_SHOULDER] = add(shC, scale(lat, 0.19));
  pts[LM.RIGHT_SHOULDER] = add(shC, scale(lat, -0.19));

  // Head
  const head = add(shC, scale(up, 0.25));
  const hf = norm(add(scale(fwd, Math.cos(p.headTurn)), scale(lat, Math.sin(p.headTurn))));
  const hl = norm(cross(up, hf));
  const hp = (l: number, u: number, f: number) => add(head, add(scale(hl, l), add(scale(up, u), scale(hf, f))));
  pts[LM.NOSE] = hp(0, 0, 0.11);
  pts[LM.LEFT_EYE_INNER] = hp(0.015, 0.035, 0.09);
  pts[LM.LEFT_EYE] = hp(0.032, 0.035, 0.085);
  pts[LM.LEFT_EYE_OUTER] = hp(0.048, 0.035, 0.075);
  pts[LM.RIGHT_EYE_INNER] = hp(-0.015, 0.035, 0.09);
  pts[LM.RIGHT_EYE] = hp(-0.032, 0.035, 0.085);
  pts[LM.RIGHT_EYE_OUTER] = hp(-0.048, 0.035, 0.075);
  pts[LM.LEFT_EAR] = hp(0.078, 0.01, 0);
  pts[LM.RIGHT_EAR] = hp(-0.078, 0.01, 0);
  pts[LM.MOUTH_LEFT] = hp(0.025, -0.045, 0.09);
  pts[LM.MOUTH_RIGHT] = hp(-0.025, -0.045, 0.09);

  // Arms: elevation from hanging (0) to overhead (π); fwd = azimuth from lateral toward front.
  const arm = (side: 1 | -1, elev: number, az: number, elbow: number) => {
    const sIdx = side > 0 ? LM.LEFT_SHOULDER : LM.RIGHT_SHOULDER;
    const S = pts[sIdx];
    const d = norm(add(add(scale(lat, side * Math.sin(elev) * Math.cos(az)), scale(up, -Math.cos(elev))), scale(fwd, Math.sin(elev) * Math.sin(az))));
    const E = add(S, scale(d, 0.29));
    let b = sub(up, scale(d, dot(up, d)));
    b = dot(b, b) < 1e-4 ? fwd : norm(b);
    if (Math.cos(elev) > 0.6) b = norm(add(b, scale(fwd, 2))); // hanging arm: bend forward
    const f = norm(add(scale(d, Math.cos(elbow)), scale(b, Math.sin(elbow))));
    const W = add(E, scale(f, 0.25));
    const handLat = norm(cross(f, fwd), lat);
    const hand = (o: number, l: number, fw: number) => add(W, add(scale(f, o), add(scale(handLat, side * l), scale(fwd, fw))));
    const idx = side > 0
      ? [LM.LEFT_ELBOW, LM.LEFT_WRIST, LM.LEFT_INDEX, LM.LEFT_PINKY, LM.LEFT_THUMB]
      : [LM.RIGHT_ELBOW, LM.RIGHT_WRIST, LM.RIGHT_INDEX, LM.RIGHT_PINKY, LM.RIGHT_THUMB];
    pts[idx[0]] = E;
    pts[idx[1]] = W;
    pts[idx[2]] = hand(0.09, -0.02, 0.02);
    pts[idx[3]] = hand(0.075, 0.03, -0.01);
    pts[idx[4]] = hand(0.05, -0.035, 0.03);
  };
  arm(1, p.lArmElev, p.lArmFwd, p.lElbow);
  arm(-1, p.rArmElev, p.rArmFwd, p.rElbow);

  const leg = (side: 1 | -1, flex: number, abd: number, knee: number) => {
    const H = pts[side > 0 ? LM.LEFT_HIP : LM.RIGHT_HIP];
    const down = v(0, -1, 0);
    const front = v(0, 0, 1);
    const d = norm(add(add(scale(down, Math.cos(flex) * Math.cos(abd)), scale(front, Math.sin(flex))), v(side * Math.sin(abd), 0, 0)));
    const K = add(H, scale(d, 0.43));
    // Knee flexion: rotate the thigh direction backwards about the medio-lateral (x) axis.
    const c = Math.cos(knee), sn = Math.sin(knee);
    const s = norm(v(d.x, d.y * c - d.z * sn, d.y * sn + d.z * c));
    const A = add(K, scale(s, 0.42));
    const idx = side > 0
      ? [LM.LEFT_KNEE, LM.LEFT_ANKLE, LM.LEFT_HEEL, LM.LEFT_FOOT_INDEX]
      : [LM.RIGHT_KNEE, LM.RIGHT_ANKLE, LM.RIGHT_HEEL, LM.RIGHT_FOOT_INDEX];
    pts[idx[0]] = K;
    pts[idx[1]] = A;
    pts[idx[2]] = add(A, v(side * 0.01, -0.05, -0.05));
    pts[idx[3]] = add(A, v(side * 0.03, -0.07, 0.16));
  };
  leg(1, p.lHipFlex, p.lHipAbd, p.lKnee);
  leg(-1, p.rHipFlex, p.rHipAbd, p.rKnee);

  // Squat: keep feet on the floor by lifting everything so the lowest heel sits at floor level.
  const floor = -0.92;
  const lowest = Math.min(pts[LM.LEFT_HEEL].y, pts[LM.RIGHT_HEEL].y, pts[LM.LEFT_FOOT_INDEX].y, pts[LM.RIGHT_FOOT_INDEX].y);
  if (p.pelvisDrop > 0) {
    const dy = floor - lowest;
    for (const q of pts) q.y += dy;
  }
  return pts;
}

/** Deterministic pseudo-random normal for repeatable noise. */
function gauss(seed: number): number {
  const r = (n: number) => {
    const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  const u1 = Math.max(r(seed), 1e-6);
  const u2 = r(seed + 1.618);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export class DemoPoseSource implements PoseEstimator {
  readonly name = 'Synthetic demo pose (no camera)';
  options: DemoOptions;
  aspect = 16 / 9;
  private t0 = 0;
  private pausedAt: number | null = null;
  private pausedTotal = 0;
  private frameNo = 0;
  currentSegment = 0;
  /** Latest body points (y-up metres) for drawing the demo silhouette. */
  lastBody: Vec3[] | null = null;

  constructor(options: Partial<DemoOptions> = {}) {
    this.options = { ...DEFAULT_DEMO_OPTIONS, ...options };
  }

  async init(): Promise<void> {
    this.t0 = performance.now();
  }

  setPaused(paused: boolean, now = performance.now()): void {
    if (paused && this.pausedAt === null) this.pausedAt = now;
    if (!paused && this.pausedAt !== null) {
      this.pausedTotal += now - this.pausedAt;
      this.pausedAt = null;
    }
  }

  /** Pure function of time — used by unit tests and by estimate(). */
  static bodyAt(seconds: number): { body: Vec3[]; segment: number } {
    const total = SEG_LEN * DEMO_SEGMENTS.length;
    const t = ((seconds % total) + total) % total;
    const seg = Math.floor(t / SEG_LEN);
    const u = (t - seg * SEG_LEN) / SEG_LEN;
    let params = segmentParams(seg, u, seconds);
    // Cross-fade into the next segment over the final 0.6 s.
    const fade = (u * SEG_LEN - (SEG_LEN - 0.6)) / 0.6;
    if (fade > 0) params = blendParams(params, segmentParams((seg + 1) % DEMO_SEGMENTS.length, 0, seconds), ease(fade));
    // Fade out of the previous segment at the start too (segments start from rest).
    return { body: forwardKinematics(params), segment: seg };
  }

  estimate(_source: HTMLVideoElement | null, timestampMs: number): PoseFrame | null {
    const t0 = performance.now();
    const now = this.pausedAt ?? timestampMs;
    const seconds = ((now - this.t0 - this.pausedTotal) / 1000) * this.options.speed;
    const { body, segment } = DemoPoseSource.bodyAt(seconds);
    this.lastBody = body;
    this.currentSegment = segment;
    this.frameNo++;

    const f = 1.2; // focal length (normalised by frame height)
    const D = 3.2; // camera distance, m
    const aspect = this.aspect;
    const noise = this.options.noise;
    const image: Landmark[] = [];
    const world: Landmark[] = [];
    const hipC = scale(add(body[LM.LEFT_HIP], body[LM.RIGHT_HIP]), 0.5);
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      const b = body[i];
      const depth = D - b.z;
      const n = (k: number) => (noise > 0 ? gauss(this.frameNo * 97 + i * 7 + k) * noise : 0);
      let visibility = 0.97;
      if (this.options.occlusion && (i === LM.LEFT_WRIST || i === LM.LEFT_ELBOW || (i >= 17 && i <= 21 && i % 2 === 1))) {
        const phase = (seconds % 6) / 6;
        if (phase > 0.55 && phase < 0.8) visibility = 0.15;
      }
      image.push({
        x: 0.5 + (b.x * f) / depth / aspect + n(1) / aspect,
        y: 0.53 - (b.y * f) / depth + n(2),
        z: (-(b.z - hipC.z) * f) / D / aspect,
        visibility,
      });
      world.push({ x: b.x - hipC.x, y: -(b.y - hipC.y), z: -(b.z - hipC.z), visibility });
    }
    return { image, world, captureTime: timestampMs, inferenceMs: performance.now() - t0 };
  }

  close(): void {
    this.lastBody = null;
  }
}
