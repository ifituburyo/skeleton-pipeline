/**
 * 2D canvas layers: raw-landmark debug overlay (backlog #4) and the synthetic
 * "person" silhouette shown behind the skeleton in Demo mode.
 */
import type { Landmark } from '../types/pose';
import type { TrackedLandmark } from '../tracking/LandmarkTracker';
import { DEBUG_CONNECTIONS, LM } from '../anatomy/landmarks';

function prep(canvas: HTMLCanvasElement, mirrored: boolean): CanvasRenderingContext2D | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (mirrored) ctx.setTransform(-1, 0, 0, 1, w, 0);
  return ctx;
}

/** Observed landmarks: filled = tracked, hollow = held (occluded), omitted = lost. */
export function drawLandmarkDebug(
  canvas: HTMLCanvasElement,
  lms: TrackedLandmark[] | null,
  mirrored: boolean,
  showIds: boolean,
): void {
  const ctx = prep(canvas, mirrored);
  if (!ctx || !lms) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.lineWidth = Math.max(1.5, w / 600);
  ctx.strokeStyle = 'rgba(250, 204, 21, 0.75)';
  for (const [a, b] of DEBUG_CONNECTIONS) {
    if (lms[a].state === 'lost' || lms[b].state === 'lost') continue;
    ctx.beginPath();
    ctx.moveTo(lms[a].x * w, lms[a].y * h);
    ctx.lineTo(lms[b].x * w, lms[b].y * h);
    ctx.stroke();
  }
  const r = Math.max(3, w / 260);
  ctx.font = `${Math.round(r * 2.6)}px ui-monospace, monospace`;
  lms.forEach((l, i) => {
    if (l.state === 'lost') return;
    ctx.beginPath();
    ctx.arc(l.x * w, l.y * h, r, 0, Math.PI * 2);
    if (l.state === 'tracked') {
      ctx.fillStyle = '#facc15';
      ctx.fill();
    } else {
      ctx.strokeStyle = '#fb923c';
      ctx.stroke();
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.75)';
    }
    if (showIds) {
      ctx.save();
      if (mirrored) ctx.setTransform(1, 0, 0, 1, 0, 0);
      const x = mirrored ? w - l.x * w : l.x * w;
      ctx.fillStyle = '#fff';
      ctx.fillText(String(i), x + r * 1.4, l.y * h - r);
      ctx.restore();
    }
  });
}

/** Soft silhouette of the synthetic demo body (stands in for camera video). */
export function drawDemoSilhouette(canvas: HTMLCanvasElement, lms: Landmark[] | null, mirrored: boolean): void {
  const ctx = prep(canvas, mirrored);
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const g = ctx.createRadialGradient(w / 2, h * 0.45, h * 0.1, w / 2, h / 2, h);
  g.addColorStop(0, '#1d2b3a');
  g.addColorStop(1, '#070b10');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.07)';
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += h / 12) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += h / 12) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.restore();
  if (!lms) return;
  const P = (i: number) => [lms[i].x * w, lms[i].y * h] as const;
  const shoulderW = Math.hypot(P(LM.LEFT_SHOULDER)[0] - P(LM.RIGHT_SHOULDER)[0], P(LM.LEFT_SHOULDER)[1] - P(LM.RIGHT_SHOULDER)[1]);
  const limb = (pts: number[], width: number) => {
    ctx.beginPath();
    pts.forEach((i, k) => (k === 0 ? ctx.moveTo(...P(i)) : ctx.lineTo(...P(i))));
    ctx.lineWidth = width;
    ctx.stroke();
  };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(120, 140, 160, 0.38)';
  ctx.fillStyle = 'rgba(120, 140, 160, 0.38)';
  // Torso polygon
  ctx.beginPath();
  [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.RIGHT_HIP, LM.LEFT_HIP].forEach((i, k) => (k ? ctx.lineTo(...P(i)) : ctx.moveTo(...P(i))));
  ctx.closePath();
  ctx.lineWidth = shoulderW * 0.35;
  ctx.fill();
  ctx.stroke();
  limb([LM.LEFT_SHOULDER, LM.LEFT_ELBOW, LM.LEFT_WRIST, LM.LEFT_INDEX], shoulderW * 0.26);
  limb([LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW, LM.RIGHT_WRIST, LM.RIGHT_INDEX], shoulderW * 0.26);
  limb([LM.LEFT_HIP, LM.LEFT_KNEE, LM.LEFT_ANKLE, LM.LEFT_FOOT_INDEX], shoulderW * 0.36);
  limb([LM.RIGHT_HIP, LM.RIGHT_KNEE, LM.RIGHT_ANKLE, LM.RIGHT_FOOT_INDEX], shoulderW * 0.36);
  // Neck + head
  const ms = [(P(LM.LEFT_SHOULDER)[0] + P(LM.RIGHT_SHOULDER)[0]) / 2, (P(LM.LEFT_SHOULDER)[1] + P(LM.RIGHT_SHOULDER)[1]) / 2] as const;
  const ear = [(P(LM.LEFT_EAR)[0] + P(LM.RIGHT_EAR)[0]) / 2, (P(LM.LEFT_EAR)[1] + P(LM.RIGHT_EAR)[1]) / 2] as const;
  ctx.beginPath();
  ctx.moveTo(...ms);
  ctx.lineTo(...ear);
  ctx.lineWidth = shoulderW * 0.25;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(ear[0], ear[1] - shoulderW * 0.05, shoulderW * 0.27, shoulderW * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();
}
