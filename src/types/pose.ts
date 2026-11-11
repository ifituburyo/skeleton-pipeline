/**
 * Shared pose types. Coordinates follow the MediaPipe Pose (BlazePose) 33-landmark
 * convention so that any pose source (camera, video file, synthetic demo) can feed
 * the same tracking → anatomy → rendering pipeline.
 */

/** A single observed landmark. */
export interface Landmark {
  /** Image x in [0,1] (left → right of the *unmirrored* frame). For world landmarks: metres. */
  x: number;
  /** Image y in [0,1] (top → bottom). For world landmarks: metres (y down). */
  y: number;
  /** Relative depth. Image: roughly same scale as x, smaller = closer. World: metres. */
  z: number;
  /** Likelihood the landmark is visible (0–1). */
  visibility: number;
}

/** One pose estimate for one frame. */
export interface PoseFrame {
  /** Normalised image landmarks (33). */
  image: Landmark[];
  /** Metric world landmarks centred between the hips (33), if the source provides them. */
  world: Landmark[] | null;
  /** performance.now() timestamp at which the source frame was captured / presented. */
  captureTime: number;
  /** Wall time the estimator spent on this frame, ms. */
  inferenceMs: number;
}

/** Interface implemented by every pose source (NFR-08 – separation behind interfaces). */
export interface PoseEstimator {
  readonly name: string;
  /** Load model / resources. Throws a {@link PipelineError} on failure. */
  init(): Promise<void>;
  /** Estimate a pose from the given source at the given timestamp; null = no person. */
  estimate(source: HTMLVideoElement | null, timestampMs: number): PoseFrame | null;
  close(): void;
}

/** Point in the overlay / inspector 3D space. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type PipelineErrorKind =
  | 'insecure-context'
  | 'unsupported-browser'
  | 'camera-denied'
  | 'camera-not-found'
  | 'camera-busy'
  | 'camera-disconnected'
  | 'camera-unknown'
  | 'model-load'
  | 'webgl-unavailable'
  | 'tracking-lost';

export class PipelineError extends Error {
  readonly kind: PipelineErrorKind;
  constructor(kind: PipelineErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = 'PipelineError';
  }
}
