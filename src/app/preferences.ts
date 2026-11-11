/**
 * UserPreference persistence (§9): browser localStorage only, no personal data.
 * Wrapped in try/catch because storage can be unavailable (privacy modes, iframes).
 */
import { DEFAULT_SETTINGS, type EngineSettings } from './VisualizerEngine';

const KEY = 'ar-anatomy-visualizer:prefs:v1';
type Persisted = Pick<
  EngineSettings,
  'mirror' | 'smoothing' | 'minVisibility' | 'maxInferenceFps' | 'modelVariant' | 'delegate' | 'resolution' | 'layers' | 'style'
>;

export function loadPreferences(): Partial<EngineSettings> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const p = JSON.parse(raw) as Partial<Persisted>;
    return { ...p, layers: { ...DEFAULT_SETTINGS.layers, ...(p.layers ?? {}) } };
  } catch {
    return {};
  }
}

export function savePreferences(s: EngineSettings): void {
  try {
    const p: Persisted = {
      mirror: s.mirror,
      smoothing: s.smoothing,
      minVisibility: s.minVisibility,
      maxInferenceFps: s.maxInferenceFps,
      modelVariant: s.modelVariant,
      delegate: s.delegate,
      resolution: s.resolution,
      layers: s.layers,
      style: s.style,
    };
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable — preferences simply aren't remembered */
  }
}

export function clearPreferences(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
