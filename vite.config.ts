/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync } from 'node:fs';

/**
 * Content-Security-Policy (NFR-06/NFR-07, AC-09).
 *
 * The page may only connect to its own origin and Google's public model storage
 * (for the pose-model download). This also blocks the usage-telemetry POST that the
 * MediaPipe Tasks library sends to odml.pa.googleapis.com — it has no opt-out — so
 * nothing about the session leaves the device. If you self-host the model files
 * (`npm run fetch-models`) you can drop storage.googleapis.com from connect-src.
 */
function contentSecurityPolicy(): Plugin {
  let dev = false;
  return {
    name: 'csp-meta',
    configResolved(c) {
      dev = c.command === 'serve';
    },
    transformIndexHtml() {
      const policy = [
        "default-src 'self'",
        // 'wasm-unsafe-eval' lets the MediaPipe WASM runtime compile; dev adds inline for Vite's HMR preamble.
        `script-src 'self' 'wasm-unsafe-eval'${dev ? " 'unsafe-inline'" : ''}`,
        `style-src 'self'${dev ? " 'unsafe-inline'" : ''}`,
        `connect-src 'self' https://storage.googleapis.com${dev ? ' ws: wss:' : ''}`,
        "img-src 'self' data: blob:",
        "media-src 'self' blob: mediastream:",
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'none'",
      ].join('; ');
      return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' }];
    },
  };
}

/**
 * @mediapipe/tasks-vision's vision_bundle.mjs ends with
 * `//# sourceMappingURL=vision_bundle_mjs.js.map`, but the package ships the map as
 * `vision_bundle.mjs.map`. Vite's dev server then logs "Failed to load source map".
 * Load the bundle ourselves and attach the correct map.
 */
function mediapipeSourceMapFix(): Plugin {
  return {
    name: 'mediapipe-sourcemap-fix',
    apply: 'serve',
    enforce: 'pre',
    load(id) {
      const file = id.split('?')[0];
      if (!/[\\/]@mediapipe[\\/]tasks-vision[\\/]vision_bundle\.mjs$/.test(file)) return null;
      const code = readFileSync(file, 'utf8').replace(/\/\/# sourceMappingURL=\S+\s*$/, '');
      const mapFile = file.replace(/\.mjs$/, '.mjs.map');
      return { code, map: existsSync(mapFile) ? readFileSync(mapFile, 'utf8') : null };
    },
  };
}

export default defineConfig({
  plugins: [react(), contentSecurityPolicy(), mediapipeSourceMapFix()],
  // MediaPipe ships its own WASM loader; keep it out of dependency pre-bundling.
  optimizeDeps: { exclude: ['@mediapipe/tasks-vision'] },
  server: { host: true, port: 5173 },
  build: { chunkSizeWarningLimit: 1500 },
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
  },
});
