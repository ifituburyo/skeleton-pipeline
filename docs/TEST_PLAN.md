# Acceptance checklist (spec §11–12)

Legend: **A** = automated (`npm test` / `npm run e2e`), **M** = manual on the reference device.

| ID | Criterion | How | Status in dev |
| --- | --- | --- | --- |
| AC-01 | Camera permission → live preview | A (fake camera) + M (real webcam) | A ✓ |
| AC-02 | Start / pause / stop; indicator updates | A + M | A ✓ |
| AC-03 | Landmarks for well-lit front-facing person | M (+ video-file mode with consented clips) | Checked on a public-domain photo via fake camera |
| AC-04 | Occlusion doesn't cause jumps; warning visible | A (unit: hold + outlier rejection) + M (Demo → "Simulate occlusion") | A ✓ |
| AC-05 | Skeleton follows major movement | M (recorded sequence + reviewer) | Demo ✓ |
| AC-06 | Alignment controls + reset | A | ✓ |
| AC-07 | Layer & label toggles | A | ✓ |
| AC-08 | ≥24 fps render over 60 s; inference & latency logged | M on nominated laptop (Status panel) | **To do on reference hardware** |
| AC-09 | No raw-video upload | A (no non-GET requests; CSP blocks all but self + model storage) + M (DevTools Network) | ✓ |
| AC-10 | Stop releases camera, clears buffers | A (`srcObject === null`) + M (browser camera indicator off) | ✓ |
| AC-11 | Denial / unsupported / model-load errors explained | A (model-load) + M (deny permission, unplug camera, http:// on LAN) | partial A ✓ |
| AC-12 | Asset provenance documented | `docs/ASSET_LICENCES.md` | ✓ |
| AC-13 | Keyboard & accessible labels | M (Tab through, screen reader) | – |
| AC-14 | Persistent limitation notice | A | ✓ |

## Manual test matrix (record device, browser version, lighting, distance, framing, model, results)

- Camera: granted/denied, no camera, camera in use by another app, switch camera, unplug while running, background tab.
- Pose: front, 45°, side; dim/bright light; partial body; loose clothing; second person entering frame.
- Alignment: tall/short users, 1.5 m vs 3 m, mirror on/off, 4:3 vs 16:9, arms overhead, squat, turning.
- Rendering: window resize, low-end GPU, WebGL disabled.
- Performance: lite vs full vs heavy; GPU vs CPU; 640×480 vs 1280×720 — record render fps, inference ms, latency.
