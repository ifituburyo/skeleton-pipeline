/**
 * Live pipeline visualisation: draws what each processing stage sees / produces for
 * the current frame, so the whole process is visible as it happens.
 *
 *   1 camera  → 2 pose inference → 3 tracking filter → 4 anatomy alignment → 5 3D render → 6 composite
 *
 * Used for the small thumbnails in the pipeline strip and, full-size, when a stage is
 * selected as the main view.
 */
import type { Landmark } from '../types/pose';
import type { TrackedLandmark } from '../tracking/LandmarkTracker';
import type { AnatomyPose, JointName } from '../anatomy/rigMapping';
import { DEBUG_CONNECTIONS } from '../anatomy/landmarks';
import { catmullRom } from '../anatomy/vec';

export const STAGES = ['camera', 'inference', 'tracking', 'anatomy', 'model', 'composite'] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_INFO: Record<Stage, { title: string; detail: string }> = {
  camera: { title: '1 · Camera frame', detail: 'Raw RGB frame from the webcam (getUserMedia)' },
  inference: { title: '2 · Pose inference', detail: 'MediaPipe BlazePose: 33 landmarks + visibility' },
  tracking: { title: '3 · Tracking filter', detail: 'Confidence gating + One Euro smoothing (raw → filtered)' },
  anatomy: { title: '4 · Anatomy alignment', detail: 'Observed joints → inferred spine, sternum, pelvis, skull + torso frame' },
  model: { title: '5 · 3D render', detail: 'Three.js reference skeleton posed from stage 4' },
  composite: { title: '6 · Composite', detail: 'Camera + overlay — what the user sees' },
};

/** Which inferred joints get a text label in the detailed anatomy view. */
const INFERRED_LABELS: Partial<Record<JointName, string>> = {
  headCentre: 'skull (centre)',
  C7: 'C7',
  T6: 'T6',
  T12: 'T12',
  L3: 'L3',
  sacrum: 'sacrum',
  sternumTop: 'sternum (top)',
  sternumBottom: 'sternum (xiphoid)',
};

export interface StageData {
  /** Camera video or demo background. */
  frame: CanvasImageSource | null;
  frameSize: [number, number];
  mirrored: boolean;
  raw: Landmark[] | null;
  tracked: TrackedLandmark[] | null;
  anatomy: AnatomyPose | null;
  aspect: number;
  overlay: HTMLCanvasElement;
  /** Video CSS filter (dimmed camera) for composite fidelity. */
  videoFilter: string;
}

const C = {
  bg: '#05080d',
  yellow: '#facc15',
  orange: '#fb923c',
  red: '#f87171',
  cyan: '#7fe3ff',
  grey: 'rgba(203, 213, 225, 0.75)',
  green: '#4ade80',
  text: '#e6edf5',
};

export function drawStage(canvas: HTMLCanvasElement, stage: Stage, d: StageData, detailed: boolean): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, w, h);
  const s = Math.max(w / 640, 0.35); // size scale for marks/text
  // Image-normalised → canvas pixels (mirroring handled here so text stays readable).
  const X = (x: number) => (d.mirrored ? 1 - x : x) * w;
  const Y = (y: number) => y * h;

  const frame = (alpha: number, filter = 'none') => {
    if (!d.frame || !d.frameSize[0]) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.filter = filter;
    if (d.mirrored) ctx.setTransform(-1, 0, 0, 1, w, 0);
    ctx.drawImage(d.frame, 0, 0, w, h);
    ctx.restore();
  };
  // Text is sized in CSS pixels so it stays readable but small at any canvas size.
  const label = (text: string, x: number, y: number, color = C.text, size = 11, align: 'left' | 'right' = 'left') => {
    const px = Math.round(size * dpr);
    ctx.font = `${px}px ui-monospace, Menlo, monospace`;
    const m = ctx.measureText(text);
    const x0 = align === 'right' ? x - m.width : x;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(x0 - 3, y - px, m.width + 6, px * 1.35);
    ctx.fillStyle = color;
    ctx.fillText(text, x0, y);
  };
  const empty = (msg: string) => {
    ctx.fillStyle = 'rgba(159,176,195,0.8)';
    ctx.font = `${Math.round((detailed ? 14 : 10) * dpr)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(msg, w / 2, h / 2);
    ctx.textAlign = 'start';
  };

  switch (stage) {
    case 'camera': {
      frame(1);
      if (detailed && d.frameSize[0]) label(`${d.frameSize[0]}×${d.frameSize[1]} RGB · ${d.mirrored ? 'mirrored preview' : 'unmirrored'}`, 10 * dpr, 22 * dpr, C.text, 12);
      if (!d.frame) empty('No frame');
      break;
    }
    case 'inference': {
      frame(0.35, 'grayscale(1)');
      if (!d.raw) return empty('No person detected');
      ctx.lineWidth = 1.5 * s;
      ctx.strokeStyle = 'rgba(250,204,21,0.5)';
      for (const [a, b] of DEBUG_CONNECTIONS) {
        ctx.beginPath();
        ctx.moveTo(X(d.raw[a].x), Y(d.raw[a].y));
        ctx.lineTo(X(d.raw[b].x), Y(d.raw[b].y));
        ctx.stroke();
      }
      d.raw.forEach((l, i) => {
        // Dot size + opacity encode visibility; number shows it exactly in detail view.
        const v = l.visibility;
        ctx.beginPath();
        ctx.arc(X(l.x), Y(l.y), (2 + 3 * v) * s, 0, Math.PI * 2);
        ctx.fillStyle = v >= 0.5 ? C.yellow : C.red;
        ctx.globalAlpha = 0.35 + 0.65 * v;
        ctx.fill();
        ctx.globalAlpha = 1;
        if (detailed && i >= 11) label(`${i}:${v.toFixed(2)}`, X(l.x) + 6 * dpr, Y(l.y) - 3 * dpr, v >= 0.5 ? C.yellow : C.red, 10);
      });
      if (detailed) label('dot size = visibility · red = below confidence threshold', 10 * dpr, h - 12 * dpr, C.text, 12);
      break;
    }
    case 'tracking': {
      frame(0.3, 'grayscale(1)');
      if (!d.raw || !d.tracked) return empty('No landmarks to filter');
      d.tracked.forEach((t, i) => {
        const r = d.raw![i];
        if (t.state !== 'lost') {
          // Correction vector raw → filtered
          ctx.strokeStyle = 'rgba(127,227,255,0.8)';
          ctx.lineWidth = 1.2 * s;
          ctx.beginPath();
          ctx.moveTo(X(r.x), Y(r.y));
          ctx.lineTo(X(t.x), Y(t.y));
          ctx.stroke();
        }
        // Raw sample: hollow grey
        ctx.strokeStyle = C.grey;
        ctx.lineWidth = 1 * s;
        ctx.beginPath();
        ctx.arc(X(r.x), Y(r.y), 3.5 * s, 0, Math.PI * 2);
        ctx.stroke();
        // Filtered output: shape by state
        const x = X(t.x), y = Y(t.y);
        if (t.state === 'tracked') {
          ctx.fillStyle = C.green;
          ctx.beginPath();
          ctx.arc(x, y, 3 * s, 0, Math.PI * 2);
          ctx.fill();
        } else if (t.state === 'held') {
          ctx.strokeStyle = C.orange;
          ctx.lineWidth = 2 * s;
          ctx.strokeRect(x - 4 * s, y - 4 * s, 8 * s, 8 * s);
          if (detailed) label('held', x + 7 * dpr, y, C.orange, 10);
        } else {
          ctx.strokeStyle = C.red;
          ctx.lineWidth = 2 * s;
          ctx.beginPath();
          ctx.moveTo(x - 4 * s, y - 4 * s); ctx.lineTo(x + 4 * s, y + 4 * s);
          ctx.moveTo(x + 4 * s, y - 4 * s); ctx.lineTo(x - 4 * s, y + 4 * s);
          ctx.stroke();
        }
      });
      if (detailed) {
        label('○ raw  ● filtered (tracked)  □ held (occluded)  × lost  — correction', 10 * dpr, h - 12 * dpr, C.text, 12);
      }
      break;
    }
    case 'anatomy': {
      frame(0.25, 'grayscale(1)');
      const p = d.anatomy;
      if (!p) return empty('Torso not found — model hidden');
      // Image-space anatomy coords → normalised image coords
      const P = (q: { x: number; y: number }) => [X(q.x / d.aspect), Y(1 - q.y)] as const;
      // Inferred spine curve
      ctx.strokeStyle = C.cyan;
      ctx.lineWidth = 2.5 * s;
      ctx.setLineDash([6 * s, 4 * s]);
      ctx.beginPath();
      for (let i = 0; i <= 40; i++) {
        const q = P(catmullRom(p.spine, i / 40));
        if (i === 0) ctx.moveTo(...q);
        else ctx.lineTo(...q);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      // Limb lines between observed joints
      const pairs: [JointName, JointName][] = [
        ['lShoulder', 'lElbow'], ['lElbow', 'lWrist'], ['rShoulder', 'rElbow'], ['rElbow', 'rWrist'],
        ['lHip', 'lKnee'], ['lKnee', 'lAnkle'], ['rHip', 'rKnee'], ['rKnee', 'rAnkle'],
        ['lShoulder', 'rShoulder'], ['lHip', 'rHip'], ['sternumTop', 'lShoulder'], ['sternumTop', 'rShoulder'],
        ['sternumTop', 'sternumBottom'],
      ];
      ctx.strokeStyle = 'rgba(230,237,245,0.55)';
      ctx.lineWidth = 1.5 * s;
      for (const [a, b] of pairs) {
        if (p.joints[a].conf <= 0 || p.joints[b].conf <= 0) continue;
        ctx.beginPath();
        ctx.moveTo(...P(p.joints[a].p));
        ctx.lineTo(...P(p.joints[b].p));
        ctx.stroke();
      }
      // Joints: observed = yellow squares, inferred = cyan diamonds
      for (const [name, j] of Object.entries(p.joints) as [JointName, AnatomyPose['joints'][JointName]][]) {
        if (j.conf <= 0) continue;
        if (j.observed && /Eye|Ear|Mouth|Index|Pinky|Thumb|Heel|Toe/.test(name)) continue;
        const [x, y] = P(j.p);
        const r = 4 * s;
        if (j.observed) {
          ctx.fillStyle = C.yellow;
          ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
        } else {
          ctx.fillStyle = C.cyan;
          ctx.beginPath();
          ctx.moveTo(x, y - r * 1.4); ctx.lineTo(x + r * 1.4, y); ctx.lineTo(x, y + r * 1.4); ctx.lineTo(x - r * 1.4, y);
          ctx.closePath();
          ctx.fill();
          const text = INFERRED_LABELS[name];
          if (detailed && text) {
            // Spine labels on one side, front-of-body labels on the other, to avoid overlap.
            const left = name.startsWith('sternum');
            label(text, x + (left ? -10 : 10) * dpr, y + 4 * dpr, C.cyan, 11, left ? 'right' : 'left');
          }
        }
      }
      // Torso frame axes at the pelvis
      const o = p.joints.midHip.p;
      const L = p.torsoLength * 0.35;
      const axis = (v: { x: number; y: number; z: number }, color: string, text: string) => {
        const a = P(o);
        const b = P({ x: o.x + v.x * L, y: o.y + v.y * L });
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 2.5 * s;
        ctx.beginPath();
        ctx.moveTo(...a);
        ctx.lineTo(...b);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(b[0], b[1], 3 * s, 0, Math.PI * 2);
        ctx.fill();
        if (detailed) label(text, b[0] + 6 * dpr, b[1] + 12 * dpr, color, 10);
      };
      axis(p.torso.lateral, '#f87171', 'lateral (person L)');
      axis(p.torso.up, '#4ade80', 'up');
      axis(p.torso.forward, '#60a5fa', `anterior (z ${p.torso.forward.z.toFixed(2)})`);
      if (detailed) label('■ observed landmark  ◆ inferred (illustrative)  ┅ inferred spine curve', 10 * dpr, h - 12 * dpr, C.text, 12);
      if (p.hipsEstimated) label('Upper-body mode: hips estimated from shoulders', 10 * dpr, 22 * dpr, C.orange, detailed ? 12 : 10);
      break;
    }
    case 'model': {
      ctx.drawImage(d.overlay, 0, 0, w, h);
      if (!d.anatomy) empty('Model hidden (no reliable torso)');
      break;
    }
    case 'composite': {
      frame(1, d.videoFilter);
      ctx.drawImage(d.overlay, 0, 0, w, h);
      break;
    }
  }
}
