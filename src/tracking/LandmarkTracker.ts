import type { Landmark, PoseFrame } from '../types/pose';
import { OneEuroFilter } from './OneEuroFilter';
import { CORE_LANDMARKS, LANDMARK_COUNT, LANDMARK_NAMES } from '../anatomy/landmarks';

/** Per-landmark tracking state — exposed in the UI as text, not colour alone (NFR-11). */
export type TrackState = 'tracked' | 'held' | 'lost';

export interface TrackedLandmark extends Landmark {
  state: TrackState;
}

export interface TrackedPose {
  image: TrackedLandmark[];
  world: TrackedLandmark[] | null;
  /** 0–1 mean visibility of the core rig landmarks (lost = 0). */
  quality: number;
  /** Human-readable warnings for the status panel (FR-05). */
  warnings: string[];
  captureTime: number;
  inferenceMs: number;
}

export interface TrackerSettings {
  /** 0 = raw, 1 = maximum smoothing. */
  smoothing: number;
  /** Visibility below which a landmark is treated as unreliable. */
  minVisibility: number;
  /** How long an occluded landmark keeps its last good position before it is dropped. */
  holdMs: number;
  /** Image-space jump (fraction of frame) treated as an outlier unless it persists. */
  maxJump: number;
}

export const DEFAULT_TRACKER_SETTINGS: TrackerSettings = {
  smoothing: 0.6,
  minVisibility: 0.5,
  holdMs: 500,
  maxJump: 0.18,
};

interface Slot {
  fx: OneEuroFilter[]; // image x,y,z
  fw: OneEuroFilter[]; // world x,y,z
  last: TrackedLandmark | null;
  lastWorld: TrackedLandmark | null;
  lastGoodTime: number;
  outlierFrames: number;
}

function filterParams(smoothing: number): { minCutoff: number; beta: number } {
  const s = Math.min(1, Math.max(0, smoothing));
  return { minCutoff: 0.3 + (1 - s) * 6, beta: 0.4 + (1 - s) * 2 };
}

/**
 * Confidence gating + outlier rejection + One Euro smoothing (FR-05, FR-06, AC-04).
 * Keeps occluded joints in place for a short time instead of letting them jump.
 */
export class LandmarkTracker {
  private slots: Slot[] = [];
  private settings: TrackerSettings;

  constructor(settings: TrackerSettings = DEFAULT_TRACKER_SETTINGS) {
    this.settings = { ...settings };
    this.reset();
  }

  configure(settings: Partial<TrackerSettings>): void {
    this.settings = { ...this.settings, ...settings };
    const { minCutoff, beta } = filterParams(this.settings.smoothing);
    for (const s of this.slots) {
      for (const f of [...s.fx, ...s.fw]) {
        f.minCutoff = minCutoff;
        f.beta = beta;
      }
    }
  }

  reset(): void {
    const { minCutoff, beta } = filterParams(this.settings.smoothing);
    const mk = () => [0, 1, 2].map(() => new OneEuroFilter(minCutoff, beta));
    this.slots = Array.from({ length: LANDMARK_COUNT }, () => ({
      fx: mk(),
      fw: mk(),
      last: null,
      lastWorld: null,
      lastGoodTime: -Infinity,
      outlierFrames: 0,
    }));
  }

  update(frame: PoseFrame): TrackedPose {
    const t = frame.captureTime / 1000;
    const bypass = this.settings.smoothing <= 0.001;
    const image: TrackedLandmark[] = [];
    const world: TrackedLandmark[] | null = frame.world ? [] : null;

    for (let i = 0; i < LANDMARK_COUNT; i++) {
      const slot = this.slots[i];
      const raw = frame.image[i];
      const rawW = frame.world?.[i];
      const reliable = raw.visibility >= this.settings.minVisibility;

      let accept = reliable;
      let snap = slot.last?.state === 'lost';
      if (reliable && slot.last && slot.last.state !== 'lost') {
        const jump = Math.hypot(raw.x - slot.last.x, raw.y - slot.last.y);
        if (jump > this.settings.maxJump && slot.outlierFrames < 2) {
          slot.outlierFrames++;
          accept = false; // treat as a glitch until it persists for 3 frames
        } else {
          if (jump > this.settings.maxJump) snap = true; // persistent → genuine move
          slot.outlierFrames = 0;
        }
      }
      if (accept && snap) {
        slot.fx.forEach((f) => f.reset());
        slot.fw.forEach((f) => f.reset());
      }

      if (accept) {
        const p = bypass
          ? { x: raw.x, y: raw.y, z: raw.z }
          : { x: slot.fx[0].filter(raw.x, t), y: slot.fx[1].filter(raw.y, t), z: slot.fx[2].filter(raw.z, t) };
        slot.last = { ...p, visibility: raw.visibility, state: 'tracked' };
        if (rawW) {
          const w = bypass
            ? { x: rawW.x, y: rawW.y, z: rawW.z }
            : { x: slot.fw[0].filter(rawW.x, t), y: slot.fw[1].filter(rawW.y, t), z: slot.fw[2].filter(rawW.z, t) };
          slot.lastWorld = { ...w, visibility: raw.visibility, state: 'tracked' };
        }
        slot.lastGoodTime = frame.captureTime;
      } else if (slot.last && frame.captureTime - slot.lastGoodTime <= this.settings.holdMs) {
        const decay = 1 - (frame.captureTime - slot.lastGoodTime) / this.settings.holdMs;
        slot.last = { ...slot.last, visibility: Math.min(slot.last.visibility, raw.visibility + 0.2) * decay + 0.01, state: 'held' };
        if (slot.lastWorld) slot.lastWorld = { ...slot.lastWorld, visibility: slot.last.visibility, state: 'held' };
      } else {
        slot.last = { x: raw.x, y: raw.y, z: raw.z, visibility: raw.visibility, state: 'lost' };
        slot.lastWorld = rawW ? { ...rawW, visibility: raw.visibility, state: 'lost' } : null;
      }
      image.push(slot.last);
      if (world) world.push(slot.lastWorld ?? { x: 0, y: 0, z: 0, visibility: 0, state: 'lost' });
    }

    let q = 0;
    const weak: string[] = [];
    for (const i of CORE_LANDMARKS) {
      const lm = image[i];
      q += lm.state === 'lost' ? 0 : lm.visibility;
      if (lm.state !== 'tracked') weak.push(LANDMARK_NAMES[i]);
    }
    const quality = q / CORE_LANDMARKS.length;
    const warnings: string[] = [];
    if (quality < 0.35) warnings.push('Tracking unreliable: step back so your whole body is in view, and improve lighting.');
    if (weak.length > 0 && weak.length <= 6) warnings.push(`Low confidence: ${weak.join(', ')}.`);
    else if (weak.length > 6) warnings.push(`Low confidence on ${weak.length} of ${CORE_LANDMARKS.length} core joints.`);

    return { image, world, quality, warnings, captureTime: frame.captureTime, inferenceMs: frame.inferenceMs };
  }
}
