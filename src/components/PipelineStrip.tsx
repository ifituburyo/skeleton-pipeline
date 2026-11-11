import { Fragment } from 'react';
import type { EngineStats } from '../app/VisualizerEngine';
import { STAGES, STAGE_INFO, type Stage } from '../rendering/pipelineStages';

interface Props {
  stats: EngineStats | null;
  viewMode: Stage;
  onSelect: (s: Stage) => void;
  registerCanvas: (s: Stage, c: HTMLCanvasElement | null) => void;
}

const fmt = (ms: number) => (ms < 1 ? `${ms.toFixed(2)} ms` : `${ms.toFixed(1)} ms`);

/**
 * Live view of every processing stage for the current frame (click to enlarge),
 * plus a per-frame timing waterfall.
 */
export function PipelineStrip({ stats, viewMode, onSelect, registerCanvas }: Props) {
  const m = stats?.stageMs;
  const timing: Record<Stage, string> = {
    camera: m ? `age ${fmt(m.capture)}` : '—',
    inference: m ? fmt(m.inference) : '—',
    tracking: m ? fmt(m.tracking) : '—',
    anatomy: m ? fmt(m.anatomy) : '—',
    model: m ? fmt(m.render) : '—',
    composite: stats?.latencyMs ? `total ${fmt(stats.latencyMs)}` : '—',
  };
  const live = (s: Stage) => !!stats && stats.state === 'running' && stats.now - stats.stageRunAt[s] < 400;

  const segs = m
    ? [
        { k: 'capture', label: 'frame wait', ms: m.capture, cls: 'w-cap' },
        { k: 'inference', label: 'inference', ms: m.inference, cls: 'w-inf' },
        { k: 'tracking', label: 'filter', ms: m.tracking, cls: 'w-trk' },
        { k: 'anatomy', label: 'alignment', ms: m.anatomy, cls: 'w-ana' },
        { k: 'render', label: 'render', ms: m.render, cls: 'w-ren' },
      ]
    : [];
  const total = segs.reduce((a, b) => a + b.ms, 0);
  const budget = Math.max(1000 / 30, total);

  return (
    <section className="pipeline" aria-label="Processing pipeline, live">
      <div className="pipeline-cards">
        {STAGES.map((s, i) => (
          <Fragment key={s}>
            {i > 0 && <span className="pipe-arrow" aria-hidden="true">→</span>}
            <button
              className={`pipe-card ${viewMode === s ? 'selected' : ''} ${live(s) ? 'live' : ''}`}
              aria-pressed={viewMode === s}
              title={`${STAGE_INFO[s].detail}. Click to show this stage in the main view.`}
              onClick={() => onSelect(s)}
            >
              <span className="pipe-head">
                <span className="pipe-dot" aria-hidden="true" />
                {STAGE_INFO[s].title}
              </span>
              <canvas ref={(c) => registerCanvas(s, c)} className="pipe-canvas" aria-hidden="true" />
              <span className="pipe-time">
                {timing[s]}
                <span className="sr-only">{live(s) ? ', active' : ', idle'}</span>
              </span>
            </button>
          </Fragment>
        ))}
      </div>
      {segs.length > 0 && total > 0 && (
        <div className="waterfall" role="img" aria-label={`Per-frame time: ${segs.map((s) => `${s.label} ${s.ms.toFixed(1)} ms`).join(', ')}`}>
          <div className="wf-bar">
            {segs.map((s) => (
              <span key={s.k} className={`wf-seg ${s.cls}`} style={{ width: `${(s.ms / budget) * 100}%` }} />
            ))}
            <span className="wf-budget" style={{ left: `${((1000 / 30) / budget) * 100}%` }} title="33 ms = 30 fps budget" />
          </div>
          <div className="wf-legend">
            {segs.map((s) => (
              <span key={s.k}>
                <i className={`wf-swatch ${s.cls}`} />
                {s.label} {fmt(s.ms)}
              </span>
            ))}
            <span className="muted">| line = 33 ms (30 fps budget)</span>
          </div>
        </div>
      )}
    </section>
  );
}
