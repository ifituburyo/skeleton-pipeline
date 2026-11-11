import type { Vec3 } from '../types/pose';

export const v = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => v(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => v(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a: Vec3, s: number): Vec3 => v(a.x * s, a.y * s, a.z * s);
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 =>
  v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const len = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const dist = (a: Vec3, b: Vec3): number => len(sub(a, b));
export const norm = (a: Vec3, fallback: Vec3 = v(0, 1, 0)): Vec3 => {
  const l = len(a);
  return l < 1e-9 ? { ...fallback } : scale(a, 1 / l);
};
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 =>
  v(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
export const mid = (a: Vec3, b: Vec3): Vec3 => lerp(a, b, 0.5);
/** Sum of weighted vectors. */
export const comb = (...terms: [Vec3, number][]): Vec3 =>
  terms.reduce((acc, [p, w]) => add(acc, scale(p, w)), v());

/** Angle ABC at vertex B in degrees. */
export function angleDeg(a: Vec3, b: Vec3, c: Vec3): number {
  const ba = norm(sub(a, b));
  const bc = norm(sub(c, b));
  const d = Math.min(1, Math.max(-1, dot(ba, bc)));
  return (Math.acos(d) * 180) / Math.PI;
}

/** Catmull-Rom spline through control points, sampled at t∈[0,1]. */
export function catmullRom(points: Vec3[], t: number): Vec3 {
  const n = points.length - 1;
  const f = Math.min(Math.max(t, 0), 1) * n;
  const i = Math.min(Math.floor(f), n - 1);
  const u = f - i;
  const p0 = points[Math.max(i - 1, 0)];
  const p1 = points[i];
  const p2 = points[i + 1];
  const p3 = points[Math.min(i + 2, n)];
  const u2 = u * u;
  const u3 = u2 * u;
  const c = (a: number, b: number, c2: number, d: number) =>
    0.5 * (2 * b + (-a + c2) * u + (2 * a - 5 * b + 4 * c2 - d) * u2 + (-a + 3 * b - 3 * c2 + d) * u3);
  return v(c(p0.x, p1.x, p2.x, p3.x), c(p0.y, p1.y, p2.y, p3.y), c(p0.z, p1.z, p2.z, p3.z));
}
