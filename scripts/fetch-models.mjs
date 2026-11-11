// Downloads MediaPipe Pose Landmarker model files into public/models so the app
// can run fully offline / from its own origin. Licence: Apache 2.0 (Google).
// Usage: npm run fetch-models            (lite + full)
//        npm run fetch-models -- heavy   (also heavy)
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'models');
mkdirSync(out, { recursive: true });
const variants = ['lite', 'full', ...process.argv.slice(2)];
for (const v of new Set(variants)) {
  const file = `pose_landmarker_${v}.task`;
  const dest = join(out, file);
  if (existsSync(dest)) { console.log(`✓ ${file} already present`); continue; }
  const url = `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${v}/float16/latest/${file}`;
  process.stdout.write(`↓ ${file} ... `);
  const res = await fetch(url);
  if (!res.ok) { console.log(`failed (HTTP ${res.status})`); continue; }
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  console.log('done');
}
