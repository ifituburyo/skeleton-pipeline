import type { EngineStats } from '../app/VisualizerEngine';
import type { Measurement } from '../anatomy/measurements';

function Row({ m, signed }: { m: Measurement; signed?: boolean }) {
  return (
    <tr className={m.reliable ? '' : 'unreliable'}>
      <th scope="row">{m.label}</th>
      <td className="num">
        {signed && m.value > 0 ? '+' : ''}
        {m.value.toFixed(0)}°
      </td>
      <td className="num">{Math.round(m.confidence * 100)}%</td>
      <td>{m.reliable ? 'ok' : 'low conf.'}</td>
    </tr>
  );
}

export function AnalysisPanel(props: {
  stats: EngineStats | null;
  onRecord: (on: boolean) => void;
  onExport: () => void;
  onClear: () => void;
}) {
  const { stats, onRecord, onExport, onClear } = props;
  const m = stats?.measurements;
  return (
    <div className="analysis">
      <p className="notice small">
        Estimated from a single camera using a pose model. Educational only — <strong>not clinical measurements</strong> and not a
        substitute for clinical assessment.
      </p>
      {!m ? (
        <p className="muted">No pose yet.</p>
      ) : (
        <>
          <table className="metrics">
            <caption>Joint angles ({m.angles[0]?.basis ?? '2D'} estimate)</caption>
            <thead>
              <tr><th scope="col">Joint</th><th scope="col">Angle</th><th scope="col">Conf.</th><th scope="col">Quality</th></tr>
            </thead>
            <tbody>{m.angles.map((a) => <Row key={a.id} m={a} />)}</tbody>
          </table>
          <table className="metrics">
            <caption>Posture (image plane; 0° = level / upright)</caption>
            <tbody>{m.posture.map((a) => <Row key={a.id} m={a} signed />)}</tbody>
          </table>
          <table className="metrics">
            <caption>Left/right symmetry indicators</caption>
            <tbody>
              {m.symmetry.map((s) => (
                <tr key={s.id} className={s.reliable ? '' : 'unreliable'}>
                  <th scope="row">{s.label}</th>
                  <td className="num">{s.difference.toFixed(0)}°</td>
                  <td>{s.reliable ? 'ok' : 'low conf.'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <div className="row wrap">
        <button className="btn small" aria-pressed={stats?.recording ?? false} onClick={() => onRecord(!stats?.recording)}>
          {stats?.recording ? '■ Stop recording' : '● Record angles'}
        </button>
        <button className="btn small" disabled={!stats?.recordedSamples} onClick={onExport}>
          Export CSV ({stats?.recordedSamples ?? 0})
        </button>
        <button className="btn small ghost" disabled={!stats?.recordedSamples} onClick={onClear}>
          Discard
        </button>
      </div>
      <p className="muted small">Recording keeps angle values (no images) in this tab's memory at ~5 Hz until you export or discard them.</p>
    </div>
  );
}
