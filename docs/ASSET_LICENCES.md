# Asset & model provenance (FR-07, FR-20, AC-12)

| Asset | Source | Licence | Distributed with app? | Notes |
| --- | --- | --- | --- | --- |
| Reference skeleton geometry | Generated procedurally in `src/rendering/boneGeometry.ts` | MIT (this project) | Yes (code) | Schematic, educational; no external 3D asset used |
| MediaPipe Tasks Vision WASM runtime | npm `@mediapipe/tasks-vision` (copied to `public/mediapipe/wasm` on install) | Apache-2.0, © Google LLC | Yes | |
| Pose Landmarker models (`pose_landmarker_{lite,full,heavy}.task`) | `https://storage.googleapis.com/mediapipe-models/pose_landmarker/…` | Apache-2.0, © Google LLC | Optional (`npm run fetch-models`) | Loaded from `/models` if present, else from Google storage |
| three.js | npm `three` | MIT | Yes (bundled) | |
| React | npm `react`, `react-dom` | MIT | Yes (bundled) | |

Before adding any third-party anatomy model (GLB/GLTF), record: source URL, author, licence text, permitted use (commercial / modification / redistribution), attribution wording, version and file hash. Do not assume that a model found online is free for commercial use.
