# Models

This document describes the machine-learning models used by the AR Anatomy Visualizer, how they are loaded and configured, and which alternatives were considered.

## Summary

| | |
| --- | --- |
| Task | Single-person 2D + 3D human pose estimation from an RGB webcam |
| Model | Google **MediaPipe Pose Landmarker** (BlazePose GHUM), variants `lite` / `full` / `heavy` |
| Runtime | `@mediapipe/tasks-vision` (WASM) in the browser, WebGL GPU delegate with automatic CPU fallback |
| Output | 33 landmarks per frame, in image space (normalised x, y, relative z) and world space (metres, hip-centred), each with a visibility score |
| Where it runs | **On the user's device only.** There is no backend and frames are never uploaded |
| Licence | Apache-2.0, © Google LLC |

## Model variants

| Variant | File | Size | Trade-off |
| --- | --- | --- | --- |
| `lite` (**default**) | `pose_landmarker_lite.task` | ~5.8 MB | Fastest. Recommended for laptops without a discrete GPU |
| `full` | `pose_landmarker_full.task` | ~9.4 MB | Balanced accuracy and speed |
| `heavy` | `pose_landmarker_heavy.task` | ~30 MB | Most accurate, slowest. Use only on capable hardware |

All variants are the float16 builds from `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_<variant>/float16/latest/`.

The variant is chosen at runtime under **Settings → Model** (`src/components/LiveView.tsx`). The default is set in `DEFAULT_SETTINGS.modelVariant` (`src/app/VisualizerEngine.ts`).

### Getting the model files

Model files are **not committed** (`public/models/*.task` is in `.gitignore`).

```bash
npm run fetch-models            # lite + full into public/models/
npm run fetch-models -- heavy   # also heavy
```

At startup `MediaPipePoseEstimator` first looks for `/models/pose_landmarker_<variant>.task` on its own origin. If the file is missing, it downloads it from Google's model storage. Self-hosting the files lets the app run offline and lets you remove `storage.googleapis.com` from the Content-Security-Policy.

## Inference configuration

Defined in `src/vision/MediaPipePoseEstimator.ts`:

| Option | Value | Meaning |
| --- | --- | --- |
| `runningMode` | `VIDEO` | Uses temporal tracking between frames; timestamps are forced to be strictly increasing |
| `numPoses` | `1` | One person at a time |
| `minPoseDetectionConfidence` | `0.5` | Detector threshold for finding a person |
| `minPosePresenceConfidence` | `0.5` | Threshold for keeping a detected pose |
| `minTrackingConfidence` | `0.5` | Below this, the detector re-runs instead of tracking |
| `delegate` | `GPU` → `CPU` | GPU (WebGL) is tried first; on failure the estimator retries on CPU |
| Max inference rate | 30 fps (adjustable) | Stale frames are dropped, never queued |

## Post-processing (not ML)

The raw landmarks go through deterministic post-processing before rendering:

1. **Confidence gating & outlier rejection** (`src/tracking/LandmarkTracker.ts`): landmarks below `minVisibility` (default 0.5) are held for up to 500 ms, then marked lost. Jumps larger than `maxJump` (0.18 of frame) are rejected.
2. **One Euro filter** (`src/tracking/OneEuroFilter.ts`; Casiez, Roussel & Vogel, CHI 2012): adaptive low-pass smoothing per coordinate. The UI "smoothing" slider (default 0.6) maps to `minCutoff` and `beta`.
3. **Rig mapping** (`src/anatomy/rigMapping.ts`): landmarks → joints, torso/head frames and an inferred spine that drive the procedural skeleton.

The skeleton is **illustrative**. Spine, ribs, pelvis and skull positions are inferred from external landmarks using generic proportions; they are not measured.

## Swapping or adding a model

Every pose source implements the `PoseEstimator` interface (`src/types/pose.ts`):

```ts
interface PoseEstimator {
  readonly name: string;
  init(): Promise<void>;
  estimate(source: HTMLVideoElement | null, timestampMs: number): PoseFrame | null;
  close(): void;
}
```

A new model (e.g. MoveNet, RTMPose via ONNX Runtime Web) only needs to return the 33 BlazePose-indexed landmarks defined in `src/anatomy/landmarks.ts`, or map its own keypoints to them. `DemoPoseSource` is a second implementation that produces synthetic poses without a camera.

## Alternatives considered

### MONAI — not used

[MONAI](https://monai.io/) is a PyTorch framework for **medical imaging**: segmentation, classification and registration of CT, MRI, X-ray and other DICOM/NIfTI volumes. It does not fit this project:

| | This project | MONAI |
| --- | --- | --- |
| Input | Live RGB webcam frames | Medical scans (CT/MRI volumes, radiographs) |
| Task | Real-time external body keypoints | Organ/tissue segmentation, lesion detection |
| Runtime | Browser (WASM/WebGL), on-device | Python + PyTorch, typically GPU servers |
| Latency budget | ~33 ms per frame | Seconds to minutes per volume |
| Privacy model | Frames never leave the device | Would need a backend that receives medical images |

A webcam cannot see bones, so no medical-imaging model can add anatomical accuracy to the live overlay.

MONAI would become relevant only if the project adds a feature that works on **real medical scans**, for example:

- segmenting bones from a user-supplied CT to build a **personalised skeleton mesh** instead of the generic procedural one;
- registering that mesh to the live pose.

That would be an offline, server-side step in the deferred FastAPI backend (`server/README.md`), with consent, retention, encryption and deletion defined first. It would not replace MediaPipe in the real-time loop.

### Other pose models

| Model | Why not (for now) |
| --- | --- |
| TensorFlow.js MoveNet | Only 17 keypoints and no world-space 3D output |
| RTMPose / ViTPose (ONNX) | Good accuracy, but needs ONNX Runtime Web plus custom pre/post-processing; candidate for a future `PoseEstimator` |
| OpenPose | Server-side, heavy, restrictive licence for commercial use |

## Limitations

- A single RGB camera gives ambiguous depth. Left/right limbs and overlapping limbs can be confused. Accuracy is best front-on and drops in side views, when twisting and when sitting.
- World landmarks are hip-centred estimates in metres, not calibrated measurements. Joint angles are educational, not clinical.
- Performance must be measured on the target hardware. The Status panel shows inference time, fps and latency live.
