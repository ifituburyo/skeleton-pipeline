// End-to-end smoke test (§12) — runs the production build in headless Chromium.
//   npm run build && npm run e2e
// First time only: npx playwright install chromium
//
// Covers: home + limitation notice (AC-14), demo mode renders an overlay (AC-05/FR-16),
// layer toggles (AC-07), alignment reset (AC-06), stop releases the camera (AC-10),
// fake-camera start → running or understandable model-load error (AC-01/AC-11),
// and no uploads of camera data (AC-09). Screenshots go to test-results/.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 4173;
const URL = `http://localhost:${PORT}/`;
const out = 'test-results';
mkdirSync(out, { recursive: true });

const server = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: 'pipe',
  shell: process.platform === 'win32',
});
// Wait until the preview server answers.
for (let i = 0; ; i++) {
  try {
    if ((await fetch(URL)).ok) break;
  } catch {
    /* not up yet */
  }
  if (i > 100) throw new Error('preview server did not start');
  await new Promise((r) => setTimeout(r, 200));
}

let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) failures++;
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined, // optional: use an installed Chrome
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['camera'] });
  const page = await context.newPage();
  const requests = [];
  page.on('request', (r) => requests.push({ method: r.method(), url: r.url(), size: r.postData()?.length ?? 0 }));
  const consoleErrors = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  // Record Content-Security-Policy violations (blocked connections).
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  await page.goto(URL);
  check(await page.getByRole('note').isVisible(), 'persistent limitation notice is visible');
  await page.screenshot({ path: `${out}/01-home.png` });

  // ---- Demo mode ----
  await page.getByRole('button', { name: 'Demo mode (no camera)' }).click();
  await page.waitForTimeout(2500);
  const painted = await page.evaluate(() => {
    const c = document.querySelector('.overlay-canvas');
    const g = document.createElement('canvas');
    g.width = c.width;
    g.height = c.height;
    const ctx = g.getContext('2d');
    ctx.drawImage(c, 0, 0);
    const d = ctx.getImageData(0, 0, g.width, g.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 20) n++;
    return n / (g.width * g.height);
  });
  check(painted > 0.01, `demo overlay draws the skeleton (${(painted * 100).toFixed(1)}% of pixels)`);
  check(await page.getByText(/Tracking: \d+% good/).isVisible(), 'tracking quality reported as text');
  await page.screenshot({ path: `${out}/02-demo-xray.png` });

  // Live pipeline: 6 stages, each selectable as the main view
  check((await page.locator('.pipe-card').count()) === 6, 'pipeline strip shows 6 live stages');
  await page.locator('.pipe-card', { hasText: 'Anatomy alignment' }).click();
  await page.waitForTimeout(500);
  check(await page.locator('.stage-view:not(.hidden)').isVisible(), 'selecting a stage shows it full-size');
  await page.screenshot({ path: `${out}/02b-stage-anatomy.png` });
  await page.locator('.pipe-card', { hasText: 'Composite' }).click();

  // Layers: labels + joints, open inspector, solid style
  await page.getByLabel('Labels').check();
  await page.getByLabel('Joint markers (observed)').check();
  await page.locator('summary', { hasText: '3D inspector' }).click();
  await page.locator('summary', { hasText: 'Analysis' }).click();
  await page.waitForTimeout(1500);
  check((await page.locator('.bone-label:visible').count()) >= 8, 'bone labels shown when Labels layer is on');
  await page.screenshot({ path: `${out}/03-demo-labels-inspector.png` });

  await page.getByLabel('Visual style').selectOption('solid');
  await page.locator('summary', { hasText: 'Settings' }).click();
  await page.getByLabel('Show raw landmarks (observed)').check();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/04-demo-solid-landmarks.png` });
  await page.getByLabel('Visual style').selectOption('xray');
  await page.getByLabel('Show raw landmarks (observed)').uncheck();

  // Alignment reset (AC-06)
  await page.locator('summary', { hasText: 'Alignment' }).click();
  const scale = page.getByLabel('Scale');
  await scale.fill('1.3');
  await page.getByRole('button', { name: 'Reset alignment' }).click();
  check((await scale.inputValue()) === '1', 'reset restores default alignment');

  // Snapshot only on explicit action (FR-14) + measurement export
  const [shot] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Snapshot' }).click()]);
  await shot.saveAs(`${out}/snapshot.png`);
  check(/anatomy-snapshot-.*\.png$/.test(shot.suggestedFilename()), 'snapshot downloads a PNG');
  await page.getByRole('button', { name: '● Record angles' }).click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: '■ Stop recording' }).click();
  const [csv] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Export CSV/ }).click()]);
  await csv.saveAs(`${out}/angles.csv`);
  const { readFileSync } = await import('node:fs');
  const lines = readFileSync(`${out}/angles.csv`, 'utf8').trim().split('\n');
  check(lines.length > 4 && lines[1].startsWith('t_ms,lElbow_deg'), `angle CSV exported (${lines.length - 2} samples)`);

  // Keyboard pause (FR-19)
  await page.locator('.stage').click();
  await page.keyboard.press('Space');
  await page.waitForTimeout(400);
  check(await page.getByText('Paused', { exact: true }).isVisible(), 'Space pauses tracking');
  await page.keyboard.press('Space');

  // Stop (FR-18)
  await page.getByRole('button', { name: '■ Stop' }).click();
  await page.waitForTimeout(300);
  check(await page.getByText('Camera off. Session data cleared.').isVisible(), 'stop clears the session');

  // ---- Camera (fake device) ----
  await page.getByRole('button', { name: 'Start camera' }).click();
  await page.waitForFunction(
    () => document.querySelector('.error-banner') || document.querySelector('.live-chip'),
    null,
    { timeout: 60000 },
  );
  const cameraRunning = await page.locator('.live-chip').isVisible().catch(() => false);
  if (cameraRunning) {
    check(true, 'fake camera started and pose model loaded');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${out}/05-camera-fake.png` });
    await page.getByRole('button', { name: '■ Stop' }).click();
    await page.waitForTimeout(300);
    const released = await page.evaluate(() => document.querySelector('video').srcObject === null);
    check(released, 'camera stream released on stop (AC-10)');
  } else {
    const msg = await page.locator('.error-banner').innerText();
    check(/Pose model failed to load|Camera/.test(msg), `understandable error shown when model/camera unavailable: "${msg.split('\n')[0]}"`);
    const released = await page.evaluate(() => !document.querySelector('video').srcObject);
    check(released, 'no camera stream left open after a failed start');
    await page.screenshot({ path: `${out}/05-camera-error.png` });
  }

  // Leaving the live view disposes the engine (flushes any MediaPipe telemetry).
  await page.getByRole('button', { name: 'Home' }).click();
  await page.waitForTimeout(1000);

  // ---- Privacy (AC-09) ----
  const csp = await page.evaluate(() => window.__csp);
  const unexpectedCsp = csp.filter((v) => !v.includes('odml.pa.googleapis.com'));
  check(unexpectedCsp.length === 0, `CSP: no unexpected blocked resources${unexpectedCsp.length ? ': ' + unexpectedCsp.join(', ') : ''}`);
  if (csp.length > unexpectedCsp.length) console.log('  (MediaPipe usage-telemetry POST was blocked by the CSP, as intended)');
  const csph = await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? '');
  check(/connect-src 'self' https:\/\/storage\.googleapis\.com(;|$)/.test(csph), 'CSP restricts network connections to this site + model storage');
  const uploads = requests.filter((r) => r.method !== 'GET' && r.method !== 'HEAD');
  check(uploads.length === 0, `no upload requests (${uploads.length} non-GET requests)`);
  const foreign = [...new Set(requests.map((r) => new globalThis.URL(r.url).host))].filter((h) => !h.startsWith('localhost'));
  console.log(`  external hosts contacted: ${foreign.join(', ') || 'none'}`);

  const relevantErrors = consoleErrors.filter(
    (e) => !/storage\.googleapis|odml\.pa\.googleapis|Content Security Policy|Logging failed|Failed to load resource|pose model|ERR_|net::/i.test(e),
  );
  check(relevantErrors.length === 0, `no unexpected console errors${relevantErrors.length ? ': ' + relevantErrors.join(' | ') : ''}`);
} finally {
  await browser.close();
  server.kill();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
