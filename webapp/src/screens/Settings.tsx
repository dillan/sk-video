import { THEMES, THEME_LABELS, type Theme } from '../lib/theme';
import { DENSITIES, DENSITY_LABELS, type Density } from '../lib/density';

interface Props {
  theme: Theme;
  onTheme: (t: Theme) => void;
  density: Density;
  onDensity: (d: Density) => void;
}

/**
 * Operator-owned display settings, plus an honest signpost to the Signal K admin for the operational
 * config that re-wires process subsystems on restart (cameras, recording, Frigate, anchor watch). Theme
 * is the one thing that shapes the console itself; it persists per device.
 */
export function Settings({ theme, onTheme, density, onDensity }: Props) {
  return (
    <div className="settings">
      <header className="page-head">
        <div>
          <h1>Settings</h1>
          <div className="page-head__sub">Display · this device</div>
        </div>
      </header>

      <section className="panel">
        <h2 className="panel__title">Theme</h2>
        <p className="muted">
          Dark by default. Day is a light theme for a sunlit helm; Night-Red preserves dark
          adaptation at sea — red on near-black, no glow, dimmed video. Video always stays on a
          near-black mat.
        </p>
        <div className="seg" role="group" aria-label="Theme">
          {THEMES.map((t) => (
            <button
              key={t}
              type="button"
              className={`iconbtn iconbtn--wide${theme === t ? ' iconbtn--on' : ''}`}
              aria-pressed={theme === t}
              onClick={() => onTheme(t)}
            >
              {THEME_LABELS[t]}
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2 className="panel__title">Density</h2>
        <p className="muted">
          Helm is roomy with large touch targets for a moving helm; Desk is tighter for a
          chart-table desktop. Defaults to your device, but your choice wins.
        </p>
        <div className="seg" role="group" aria-label="Density">
          {DENSITIES.map((d) => (
            <button
              key={d}
              type="button"
              className={`iconbtn iconbtn--wide${density === d ? ' iconbtn--on' : ''}`}
              aria-pressed={density === d}
              onClick={() => onDensity(d)}
            >
              {DENSITY_LABELS[d]}
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2 className="panel__title">Operational settings</h2>
        <p className="muted">
          Camera connections, recording, snapshots, Frigate, and anchor watch live in the Signal K
          admin — they re-wire on restart, so they’re owned there, not here. Manage them under{' '}
          <b>Server → Plugin Config → SK Video</b>. Retention is fixed (rolling buffer ~10&nbsp;GiB
          / 48&nbsp;h, ~1000 snapshots) — this is an operator console, not a 24/7 NVR.
        </p>
      </section>
    </div>
  );
}
