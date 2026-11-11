import type { EngineStats } from '../app/VisualizerEngine';

/** Observability panel (NFR-10): frame rate, inference time, latency, confidence, state. */
export function StatusPanel({ stats }: { stats: EngineStats | null }) {
  if (!stats) return <p className="muted">Starting…</p>;
  const q = Math.round(stats.quality * 100);
  const qText = !stats.poseDetected ? 'no person' : q > 60 ? 'good' : q > 35 ? 'fair' : 'poor';
  return (
    <div className="status">
      <dl>
        <dt>State</dt>
        <dd>{stats.state}</dd>
        <dt>Source</dt>
        <dd>{stats.sourceLabel || '—'}</dd>
        <dt>Resolution</dt>
        <dd>{stats.resolution || '—'}</dd>
        <dt>Render rate</dt>
        <dd>{stats.renderFps.toFixed(0)} fps</dd>
        <dt>Inference rate</dt>
        <dd>{stats.inferenceFps.toFixed(0)} /s</dd>
        <dt>Inference time</dt>
        <dd>{stats.inferenceMs.toFixed(1)} ms</dd>
        <dt>Capture → overlay</dt>
        <dd>{stats.latencyMs ? `${stats.latencyMs.toFixed(0)} ms` : '—'}</dd>
        <dt>Tracking</dt>
        <dd>
          <meter min={0} max={100} low={36} high={60} optimum={100} value={q} aria-label="Tracking quality" /> {q}% ({qText})
        </dd>
        <dt>Landmarks</dt>
        <dd>
          {stats.counts.tracked} tracked · {stats.counts.held} held · {stats.counts.lost} lost
        </dd>
        <dt>Model</dt>
        <dd>{stats.modelInfo || '—'}</dd>
      </dl>
      <p className="muted small">
        Targets on a capable laptop: ≥24 fps rendering, &lt;100 ms capture-to-overlay. Values are measured live on this device.
      </p>
    </div>
  );
}
