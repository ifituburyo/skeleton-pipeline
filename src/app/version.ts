export const APP_VERSION = '0.1.0';
export const SPEC_VERSION = 'PRD & Architecture Specification v1.0 (11 Nov 2026)';

/** Third-party components and their licences (FR-20, AC-12). */
export const ATTRIBUTIONS: { name: string; use: string; licence: string; url: string }[] = [
  {
    name: 'Reference skeleton geometry',
    use: 'Procedurally generated in code by this project (no external 3D asset)',
    licence: 'MIT (this project)',
    url: '',
  },
  {
    name: 'MediaPipe Tasks Vision + Pose Landmarker models',
    use: 'Pose estimation (WASM runtime + model weights, run locally in the browser)',
    licence: 'Apache License 2.0 — © Google LLC',
    url: 'https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker',
  },
  { name: 'three.js', use: 'WebGL rendering', licence: 'MIT — © three.js authors', url: 'https://threejs.org' },
  { name: 'React', use: 'User interface', licence: 'MIT — © Meta Platforms, Inc.', url: 'https://react.dev' },
];
