import { useCallback, useEffect, useRef, useState } from 'react';
import { VisualizerEngine, type EngineSettings, type EngineStats, type SourceKind } from '../app/VisualizerEngine';
import { DEFAULT_ALIGNMENT } from '../rendering/OverlayRenderer';
import { LAYER_NAMES, type LayerName } from '../rendering/SkeletonModel';
import type { CameraInfo } from '../camera/CameraService';
import type { PipelineError } from '../types/pose';
import { clearPreferences } from '../app/preferences';
import { Panel, Select, Slider, Toggle } from './controls';
import { AnalysisPanel } from './AnalysisPanel';
import { StatusPanel } from './StatusPanel';
import { PipelineStrip } from './PipelineStrip';
import { STAGE_INFO, type Stage } from '../rendering/pipelineStages';

export interface SourceRequest {
  kind: SourceKind;
  file?: File;
  /** Increments to force a restart of the same kind. */
  nonce: number;
}

interface Props {
  request: SourceRequest;
  settings: EngineSettings;
  onSettings: (s: EngineSettings) => void;
  onExit: () => void;
  onHelp: () => void;
  onRequest: (r: Omit<SourceRequest, 'nonce'>) => void;
}

const LAYER_LABELS: Record<LayerName, string> = {
  skeleton: 'Limbs, clavicles & scapulae',
  spine: 'Spine (vertebrae)',
  ribcage: 'Rib cage & sternum',
  pelvis: 'Pelvis',
  skull: 'Skull',
  joints: 'Joint markers (observed)',
  labels: 'Labels',
};

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

export function LiveView({ request, settings, onSettings, onExit, onHelp, onRequest }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const bgRef = useRef<HTMLCanvasElement>(null);
  const debugRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const inspectorRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const engineRef = useRef<VisualizerEngine | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const [stats, setStats] = useState<EngineStats | null>(null);
  const [error, setError] = useState<PipelineError | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [cameras, setCameras] = useState<CameraInfo[]>([]);
  const [cameraId, setCameraId] = useState<string>('');
  const [dimVideo, setDimVideo] = useState(true);
  const [announce, setAnnounce] = useState('');
  const [viewMode, setViewMode] = useState<Stage>('composite');
  const [showPipeline, setShowPipeline] = useState(true);
  const stageViewRef = useRef<HTMLCanvasElement>(null);
  const thumbsRef = useRef<Partial<Record<Stage, HTMLCanvasElement>>>({});
  const registerThumb = useCallback((st: Stage, c: HTMLCanvasElement | null) => {
    if (c) thumbsRef.current[st] = c;
    else delete thumbsRef.current[st];
  }, []);

  // Create the engine once.
  useEffect(() => {
    let engine: VisualizerEngine;
    try {
      engine = new VisualizerEngine(
        {
          stage: stageRef.current!,
          video: videoRef.current!,
          background: bgRef.current!,
          debug: debugRef.current!,
          overlayHost: overlayRef.current!,
          inspectorHost: inspectorRef.current,
        },
        settingsRef.current,
      );
    } catch (e) {
      setFatal((e as Error).message);
      return;
    }
    engineRef.current = engine;
    engine.setPipeline({ thumbs: thumbsRef.current, stageView: stageViewRef.current! });
    const offStats = engine.onStats(setStats);
    const offErr = engine.onError(setError);
    return () => {
      offStats();
      offErr();
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  // Start / switch source when the request changes.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    setError(null);
    void engine.start(request.kind, { file: request.file, deviceId: cameraId || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  useEffect(() => {
    engineRef.current?.setViewMode(viewMode);
  }, [viewMode]);

  // Push settings into the engine.
  useEffect(() => {
    engineRef.current?.updateSettings(settings);
  }, [settings]);

  // Camera list (labels are only available after permission is granted).
  useEffect(() => {
    if (stats?.source === 'camera' && stats.state === 'running' && cameras.length === 0) {
      void engineRef.current?.listCameras().then(setCameras);
    }
  }, [stats?.source, stats?.state, cameras.length]);

  const set = useCallback(<K extends keyof EngineSettings>(k: K, v: EngineSettings[K]) => onSettings({ ...settingsRef.current, [k]: v }), [onSettings]);

  const running = stats?.state === 'running';
  const paused = stats?.state === 'paused';
  const active = running || paused;

  const togglePause = useCallback(() => {
    const e = engineRef.current;
    if (!e || !stats) return;
    e.setPaused(stats.state === 'running');
    setAnnounce(stats.state === 'running' ? 'Tracking paused' : 'Tracking resumed');
  }, [stats]);

  const snapshot = useCallback(async () => {
    const blob = await engineRef.current?.snapshot();
    if (blob) {
      download(blob, `anatomy-snapshot-${stamp()}.png`);
      setAnnounce('Snapshot saved to your downloads');
    }
  }, []);

  const stop = useCallback(() => {
    engineRef.current?.stop();
    setAnnounce('Camera stopped and session data cleared');
  }, []);

  // Keyboard shortcuts (FR-19).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, select, textarea, button, dialog, summary, canvas')) return;
      if (e.key === ' ') {
        e.preventDefault();
        togglePause();
      } else if (e.key === 's' || e.key === 'S') void snapshot();
      else if (e.key === 'l' || e.key === 'L') set('layers', { ...settingsRef.current.layers, labels: !settingsRef.current.layers.labels });
      else if (e.key === 'j' || e.key === 'J') set('layers', { ...settingsRef.current.layers, joints: !settingsRef.current.layers.joints });
      else if (e.key === 'd' || e.key === 'D') set('showLandmarks', !settingsRef.current.showLandmarks);
      else if (e.key === 'p' || e.key === 'P') setShowPipeline((v) => !v);
      else if (e.key >= '1' && e.key <= '6') setViewMode((['camera', 'inference', 'tracking', 'anatomy', 'model', 'composite'] as Stage[])[Number(e.key) - 1]);
      else if (e.key === 'Escape') setViewMode('composite');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePause, snapshot, set]);

  const al = settings.alignment;
  const setAl = (patch: Partial<typeof al>) => set('alignment', { ...al, ...patch });
  const isDemo = stats?.source === 'demo' || request.kind === 'demo';
  const showFrame = viewMode === 'composite' || viewMode === 'camera';
  const showOverlay = viewMode === 'composite' || viewMode === 'model';
  const showStageView = viewMode === 'inference' || viewMode === 'tracking' || viewMode === 'anatomy';

  if (fatal) {
    return (
      <main className="fatal" id="main" role="alert">
        <h1>This device can't display the 3D view</h1>
        <p>{fatal}</p>
        <button className="btn" onClick={onExit}>Back</button>
      </main>
    );
  }

  return (
    <main className="live" id="main">
      <section className="stage-wrap" aria-label="Live visualiser">
        <div className="stage-area">
          <div className="stage" ref={stageRef}>
            <video
              ref={videoRef}
              className={`video ${settings.mirror ? 'mirrored' : ''} ${dimVideo && viewMode === 'composite' ? 'dimmed' : ''} ${isDemo || !showFrame ? 'hidden' : ''}`}
              muted
              playsInline
              aria-label="Live camera preview"
            />
            <canvas ref={bgRef} className={`bg-canvas ${isDemo && showFrame ? '' : 'hidden'}`} aria-hidden="true" />
            <div ref={overlayRef} className={`overlay-host ${showOverlay ? '' : 'hidden'}`} />
            <canvas ref={debugRef} className={`debug-canvas ${viewMode === 'composite' ? '' : 'hidden'}`} aria-hidden="true" />
            <canvas ref={stageViewRef} className={`stage-view ${showStageView ? '' : 'hidden'}`} aria-hidden="true" />
            <div className="stage-chips">
              {stats?.source === 'camera' && active && <span className="chip live-chip">● Camera on</span>}
              {isDemo && active && <span className="chip">Demo · {stats?.demoSegment}</span>}
              {paused && <span className="chip warn">Paused</span>}
              {viewMode !== 'composite' && (
                <button className="chip chip-btn" onClick={() => setViewMode('composite')}>
                  Viewing {STAGE_INFO[viewMode].title} · back to composite ✕
                </button>
              )}
              {active && (
                <span className={`chip ${stats!.quality > 0.6 ? 'ok' : stats!.quality > 0.35 ? 'mid' : 'bad'}`}>
                  Tracking: {stats!.poseDetected ? `${Math.round(stats!.quality * 100)}% ${stats!.quality > 0.6 ? 'good' : stats!.quality > 0.35 ? 'fair' : 'poor'}` : 'no person'}
                </span>
              )}
            </div>
            {stats?.state === 'loading' && <div className="stage-msg">Loading pose model…</div>}
            {stats?.state === 'idle' && !error && (
              <div className="stage-msg">
                Camera off. Session data cleared.
                <div className="row">
                  <button className="btn primary" onClick={() => onRequest({ kind: 'camera' })}>Start camera</button>
                  <button className="btn" onClick={() => onRequest({ kind: 'demo' })}>Demo mode</button>
                </div>
              </div>
            )}
          </div>
        </div>
        {showPipeline && (
          <PipelineStrip stats={stats} viewMode={viewMode} onSelect={setViewMode} registerCanvas={registerThumb} />
        )}
        {error && <ErrorBanner error={error} onRetry={() => onRequest({ kind: request.kind, file: request.file })} onDemo={() => onRequest({ kind: 'demo' })} onCpu={() => { set('delegate', 'CPU'); onRequest({ kind: request.kind, file: request.file }); }} onDismiss={() => setError(null)} />}
        {active && stats!.warnings.length > 0 && (
          <div className="warnings" role="status">
            {stats!.warnings.map((w) => (
              <p key={w}>⚠ {w}</p>
            ))}
          </div>
        )}
        <div className="toolbar" role="toolbar" aria-label="Session controls">
          <button className="btn" onClick={togglePause} disabled={!active} aria-keyshortcuts="Space">
            {paused ? '▶ Resume' : '❚❚ Pause'}
          </button>
          <button className="btn danger" onClick={stop} disabled={!active && stats?.state !== 'loading'}>
            ■ Stop
          </button>
          <button className="btn" onClick={() => void snapshot()} disabled={!active} aria-keyshortcuts="S">
            Snapshot
          </button>
          <button className="btn" aria-pressed={showPipeline} onClick={() => setShowPipeline((v) => !v)} aria-keyshortcuts="P">
            {showPipeline ? 'Hide pipeline' : 'Show pipeline'}
          </button>
          <span className="sep" />
          <button className="btn" onClick={() => onRequest({ kind: 'camera' })}>Camera</button>
          {cameras.length > 1 && (
            <Select
              label="Camera"
              value={cameraId}
              options={[{ value: '', label: 'Default camera' }, ...cameras.map((c) => ({ value: c.deviceId, label: c.label }))]}
              onChange={(id) => {
                setCameraId(id);
                engineRef.current?.start('camera', { deviceId: id || undefined });
              }}
            />
          )}
          <button className="btn" onClick={() => onRequest({ kind: 'demo' })}>Demo</button>
          <button className="btn" onClick={() => fileRef.current?.click()}>Video file…</button>
          <input
            ref={fileRef}
            type="file"
            accept="video/*"
            hidden
            aria-label="Choose a video file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onRequest({ kind: 'video', file: f });
              e.target.value = '';
            }}
          />
          <span className="sep" />
          <button className="btn ghost" onClick={() => { engineRef.current?.stop(); onExit(); }}>Home</button>
        </div>
        <p className="sr-only" aria-live="polite">{announce}</p>
      </section>

      <aside className="sidebar" aria-label="Controls and analysis">
        <Panel title="Anatomy layers" open>
          {LAYER_NAMES.map((l) => (
            <Toggle key={l} label={LAYER_LABELS[l]} checked={settings.layers[l]} onChange={(v) => set('layers', { ...settings.layers, [l]: v })} />
          ))}
          <Select
            label="Visual style"
            value={settings.style}
            options={[
              { value: 'xray', label: 'X-ray style (glow)' },
              { value: 'solid', label: 'Solid bone' },
            ]}
            onChange={(v) => set('style', v)}
          />
          {!isDemo && <Toggle label="Dim camera video" checked={dimVideo} onChange={setDimVideo} hint="Greyscale and darken the video so the overlay stands out" />}
        </Panel>

        <Panel title="Alignment">
          <Slider label="Scale" value={al.scale} min={0.6} max={1.5} step={0.01} onChange={(v) => setAl({ scale: v })} format={(v) => `${Math.round(v * 100)}%`} />
          <Slider label="Horizontal offset" value={al.offsetX} min={-0.3} max={0.3} step={0.005} onChange={(v) => setAl({ offsetX: v })} format={(v) => `${(v * 100).toFixed(1)}%`} />
          <Slider label="Vertical offset" value={al.offsetY} min={-0.3} max={0.3} step={0.005} onChange={(v) => setAl({ offsetY: v })} format={(v) => `${(v * 100).toFixed(1)}%`} />
          <Slider label="Rotation" value={al.rotation} min={-30} max={30} step={0.5} onChange={(v) => setAl({ rotation: v })} format={(v) => `${v}°`} />
          <Slider label="Opacity" value={al.opacity} min={0.1} max={1} step={0.05} onChange={(v) => setAl({ opacity: v })} format={(v) => `${Math.round(v * 100)}%`} />
          <button className="btn small" onClick={() => set('alignment', { ...DEFAULT_ALIGNMENT })}>Reset alignment</button>
        </Panel>

        <Panel title="3D inspector">
          <p className="muted">The same reference model in metric 3D space, independent of the live overlay. Drag to rotate, scroll to zoom.</p>
          <div className="inspector" ref={inspectorRef} />
          <button className="btn small" onClick={() => engineRef.current?.resetInspectorView()}>Reset view</button>
        </Panel>

        <Panel title="Analysis (estimates, non-clinical)">
          <AnalysisPanel
            stats={stats}
            onRecord={(on) => engineRef.current?.setRecording(on)}
            onExport={() => {
              const csv = engineRef.current?.exportMeasurementsCsv();
              if (csv) download(new Blob([csv], { type: 'text/csv' }), `joint-angle-estimates-${stamp()}.csv`);
            }}
            onClear={() => engineRef.current?.clearSessionData()}
          />
        </Panel>

        <Panel title="Status & performance">
          <StatusPanel stats={stats} />
        </Panel>

        <Panel title="Settings">
          <Toggle label="Mirror preview" checked={settings.mirror} onChange={(v) => set('mirror', v)} hint="Like a mirror; recommended for a front camera" />
          <Slider label="Smoothing" value={settings.smoothing} min={0} max={1} step={0.05} onChange={(v) => set('smoothing', v)} format={(v) => (v === 0 ? 'off' : `${Math.round(v * 100)}%`)} />
          <Slider label="Min. landmark confidence" value={settings.minVisibility} min={0.2} max={0.9} step={0.05} onChange={(v) => set('minVisibility', v)} format={(v) => v.toFixed(2)} />
          <Slider label="Max. inference rate" value={settings.maxInferenceFps} min={5} max={60} step={5} onChange={(v) => set('maxInferenceFps', v)} format={(v) => `${v}/s`} />
          <Select
            label="Pose model"
            value={settings.modelVariant}
            options={[
              { value: 'lite', label: 'Lite — fastest' },
              { value: 'full', label: 'Full — balanced' },
              { value: 'heavy', label: 'Heavy — most accurate, slowest' },
            ]}
            onChange={(v) => set('modelVariant', v)}
          />
          <Select
            label="Inference backend"
            value={settings.delegate}
            options={[
              { value: 'GPU', label: 'GPU (WebGL), falls back to CPU' },
              { value: 'CPU', label: 'CPU (WASM)' },
            ]}
            onChange={(v) => set('delegate', v)}
          />
          <Select
            label="Camera resolution (applies on restart)"
            value={settings.resolution}
            options={[
              { value: '640x480', label: '640 × 480' },
              { value: '1280x720', label: '1280 × 720 (recommended)' },
              { value: '1920x1080', label: '1920 × 1080' },
            ]}
            onChange={(v) => set('resolution', v)}
          />
          <Toggle label="Show raw landmarks (observed)" checked={settings.showLandmarks} onChange={(v) => set('showLandmarks', v)} hint="Debug overlay: what the pose model actually detected" />
          <Toggle label="Show landmark IDs" checked={settings.showLandmarkIds} onChange={(v) => set('showLandmarkIds', v)} />
          {isDemo && (
            <fieldset className="demo-opts">
              <legend>Demo pose generator</legend>
              <Slider label="Landmark noise" value={settings.demo.noise} min={0} max={0.02} step={0.001} onChange={(v) => set('demo', { ...settings.demo, noise: v })} format={(v) => `${(v * 100).toFixed(1)}%`} />
              <Toggle label="Simulate occlusion (left forearm)" checked={settings.demo.occlusion} onChange={(v) => set('demo', { ...settings.demo, occlusion: v })} />
              <Slider label="Speed" value={settings.demo.speed} min={0.25} max={2} step={0.25} onChange={(v) => set('demo', { ...settings.demo, speed: v })} format={(v) => `${v}×`} />
            </fieldset>
          )}
          <button
            className="btn small danger"
            onClick={() => {
              engineRef.current?.clearSessionData();
              clearPreferences();
              setAnnounce('Local data and saved preferences cleared');
            }}
          >
            Clear local data
          </button>
        </Panel>

        <button className="btn ghost help-link" onClick={onHelp}>Help, limitations &amp; attribution</button>
      </aside>
    </main>
  );
}

function ErrorBanner(props: { error: PipelineError; onRetry: () => void; onDemo: () => void; onCpu: () => void; onDismiss: () => void }) {
  const { error, onRetry, onDemo, onCpu, onDismiss } = props;
  const k = error.kind;
  const titles: Record<string, string> = {
    'insecure-context': 'Secure connection required',
    'unsupported-browser': 'Browser not supported',
    'camera-denied': 'Camera permission denied',
    'camera-not-found': 'No camera found',
    'camera-busy': 'Camera is busy',
    'camera-disconnected': 'Camera disconnected',
    'camera-unknown': 'Camera problem',
    'model-load': 'Pose model failed to load',
    'webgl-unavailable': 'Graphics problem',
    'tracking-lost': 'Tracking lost',
  };
  return (
    <div className="error-banner" role="alert">
      <div>
        <strong>{titles[k] ?? 'Problem'}</strong>
        <p>{error.message}</p>
      </div>
      <div className="row">
        {k !== 'insecure-context' && k !== 'unsupported-browser' && <button className="btn primary" onClick={onRetry}>Try again</button>}
        {k === 'model-load' && <button className="btn" onClick={onCpu}>Retry on CPU</button>}
        {k === 'webgl-unavailable' && <button className="btn" onClick={() => location.reload()}>Reload page</button>}
        <button className="btn" onClick={onDemo}>Use demo mode</button>
        <button className="btn ghost" onClick={onDismiss} aria-label="Dismiss message">Dismiss</button>
      </div>
    </div>
  );
}
