/**
 * MediaPipe Pose Landmarker adapter (FR-04). Runs fully in the browser (WASM +
 * WebGL/CPU); frames never leave the device (NFR-06, AC-09).
 *
 * Model weights: Google MediaPipe, Apache-2.0. Loaded from /models/ if present
 * (run `npm run fetch-models`), otherwise from Google's model storage.
 */
import type { PoseLandmarker as PoseLandmarkerT } from '@mediapipe/tasks-vision';
import { PipelineError, type Landmark, type PoseEstimator, type PoseFrame } from '../types/pose';

export type PoseModelVariant = 'lite' | 'full' | 'heavy';
export type Delegate = 'GPU' | 'CPU';

const remoteModelUrl = (v: PoseModelVariant) =>
  `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${v}/float16/latest/pose_landmarker_${v}.task`;

async function resolveModelUrl(v: PoseModelVariant): Promise<{ url: string; source: 'local' | 'remote' }> {
  const local = `${import.meta.env.BASE_URL}models/pose_landmarker_${v}.task`;
  try {
    const res = await fetch(local, { method: 'HEAD' });
    const type = res.headers.get('content-type') ?? '';
    // Vite's SPA fallback returns index.html for missing files — reject that.
    if (res.ok && !type.includes('text/html')) return { url: local, source: 'local' };
  } catch {
    /* fall through to remote */
  }
  return { url: remoteModelUrl(v), source: 'remote' };
}

export class MediaPipePoseEstimator implements PoseEstimator {
  readonly name: string;
  private landmarker: PoseLandmarkerT | null = null;
  private lastTs = -1;
  readonly variant: PoseModelVariant;
  private delegate: Delegate;
  modelSource: 'local' | 'remote' | null = null;
  activeDelegate: Delegate | null = null;

  constructor(variant: PoseModelVariant = 'lite', delegate: Delegate = 'GPU') {
    this.variant = variant;
    this.delegate = delegate;
    this.name = `MediaPipe Pose Landmarker (${variant})`;
  }

  async init(): Promise<void> {
    let vision;
    try {
      vision = await import('@mediapipe/tasks-vision');
    } catch (e) {
      throw new PipelineError('model-load', `Could not load the MediaPipe library: ${String(e)}`);
    }
    const { FilesetResolver, PoseLandmarker } = vision;
    let fileset;
    try {
      fileset = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}mediapipe/wasm`);
    } catch (e) {
      throw new PipelineError('model-load', `Could not load the MediaPipe WASM runtime (run "npm install" again): ${String(e)}`);
    }
    const { url, source } = await resolveModelUrl(this.variant);
    this.modelSource = source;
    const create = (delegate: Delegate) =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: url, delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputSegmentationMasks: false,
      });
    try {
      this.landmarker = await create(this.delegate);
      this.activeDelegate = this.delegate;
    } catch (gpuErr) {
      if (this.delegate === 'GPU') {
        try {
          this.landmarker = await create('CPU');
          this.activeDelegate = 'CPU';
          return;
        } catch {
          /* report original error below */
        }
      }
      throw new PipelineError(
        'model-load',
        `The pose model could not be loaded from ${source === 'local' ? 'this server' : 'Google model storage'}. ` +
          `Check your internet connection or run "npm run fetch-models" for offline use. (${String(gpuErr)})`,
      );
    }
  }

  estimate(source: HTMLVideoElement | null, timestampMs: number): PoseFrame | null {
    if (!this.landmarker || !source || source.readyState < 2 || source.videoWidth === 0) return null;
    // MediaPipe VIDEO mode requires strictly increasing timestamps.
    const ts = Math.max(Math.round(timestampMs), this.lastTs + 1);
    this.lastTs = ts;
    const t0 = performance.now();
    const res = this.landmarker.detectForVideo(source, ts);
    const inferenceMs = performance.now() - t0;
    if (!res.landmarks?.length) return null;
    const map = (l: { x: number; y: number; z: number; visibility?: number }): Landmark => ({
      x: l.x,
      y: l.y,
      z: l.z,
      visibility: l.visibility ?? 1,
    });
    const image = res.landmarks[0].map(map);
    const world = res.worldLandmarks?.[0]?.map((l, i) => ({ ...map(l), visibility: image[i].visibility })) ?? null;
    return { image, world, captureTime: timestampMs, inferenceMs };
  }

  close(): void {
    this.landmarker?.close();
    this.landmarker = null;
    this.lastTs = -1;
  }
}
