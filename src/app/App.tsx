import { useCallback, useState } from 'react';
import { Home } from '../components/Home';
import { LiveView, type SourceRequest } from '../components/LiveView';
import { HelpDialog } from '../components/HelpDialog';
import { DEFAULT_SETTINGS, type EngineSettings } from './VisualizerEngine';
import { loadPreferences, savePreferences } from './preferences';

export function App() {
  const [settings, setSettings] = useState<EngineSettings>(() => ({ ...DEFAULT_SETTINGS, ...loadPreferences() }));
  const [request, setRequest] = useState<SourceRequest | null>(null);
  const [help, setHelp] = useState(false);

  const updateSettings = useCallback((s: EngineSettings) => {
    setSettings(s);
    savePreferences(s);
  }, []);

  const go = useCallback(
    (r: Omit<SourceRequest, 'nonce'>) => {
      // Sensible mirror default per source: mirror a webcam, not a recorded video.
      if (r.kind === 'video' && settings.mirror) updateSettings({ ...settings, mirror: false });
      setRequest((prev) => ({ ...r, nonce: (prev?.nonce ?? 0) + 1 }));
    },
    [settings, updateSettings],
  );

  return (
    <div className="app">
      <a className="skip" href="#main">Skip to content</a>
      <header className="topbar">
        <span className="brand">AR Anatomy Visualizer</span>
        {/* AC-14: persistent limitation notice */}
        <p className="limitation" role="note">
          Illustrative reference model aligned to your estimated pose — <strong>not an X-ray</strong>, not a scan, not a diagnosis.
        </p>
        <button className="btn ghost small" onClick={() => setHelp(true)}>Help</button>
      </header>
      {request ? (
        <LiveView
          request={request}
          settings={settings}
          onSettings={updateSettings}
          onExit={() => setRequest(null)}
          onHelp={() => setHelp(true)}
          onRequest={go}
        />
      ) : (
        <Home
          onStartCamera={() => go({ kind: 'camera' })}
          onStartDemo={() => go({ kind: 'demo' })}
          onStartVideo={(file) => go({ kind: 'video', file })}
          onHelp={() => setHelp(true)}
        />
      )}
      <HelpDialog open={help} onClose={() => setHelp(false)} />
    </div>
  );
}
