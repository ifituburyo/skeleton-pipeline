import { useRef } from 'react';

interface Props {
  onStartCamera: () => void;
  onStartDemo: () => void;
  onStartVideo: (f: File) => void;
  onHelp: () => void;
}

export function Home({ onStartCamera, onStartDemo, onStartVideo, onHelp }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <main className="home" id="main">
      <section className="hero">
        <p className="eyebrow">Educational &amp; research prototype</p>
        <h1>AR Anatomy Visualizer</h1>
        <p className="lead">
          Stand in front of your webcam and see a labelled 3D <strong>reference skeleton</strong> follow your movement
          in real time. Explore the spine, rib cage, pelvis and limbs, and watch estimated joint angles change as you move.
        </p>
      </section>

      <section className="cards" aria-label="Before you start">
        <article className="card warn">
          <h2>What this is — and isn't</h2>
          <ul>
            <li>
              A normal camera <strong>cannot see inside the body</strong>. This is <strong>not an X-ray</strong> and not a scan.
            </li>
            <li>The skeleton is a generic model positioned from estimated <em>external</em> body landmarks.</li>
            <li>It cannot show your actual bones, fractures, bone density or any internal condition.</li>
            <li>Angles and posture values are rough estimates for learning — not clinical measurements.</li>
          </ul>
        </article>
        <article className="card">
          <h2>Your privacy</h2>
          <ul>
            <li>Video is processed <strong>entirely in this browser</strong>. Nothing is uploaded.</li>
            <li>Nothing is recorded or saved unless you press Snapshot or export measurements yourself.</li>
            <li>Press Stop at any time to switch the camera off and clear session data.</li>
          </ul>
        </article>
        <article className="card">
          <h2>For best tracking</h2>
          <ul>
            <li>Stand 2–3 m from the camera, facing it, whole body in view.</li>
            <li>Use even, front lighting and a plain background.</li>
            <li>Fitted clothing helps; one person in frame at a time.</li>
          </ul>
        </article>
      </section>

      <section className="start" aria-label="Start">
        <button className="btn primary big" onClick={onStartCamera}>
          Start camera
        </button>
        <p className="hint">Your browser will ask for camera permission. The camera is used only to estimate body pose on this device.</p>
        <div className="row">
          <button className="btn" onClick={onStartDemo}>
            Demo mode (no camera)
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            Analyse a video file…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="video/*"
            hidden
            aria-label="Choose a video file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onStartVideo(f);
              e.target.value = '';
            }}
          />
          <button className="btn ghost" onClick={onHelp}>
            Help &amp; about
          </button>
        </div>
      </section>
    </main>
  );
}
