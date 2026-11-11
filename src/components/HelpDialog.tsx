import { useEffect, useRef } from 'react';
import { APP_VERSION, ATTRIBUTIONS, SPEC_VERSION } from '../app/version';

export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog ref={ref} className="help" onClose={onClose} aria-labelledby="help-title">
      <header>
        <h2 id="help-title">Help &amp; about</h2>
        <button className="btn ghost" onClick={onClose} aria-label="Close help">
          ✕
        </button>
      </header>
      <div className="help-body">
        <h3>How to use</h3>
        <ol>
          <li>Press <b>Start camera</b> and allow camera access (or use <b>Demo mode</b> / a video file).</li>
          <li>Stand 2–3 m away, facing the camera, with your whole body visible.</li>
          <li>Use <b>Layers</b> to show the skeleton, spine, rib cage, pelvis, skull, joint markers and labels.</li>
          <li>If the model sits slightly off, fine-tune it with <b>Alignment</b> (scale, offset, rotation, opacity).</li>
          <li>Rotate and zoom the anatomy independently in the <b>3D inspector</b>.</li>
          <li>Press <b>Stop</b> to switch the camera off and clear the session.</li>
        </ol>
        <h3>Keyboard</h3>
        <ul>
          <li><kbd>Space</kbd> pause / resume tracking</li>
          <li><kbd>S</kbd> take a snapshot</li>
          <li><kbd>L</kbd> toggle labels · <kbd>J</kbd> toggle joint markers · <kbd>D</kbd> toggle raw landmarks</li>
          <li><kbd>P</kbd> show/hide the pipeline · <kbd>1</kbd>–<kbd>6</kbd> show a pipeline stage full-size · <kbd>Esc</kbd> back to composite</li>
          <li>3D inspector: focus it and use arrow keys, or drag to rotate and scroll to zoom</li>
        </ul>
        <h3>The live pipeline</h3>
        <p>
          The strip under the video shows every processing step for the current frame as it happens:
          <b> 1 camera frame → 2 pose inference</b> (33 landmarks, dot size = confidence) <b>→ 3 tracking filter</b> (raw vs
          smoothed, held/lost joints) <b>→ 4 anatomy alignment</b> (observed vs inferred joints, spine curve, torso axes)
          <b> → 5 3D render → 6 composite</b>. A green dot means the stage just ran; the bar shows how many milliseconds each
          step costs per frame against the 33 ms (30 fps) budget. Click a stage to inspect it full-size.
        </p>
        <h3>Reading the display</h3>
        <ul>
          <li><b>Raw landmarks</b> (yellow dots, toggle in Settings) are what the pose model actually observed.</li>
          <li><b>The skeleton</b> is a generic model inferred from those landmarks. Spine, ribs, pelvis and skull are never observed directly.</li>
          <li>Bones drawn <b>faint</b> rely on landmarks that are briefly occluded; they disappear if tracking is lost. Joint markers turn from solid to <b>wireframe</b> when confidence is low.</li>
        </ul>
        <h3>Known limitations</h3>
        <ul>
          <li>Not an X-ray, scan or diagnostic tool. It cannot reveal bones, organs, fractures, density or pathology.</li>
          <li>A single RGB camera confuses depth, left/right and overlapping limbs. Works best facing the camera; side views, twisting and sitting reduce accuracy.</li>
          <li>Body proportions are generic, not yours. Angles are 2D/3D estimates from a pose model and are not clinical goniometry.</li>
          <li>One person at a time. Performance depends on your device; see the Status panel for measured frame rate and latency.</li>
        </ul>
        <h3>Privacy</h3>
        <p>
          Camera frames are processed locally in your browser and are never uploaded. The pose model file is downloaded
          once (from this site's <code>/models</code> folder if present, otherwise from Google's public model storage);
          no images are sent with that request. Snapshots and measurement exports are created only when you ask, and are
          saved to your own device. Display preferences are stored in this browser; use "Clear local data" to remove them.
        </p>
        <h3>Attribution &amp; licences</h3>
        <table className="attrib">
          <thead>
            <tr><th>Component</th><th>Use</th><th>Licence</th></tr>
          </thead>
          <tbody>
            {ATTRIBUTIONS.map((a) => (
              <tr key={a.name}>
                <td>{a.url ? <a href={a.url} target="_blank" rel="noreferrer">{a.name}</a> : a.name}</td>
                <td>{a.use}</td>
                <td>{a.licence}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">Version {APP_VERSION} · implements {SPEC_VERSION}</p>
      </div>
    </dialog>
  );
}
