/**
 * Orchestrates the real-time pipeline (§6.1):
 *   source (camera | video file | synthetic demo)
 *     → pose estimator → landmark tracker (gating + smoothing)
 *     → anatomy alignment (image space + world space)
 *     → overlay renderer + 3D inspector, measurements, stats.
 *
 * Framework-agnostic: React only talks to it through this class (NFR-08).
 */
import { CameraService } from '../camera/CameraService';
import { buildAnatomyPose, type AnatomyPose } from '../anatomy/rigMapping';
import { blendPose } from '../anatomy/blend';
import { computeMeasurements, type MeasurementSet } from '../anatomy/measurements';
import { DEFAULT_TRACKER_SETTINGS, LandmarkTracker, type TrackedPose } from '../tracking/LandmarkTracker';
import { DemoPoseSource, DEFAULT_DEMO_OPTIONS, DEMO_SEGMENTS, type DemoOptions } from '../vision/DemoPoseSource';
import { MediaPipePoseEstimator, type Delegate, type PoseModelVariant } from '../vision/MediaPipePoseEstimator';
import { OverlayRenderer, DEFAULT_ALIGNMENT, type Alignment } from '../rendering/OverlayRenderer';
import { InspectorView } from '../rendering/InspectorView';
import { DEFAULT_LAYERS, type LayerVisibility } from '../rendering/SkeletonModel';
import type { RenderStyle } from '../rendering/materials';
import { drawDemoSilhouette, drawLandmarkDebug } from '../rendering/canvas2d';
import { drawStage, STAGES, type Stage, type StageData } from '../rendering/pipelineStages';
import { PipelineError, type Landmark, type PoseEstimator } from '../types/pose';

export type SourceKind = 'camera' | 'demo' | 'video';
export type EngineState = 'idle' | 'loading' | 'running' | 'paused' | 'error';

export interface EngineSettings {
  mirror: boolean;
  smoothing: number;
  minVisibility: number;
  maxInferenceFps: number;
  modelVariant: PoseModelVariant;
  delegate: Delegate;
  resolution: '640x480' | '1280x720' | '1920x1080';
  showLandmarks: boolean;
  showLandmarkIds: boolean;
  layers: LayerVisibility;
  style: RenderStyle;
  alignment: Alignment;
  demo: DemoOptions;
}

export const DEFAULT_SETTINGS: EngineSettings = {
  mirror: true,
  smoothing: DEFAULT_TRACKER_SETTINGS.smoothing,
  minVisibility: DEFAULT_TRACKER_SETTINGS.minVisibility,
  maxInferenceFps: 30,
  modelVariant: 'lite',
  delegate: 'GPU',
  resolution: '1280x720',
  showLandmarks: false,
  showLandmarkIds: false,
  layers: { ...DEFAULT_LAYERS },
  style: 'xray',
  alignment: { ...DEFAULT_ALIGNMENT },
  demo: { ...DEFAULT_DEMO_OPTIONS },
};

export interface EngineStats {
  state: EngineState;
  source: SourceKind | null;
  sourceLabel: string;
  resolution: string;
  renderFps: number;
  inferenceFps: number;
  inferenceMs: number;
  latencyMs: number;
  quality: number;
  poseDetected: boolean;
  warnings: string[];
  counts: { tracked: number; held: number; lost: number };
  measurements: MeasurementSet | null;
  modelInfo: string;
  demoSegment: string | null;
  recording: boolean;
  recordedSamples: number;
  /** Per-stage cost of the latest frames (EMA, ms). `capture` = frame age when inference started. */
  stageMs: { capture: number; inference: number; tracking: number; anatomy: number; analysis: number; render: number };
  /** performance.now() of the last time each stage produced output. */
  stageRunAt: Record<Stage, number>;
  now: number;
}

export interface PipelineTargets {
  thumbs: Partial<Record<Stage, HTMLCanvasElement>>;
  /** Full-size canvas inside the stage used when a 2D stage is selected as the main view. */
  stageView: HTMLCanvasElement;
}

export interface EngineElements {
  stage: HTMLElement;
  video: HTMLVideoElement;
  background: HTMLCanvasElement;
  debug: HTMLCanvasElement;
  overlayHost: HTMLElement;
  inspectorHost: HTMLElement | null;
}

interface Sample {
  t: number;
  values: Record<string, number>;
  reliable: Record<string, boolean>;
}

type VideoWithRVFC = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: { captureTime?: number; presentationTime?: number }) => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

const ema = (prev: number, next: number, k = 0.1) => (prev === 0 ? next : prev + (next - prev) * k);

export class VisualizerEngine {
  private camera = new CameraService();
  private tracker = new LandmarkTracker();
  private overlay: OverlayRenderer;
  private inspector: InspectorView | null = null;
  private estimator: PoseEstimator | null = null;
  private mediapipe: MediaPipePoseEstimator | null = null;
  private demo: DemoPoseSource | null = null;
  private settings: EngineSettings;
  private state: EngineState = 'idle';
  private source: SourceKind | null = null;
  private sourceLabel = '';
  private objectUrl: string | null = null;
  private raf = 0;
  private rvfc = 0;
  private newFrame = false;
  private frameCaptureTime = 0;
  private lastVideoTime = -1;
  private lastTick = 0;
  private lastInfer = 0;
  private lastPoseAt = 0;
  private lastStatsEmit = 0;
  private lastMeasureAt = 0;
  private aspect = 16 / 9;
  private tracked: TrackedPose | null = null;
  private rawImage: Landmark[] | null = null;
  private targetImg: AnatomyPose | null = null;
  private targetWorld: AnatomyPose | null = null;
  private shownImg: AnatomyPose | null = null;
  private shownWorld: AnatomyPose | null = null;
  private pendingLatencyFrom = 0;
  private measurements: MeasurementSet | null = null;
  private recording = false;
  private samples: Sample[] = [];
  private stats: EngineStats;
  private resizeObs: ResizeObserver;
  private statsListeners = new Set<(s: EngineStats) => void>();
  private errorListeners = new Set<(e: PipelineError) => void>();
  private onVisibility = () => this.handleVisibility();
  private onPageHide = () => this.stop();
  private hiddenPaused = false;
  private pipeline: PipelineTargets | null = null;
  private viewMode: Stage = 'composite';
  private lastPipelineDraw = 0;
  private stageMs: EngineStats['stageMs'] = { capture: 0, inference: 0, tracking: 0, anatomy: 0, analysis: 0, render: 0 };
  private stageRunAt = Object.fromEntries(STAGES.map((st) => [st, 0])) as Record<Stage, number>;
  private startSeq = 0;
  private disposed = false;

  constructor(private el: EngineElements, settings: Partial<EngineSettings> = {}) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.overlay = new OverlayRenderer(el.overlayHost, (lost) => {
      if (lost) this.emitError(new PipelineError('webgl-unavailable', 'The graphics context was lost (GPU reset or too many tabs). It will be restored automatically; if not, reload the page.'));
    });
    if (el.inspectorHost) this.inspector = new InspectorView(el.inspectorHost);
    this.stats = this.emptyStats();
    this.applySettings(this.settings);
    this.resizeObs = new ResizeObserver(() => this.layout());
    this.resizeObs.observe(el.stage.parentElement ?? el.stage);
    this.camera.setOnEnded(() => {
      if (this.source === 'camera' && this.state !== 'idle') {
        this.stopSource();
        this.setState('error');
        this.emitError(new PipelineError('camera-disconnected', 'The camera was disconnected or access was revoked. Reconnect it and press Start camera.'));
      }
    });
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.onPageHide);
    this.layout();
    this.raf = requestAnimationFrame(this.tick);
  }

  // ---------- public API ----------

  onStats(cb: (s: EngineStats) => void): () => void {
    this.statsListeners.add(cb);
    cb(this.stats);
    return () => this.statsListeners.delete(cb);
  }

  onError(cb: (e: PipelineError) => void): () => void {
    this.errorListeners.add(cb);
    return () => this.errorListeners.delete(cb);
  }

  listCameras() {
    return this.camera.listCameras();
  }

  getSettings(): EngineSettings {
    return this.settings;
  }

  updateSettings(patch: Partial<EngineSettings>): void {
    const prev = this.settings;
    this.settings = { ...prev, ...patch };
    this.applySettings(this.settings);
    const modelChanged = patch.modelVariant && patch.modelVariant !== prev.modelVariant;
    const delegateChanged = patch.delegate && patch.delegate !== prev.delegate;
    if ((modelChanged || delegateChanged) && this.mediapipe) {
      this.mediapipe.close();
      this.mediapipe = null;
      if (this.source && this.source !== 'demo' && this.state !== 'idle') {
        void this.ensureMediaPipe().catch((e) => this.fail(e));
      }
    }
  }

  async start(kind: SourceKind, opts: { deviceId?: string; file?: File } = {}): Promise<void> {
    this.stopSource();
    const seq = ++this.startSeq;
    // If stop()/dispose()/another start() happened while we were awaiting, release everything.
    const superseded = () => {
      if (seq === this.startSeq && !this.disposed) return false;
      if (this.source === null || this.disposed) this.camera.stop(this.el.video);
      return true;
    };
    this.source = kind;
    this.setState('loading');
    try {
      if (kind === 'demo') {
        this.demo = new DemoPoseSource(this.settings.demo);
        await this.demo.init();
        this.estimator = this.demo;
        this.aspect = 16 / 9;
        this.demo.aspect = this.aspect;
        this.sourceLabel = 'Demo: synthetic pose (no camera)';
      } else {
        // Load the model first so a model failure doesn't leave the camera on.
        await this.ensureMediaPipe();
        if (superseded()) return;
        if (kind === 'camera') {
          const [w, h] = this.settings.resolution.split('x').map(Number);
          const track = await this.camera.start(this.el.video, { deviceId: opts.deviceId, width: w, height: h });
          if (superseded()) {
            track.stop();
            return;
          }
          this.sourceLabel = track.label || 'Camera';
        } else {
          if (!opts.file) throw new PipelineError('camera-unknown', 'No video file was selected.');
          this.objectUrl = URL.createObjectURL(opts.file);
          const v = this.el.video;
          v.srcObject = null;
          v.src = this.objectUrl;
          v.loop = true;
          v.muted = true;
          v.playsInline = true;
          await v.play();
          this.sourceLabel = `Video file: ${opts.file.name}`;
        }
        this.estimator = this.mediapipe;
        await this.waitForVideoSize();
        if (superseded()) return;
        this.aspect = this.el.video.videoWidth / this.el.video.videoHeight;
        this.armVideoFrameCallback();
      }
      this.tracker.reset();
      this.lastPoseAt = performance.now();
      this.layout();
      this.setState('running');
    } catch (e) {
      if (seq !== this.startSeq || this.disposed) return;
      this.stopSource();
      this.fail(e);
    }
  }

  setPaused(paused: boolean): void {
    if (this.state !== 'running' && this.state !== 'paused') return;
    this.demo?.setPaused(paused);
    if (this.source === 'video') {
      if (paused) this.el.video.pause();
      else void this.el.video.play();
    }
    this.setState(paused ? 'paused' : 'running');
  }

  /** Stop the source, release the camera and clear all transient frame/pose data (FR-18, AC-10). */
  stop(): void {
    this.startSeq++;
    this.stopSource();
    this.setState('idle');
  }

  /** Also discards recorded measurements. */
  clearSessionData(): void {
    this.samples = [];
    this.recording = false;
    this.measurements = null;
    this.emitStats(true);
  }

  setRecording(on: boolean): void {
    this.recording = on;
    this.emitStats(true);
  }

  exportMeasurementsCsv(): string {
    if (!this.samples.length) return '';
    const keys = Object.keys(this.samples[0].values);
    const header = ['t_ms', ...keys.flatMap((k) => [`${k}_deg`, `${k}_reliable`])].join(',');
    const t0 = this.samples[0].t;
    const rows = this.samples.map((s) =>
      [Math.round(s.t - t0), ...keys.flatMap((k) => [s.values[k].toFixed(1), s.reliable[k] ? 1 : 0])].join(','),
    );
    return [
      '# AR Anatomy Visualizer — estimated joint angles from monocular pose estimation. Educational/research estimates, NOT clinical measurements.',
      header,
      ...rows,
    ].join('\n');
  }

  /** Live pipeline visualisation targets (thumbnails + full-size stage view); null to disable. */
  setPipeline(targets: PipelineTargets | null): void {
    this.pipeline = targets;
  }

  /** Which stage fills the main view ('composite' = normal AR view). */
  setViewMode(mode: Stage): void {
    this.viewMode = mode;
  }

  resetInspectorView(): void {
    this.inspector?.resetView();
  }

  /** Composite the current view into a PNG, only on explicit user action (FR-14). */
  async snapshot(): Promise<Blob | null> {
    const stageW = this.el.stage.clientWidth;
    const stageH = this.el.stage.clientHeight;
    if (!stageW || !stageH) return null;
    const v = this.el.video;
    const useVideo = this.source !== 'demo' && v.videoWidth > 0;
    const W = useVideo ? v.videoWidth : Math.round(stageW * 2);
    const H = useVideo ? v.videoHeight : Math.round(stageH * 2);
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    if (useVideo) {
      ctx.save();
      if (this.settings.mirror) ctx.setTransform(-1, 0, 0, 1, W, 0);
      ctx.filter = getComputedStyle(v).filter || 'none';
      ctx.drawImage(v, 0, 0, W, H);
      ctx.restore();
    } else {
      ctx.drawImage(this.el.background, 0, 0, W, H);
    }
    this.overlay.render();
    ctx.drawImage(this.overlay.canvas, 0, 0, W, H);
    if (this.settings.showLandmarks) ctx.drawImage(this.el.debug, 0, 0, W, H);
    const fs = Math.max(12, Math.round(H / 40));
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, H - fs * 2.2, W, fs * 2.2);
    ctx.fillStyle = '#fff';
    ctx.font = `${fs}px system-ui, sans-serif`;
    ctx.fillText(`Illustrative reference model aligned to estimated pose — not an X-ray or diagnostic image · ${new Date().toLocaleString()}`, fs * 0.6, H - fs * 0.75);
    return new Promise((res) => c.toBlob((b) => res(b), 'image/png'));
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pagehide', this.onPageHide);
    this.mediapipe?.close();
    this.overlay.dispose();
    this.inspector?.dispose();
    this.statsListeners.clear();
    this.errorListeners.clear();
  }

  // ---------- internals ----------

  private emptyStats(): EngineStats {
    return {
      state: this.state, source: this.source, sourceLabel: '', resolution: '', renderFps: 0, inferenceFps: 0,
      inferenceMs: 0, latencyMs: 0, quality: 0, poseDetected: false, warnings: [],
      counts: { tracked: 0, held: 0, lost: 0 }, measurements: null, modelInfo: '', demoSegment: null,
      recording: false, recordedSamples: 0,
      stageMs: { capture: 0, inference: 0, tracking: 0, anatomy: 0, analysis: 0, render: 0 },
      stageRunAt: Object.fromEntries(STAGES.map((st) => [st, 0])) as Record<Stage, number>,
      now: 0,
    };
  }

  private async ensureMediaPipe(): Promise<void> {
    if (this.mediapipe) return;
    const mp = new MediaPipePoseEstimator(this.settings.modelVariant, this.settings.delegate);
    await mp.init();
    this.mediapipe = mp;
    if (this.source && this.source !== 'demo') this.estimator = mp;
  }

  private waitForVideoSize(): Promise<void> {
    const v = this.el.video;
    if (v.videoWidth > 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new PipelineError('camera-unknown', 'The video source did not deliver any frames.')), 8000);
      v.addEventListener('loadedmetadata', () => { clearTimeout(t); resolve(); }, { once: true });
    });
  }

  private armVideoFrameCallback(): void {
    const v = this.el.video as VideoWithRVFC;
    if (!v.requestVideoFrameCallback) return;
    const cb = (_now: number, meta: { captureTime?: number; presentationTime?: number }) => {
      this.newFrame = true;
      this.frameCaptureTime = meta.captureTime ?? meta.presentationTime ?? performance.now();
      if (this.source && this.source !== 'demo') this.rvfc = v.requestVideoFrameCallback!(cb);
    };
    this.rvfc = v.requestVideoFrameCallback(cb);
  }

  private stopSource(): void {
    const v = this.el.video as VideoWithRVFC;
    if (this.rvfc && v.cancelVideoFrameCallback) v.cancelVideoFrameCallback(this.rvfc);
    this.rvfc = 0;
    this.camera.stop(this.el.video);
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.demo?.close();
    this.demo = null;
    this.estimator = null;
    this.source = null;
    this.sourceLabel = '';
    this.tracker.reset();
    this.tracked = null;
    this.rawImage = null;
    this.targetImg = this.targetWorld = this.shownImg = this.shownWorld = null;
    this.measurements = null;
    this.newFrame = false;
    this.lastVideoTime = -1;
    this.overlay.update(null);
    this.overlay.render();
    this.inspector?.update(null);
    for (const c of [this.el.background, this.el.debug]) c.getContext('2d')?.clearRect(0, 0, c.width, c.height);
  }

  private applySettings(s: EngineSettings): void {
    this.tracker.configure({ smoothing: s.smoothing, minVisibility: s.minVisibility });
    this.overlay.setMirror(s.mirror);
    this.overlay.setStyle(s.style);
    this.overlay.setAlignment(s.alignment);
    this.overlay.setLayers(s.layers);
    this.inspector?.setStyle(s.style);
    this.inspector?.setLayers(s.layers);
    if (this.demo) this.demo.options = { ...s.demo };
    if (!s.showLandmarks) this.el.debug.getContext('2d')?.clearRect(0, 0, this.el.debug.width, this.el.debug.height);
  }

  private layout(): void {
    const parent = this.el.stage.parentElement;
    if (!parent) return;
    const pw = parent.clientWidth;
    const ph = parent.clientHeight;
    if (!pw || !ph) return;
    let w = pw;
    let h = pw / this.aspect;
    if (h > ph) {
      h = ph;
      w = ph * this.aspect;
    }
    w = Math.floor(w);
    h = Math.floor(h);
    const st = this.el.stage.style;
    if (st.width !== `${w}px` || st.height !== `${h}px`) {
      st.width = `${w}px`;
      st.height = `${h}px`;
    }
    this.overlay.setSize(w, h, this.aspect);
  }

  private handleVisibility(): void {
    // Don't burn CPU/GPU on a hidden tab; resume when visible again.
    if (document.hidden && this.state === 'running') {
      this.hiddenPaused = true;
      this.setPaused(true);
    } else if (!document.hidden && this.hiddenPaused) {
      this.hiddenPaused = false;
      this.setPaused(false);
    }
  }

  private setState(s: EngineState): void {
    this.state = s;
    this.emitStats(true);
  }

  private fail(e: unknown): void {
    const err = e instanceof PipelineError ? e : new PipelineError('camera-unknown', String((e as Error)?.message ?? e));
    this.setState('error');
    this.emitError(err);
  }

  private emitError(e: PipelineError): void {
    this.errorListeners.forEach((cb) => cb(e));
  }

  private tick = (now: number) => {
    this.raf = requestAnimationFrame(this.tick);
    const dt = this.lastTick ? now - this.lastTick : 16;
    this.lastTick = now;
    this.stats.renderFps = ema(this.stats.renderFps, 1000 / Math.max(dt, 1), 0.05);
    const s = this.settings;

    if (this.state === 'running' && this.estimator) {
      const v = this.el.video;
      if (this.source !== 'demo' && !(v as VideoWithRVFC).requestVideoFrameCallback && v.currentTime !== this.lastVideoTime) {
        this.lastVideoTime = v.currentTime;
        this.newFrame = true;
        this.frameCaptureTime = now;
      }
      const due = now - this.lastInfer >= 1000 / s.maxInferenceFps - 2;
      const hasFrame = this.source === 'demo' || this.newFrame;
      if (due && hasFrame) {
        const captureTs = this.source === 'demo' ? now : this.frameCaptureTime || now;
        this.newFrame = false;
        this.stageMs.capture = ema(this.stageMs.capture, Math.max(0, performance.now() - captureTs), 0.1);
        this.stageRunAt.camera = now;
        let frame = null;
        try {
          frame = this.estimator.estimate(this.source === 'demo' ? null : v, captureTs);
        } catch (e) {
          // Transient inference failure: skip this frame (NFR-05).
          console.warn('Pose inference failed for one frame', e);
        }
        const interval = now - this.lastInfer;
        this.lastInfer = now;
        this.stats.inferenceFps = ema(this.stats.inferenceFps, 1000 / Math.max(interval, 1), 0.1);
        if (frame) {
          this.stats.inferenceMs = ema(this.stats.inferenceMs, frame.inferenceMs, 0.1);
          this.stageMs.inference = this.stats.inferenceMs;
          this.stageRunAt.inference = now;
          this.rawImage = frame.image;
          let t = performance.now();
          this.tracked = this.tracker.update(frame);
          this.stageMs.tracking = ema(this.stageMs.tracking, performance.now() - t, 0.1);
          this.stageRunAt.tracking = now;
          t = performance.now();
          this.targetImg = buildAnatomyPose(this.tracked, 'image', this.aspect);
          this.targetWorld = buildAnatomyPose(this.tracked, 'world');
          this.stageMs.anatomy = ema(this.stageMs.anatomy, performance.now() - t, 0.1);
          if (this.targetImg) this.stageRunAt.anatomy = now;
          this.lastPoseAt = now;
          this.pendingLatencyFrom = frame.captureTime;
          if (now - this.lastMeasureAt > 200) {
            this.lastMeasureAt = now;
            t = performance.now();
            this.measurements = computeMeasurements(this.tracked, this.aspect);
            this.stageMs.analysis = ema(this.stageMs.analysis, performance.now() - t, 0.2);
            if (this.recording) this.record(now, this.measurements);
          }
        } else if (now - this.lastPoseAt > 1500) {
          this.tracked = null;
          this.targetImg = this.targetWorld = null;
          this.measurements = null;
        }
      }
    }

    // Render-rate interpolation toward the latest inferred pose.
    const k = 1 - Math.exp(-dt / 30);
    this.shownImg = this.targetImg ? blendPose(this.shownImg, this.targetImg, k) : null;
    this.shownWorld = this.targetWorld ? blendPose(this.shownWorld, this.targetWorld, k) : null;
    const tr = performance.now();
    this.overlay.update(this.shownImg);
    this.overlay.render();
    this.inspector?.update(this.shownWorld);
    this.inspector?.render();
    this.stageMs.render = ema(this.stageMs.render, performance.now() - tr, 0.05);
    if (this.shownImg) this.stageRunAt.model = this.stageRunAt.composite = now;

    if (this.pendingLatencyFrom) {
      this.stats.latencyMs = ema(this.stats.latencyMs, performance.now() - this.pendingLatencyFrom, 0.1);
      this.pendingLatencyFrom = 0;
    }
    if (this.source === 'demo') drawDemoSilhouette(this.el.background, this.rawImage, s.mirror);
    if (s.showLandmarks) drawLandmarkDebug(this.el.debug, this.tracked?.image ?? null, s.mirror, s.showLandmarkIds);
    this.drawPipeline(now);

    if (now - this.lastStatsEmit > 250) this.emitStats();
  };

  private stageData(): StageData {
    const v = this.el.video;
    const demo = this.source === 'demo';
    const hasVideo = !demo && v.videoWidth > 0 && this.source !== null;
    return {
      frame: demo ? this.el.background : hasVideo ? v : null,
      frameSize: demo ? [this.el.background.width, this.el.background.height] : hasVideo ? [v.videoWidth, v.videoHeight] : [0, 0],
      // The demo background is already drawn mirrored; the video element's pixels are not.
      mirrored: demo ? false : this.settings.mirror,
      raw: this.rawImage && this.tracked ? this.rawImage : null,
      tracked: this.tracked?.image ?? null,
      anatomy: this.targetImg,
      aspect: this.aspect,
      overlay: this.overlay.canvas,
      videoFilter: hasVideo ? getComputedStyle(v).filter || 'none' : 'none',
    };
  }

  private drawPipeline(now: number): void {
    if (!this.pipeline) return;
    const fullView = this.viewMode === 'inference' || this.viewMode === 'tracking' || this.viewMode === 'anatomy';
    let data: StageData | null = null;
    if (fullView) {
      data = this.stageData();
      // Demo landmarks are in unmirrored image space even though the background is mirrored.
      drawStage(this.pipeline.stageView, this.viewMode, this.fixDemoMirror(data), true);
    }
    if (now - this.lastPipelineDraw < 80) return; // thumbnails at ~12 fps
    this.lastPipelineDraw = now;
    data ??= this.stageData();
    for (const st of STAGES) {
      const c = this.pipeline.thumbs[st];
      if (c && c.offsetParent !== null) drawStage(c, st, this.fixDemoMirror(data), false);
    }
  }

  /**
   * In demo mode the background canvas is already mirrored on screen, but the landmarks
   * are unmirrored image coordinates. Draw landmarks mirrored to match.
   */
  private fixDemoMirror(d: StageData): StageData {
    if (this.source !== 'demo' || !this.settings.mirror) return d;
    const flip = <T extends { x: number }>(a: T[] | null) => a?.map((l) => ({ ...l, x: 1 - l.x })) ?? null;
    const anatomy = d.anatomy && {
      ...d.anatomy,
      joints: Object.fromEntries(Object.entries(d.anatomy.joints).map(([k, j]) => [k, { ...j, p: { ...j.p, x: d.aspect - j.p.x } }])) as AnatomyPose['joints'],
      spine: d.anatomy.spine.map((q) => ({ ...q, x: d.aspect - q.x })),
      torso: {
        lateral: { ...d.anatomy.torso.lateral, x: -d.anatomy.torso.lateral.x },
        up: { ...d.anatomy.torso.up, x: -d.anatomy.torso.up.x },
        forward: { ...d.anatomy.torso.forward, x: -d.anatomy.torso.forward.x },
      },
    };
    return { ...d, raw: flip(d.raw), tracked: flip(d.tracked), anatomy };
  }

  private record(t: number, m: MeasurementSet): void {
    const values: Record<string, number> = {};
    const reliable: Record<string, boolean> = {};
    for (const x of [...m.angles, ...m.posture]) {
      values[x.id] = x.value;
      reliable[x.id] = x.reliable;
    }
    this.samples.push({ t, values, reliable });
    if (this.samples.length > 30000) this.samples.shift(); // ~100 min at 5 Hz
  }

  private emitStats(force = false): void {
    const now = performance.now();
    if (!force && now - this.lastStatsEmit < 250) return;
    this.lastStatsEmit = now;
    const tp = this.tracked;
    const counts = { tracked: 0, held: 0, lost: 0 };
    tp?.image.forEach((l) => counts[l.state]++);
    const warnings = [...(tp?.warnings ?? [])];
    const running = this.state === 'running' || this.state === 'paused';
    if (running && !tp && this.source) warnings.unshift('No person detected. Stand 2–3 m from the camera, facing it, with your whole body in view.');
    if (running && this.targetImg?.hipsEstimated)
      warnings.unshift('Upper-body mode: hips are out of view, so the pelvis and lower spine are estimated (shown dimmed). Step back to track your whole body.');
    const v = this.el.video;
    const mp = this.mediapipe;
    this.stats = {
      ...this.stats,
      state: this.state,
      source: this.source,
      sourceLabel: this.sourceLabel,
      resolution: this.source === 'demo' ? 'synthetic' : v.videoWidth ? `${v.videoWidth}×${v.videoHeight}` : '',
      quality: tp?.quality ?? 0,
      poseDetected: !!tp,
      warnings,
      counts,
      measurements: this.measurements,
      modelInfo:
        this.source === 'demo'
          ? 'Synthetic pose generator'
          : mp
            ? `MediaPipe Pose Landmarker (${mp.variant}) · ${mp.activeDelegate} · model from ${mp.modelSource === 'local' ? 'local /models' : 'Google storage'}`
            : '',
      demoSegment: this.demo ? DEMO_SEGMENTS[this.demo.currentSegment] : null,
      recording: this.recording,
      recordedSamples: this.samples.length,
      stageMs: { ...this.stageMs },
      stageRunAt: { ...this.stageRunAt },
      now,
    };
    if (this.state !== 'running') {
      this.stats.inferenceFps = 0;
    }
    this.statsListeners.forEach((cb) => cb(this.stats));
  }
}
