import { useEffect, useState } from 'react';
import {
  fetchOperationalConfig,
  saveOperationalConfig,
  fetchCameras,
  fetchStatus,
  type ICameraEntry,
  type IOperationalConfigPublic,
  type IPluginStatus,
} from '../api';

const TIERS = ['auto', 'minimal', 'pi4', 'accelerated', 'x86'];

/** One camera's health-alarm row: enabled = the server (not the plugin) raises the alarm. */
type HealthZoneRow = { enabled: boolean; warn: string; alarm: string };
const DEFAULT_ZONE_ROW: HealthZoneRow = { enabled: false, warn: '45', alarm: '120' };

type Form = {
  hardwareTier: string;
  anchorWatchPath: string;
  autoTriggerPath: string;
  mobVisualRefine: boolean;
  recordingEnabled: boolean;
  hardwareAcceleration: boolean;
  healthZones: Record<string, HealthZoneRow>;
  mqttHost: string;
  mqttPort: string;
  mqttTls: boolean;
  mqttUsername: string;
  mqttPassword: string; // write-only input; empty = keep stored
  apiUrl: string;
  labels: string;
  minScore: string;
  zones: string;
};

function toForm(c: IOperationalConfigPublic): Form {
  const f = c.frigate;
  return {
    hardwareTier: c.hardwareTier ?? 'auto',
    anchorWatchPath: c.anchorWatchPath ?? '',
    autoTriggerPath: c.autoTriggerPath ?? '',
    mobVisualRefine: c.mobVisualRefine ?? false,
    recordingEnabled: c.recordingEnabled ?? true, // default ON
    hardwareAcceleration: c.hardwareAcceleration ?? false, // default OFF (can be unstable)
    healthZones: Object.fromEntries(
      Object.entries(c.cameraHealthZones ?? {}).map(([id, z]) => [
        id,
        { enabled: true, warn: String(z.warnAfterSeconds), alarm: String(z.alarmAfterSeconds) },
      ]),
    ),
    mqttHost: f.mqttHost ?? '',
    mqttPort: f.mqttPort != null ? String(f.mqttPort) : '',
    mqttTls: f.mqttTls ?? false,
    mqttUsername: f.mqttUsername ?? '',
    mqttPassword: '',
    apiUrl: f.apiUrl ?? '',
    labels: f.labels ?? '',
    minScore: f.minScore != null ? String(f.minScore) : '',
    zones: f.zones ?? '',
  };
}

/** Build the PUT body. Omit mqttPassword unless the operator typed one (so the stored one is kept). */
function toPayload(f: Form): unknown {
  const frigate: Record<string, unknown> = {
    mqttHost: f.mqttHost,
    mqttTls: f.mqttTls,
    mqttUsername: f.mqttUsername,
    apiUrl: f.apiUrl,
    labels: f.labels,
    zones: f.zones,
  };
  if (f.mqttPort.trim() !== '') frigate.mqttPort = Number(f.mqttPort);
  if (f.minScore.trim() !== '') frigate.minScore = Number(f.minScore);
  if (f.mqttPassword !== '') frigate.mqttPassword = f.mqttPassword;
  return {
    hardwareTier: f.hardwareTier,
    anchorWatchPath: f.anchorWatchPath,
    autoTriggerPath: f.autoTriggerPath,
    mobVisualRefine: f.mobVisualRefine,
    recordingEnabled: f.recordingEnabled,
    hardwareAcceleration: f.hardwareAcceleration,
    cameraHealthZones: Object.fromEntries(
      Object.entries(f.healthZones)
        .filter(([, row]) => row.enabled)
        .map(([id, row]) => [
          id,
          { warnAfterSeconds: Number(row.warn), alarmAfterSeconds: Number(row.alarm) },
        ]),
    ),
    frigate,
  };
}

/**
 * The Operational settings — the knobs that used to live in the Signal K admin form (now empty).
 * Saving persists them and briefly restarts the plugin to re-wire MQTT / delta subscriptions / timers,
 * so the form warns that video reconnects for a few seconds. The Frigate broker password is
 * write-only: it's never sent back, and an empty field keeps whatever is already stored.
 */
export function OperationalSettings() {
  const [form, setForm] = useState<Form | null>(null);
  const [status, setStatus] = useState<IPluginStatus | null>(null);
  const [cameraRows, setCameraRows] = useState<ICameraEntry[]>([]);
  const [passwordSet, setPasswordSet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'info' | 'caution'; text: string } | null>(null);

  const load = () => {
    fetchOperationalConfig()
      .then((c) => {
        setForm(toForm(c));
        setPasswordSet(c.frigate.mqttPasswordSet);
      })
      .catch((e: unknown) =>
        setMsg({
          kind: 'caution',
          text: e instanceof Error ? e.message : 'could not load settings',
        }),
      );
    // Best-effort: the health-alarm rows need the camera names; the rest of the form loads anyway.
    fetchCameras()
      .then((cams) => setCameraRows(cams.filter((c) => c.enabled)))
      .catch(() => setCameraRows([]));
    // Best-effort: the ffmpeg probe tells us whether hardware acceleration can do anything here.
    fetchStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  };
  useEffect(load, []);

  const set = <K extends keyof Form>(k: K, v: Form[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  const setZoneRow = (id: string, patch: Partial<HealthZoneRow>) =>
    setForm((f) =>
      f
        ? {
            ...f,
            healthZones: {
              ...f.healthZones,
              [id]: { ...(f.healthZones[id] ?? DEFAULT_ZONE_ROW), ...patch },
            },
          }
        : f,
    );

  const save = async () => {
    if (!form) return;
    setBusy(true);
    setMsg(null);
    try {
      await saveOperationalConfig(toPayload(form));
      setMsg({
        kind: 'info',
        text: 'Saved. Applying… the plugin is restarting, so video reconnects in a few seconds.',
      });
      // Re-read once the restart has settled to reflect the persisted state.
      setTimeout(load, 6000);
    } catch (e: unknown) {
      setMsg({ kind: 'caution', text: e instanceof Error ? e.message : 'save failed' });
    } finally {
      setBusy(false);
    }
  };

  if (!form) {
    return (
      <section className="panel">
        <h2 className="panel__title">Operational settings</h2>
        {msg ? (
          <div className={`chip chip--${msg.kind}`}>{msg.text}</div>
        ) : (
          <div className="chip chip--neutral">Loading…</div>
        )}
      </section>
    );
  }

  return (
    <section className="panel">
      <h2 className="panel__title">Operational settings</h2>
      <p className="muted">
        These used to live in the Signal K admin. Saving persists them and briefly restarts the
        plugin to apply, so live video reconnects for a few seconds. Retention stays fixed (rolling
        buffer ~10&nbsp;GiB / 48&nbsp;h) — this is an operator console, not a 24/7 NVR.
      </p>
      {msg && <div className={`chip chip--${msg.kind}`}>{msg.text}</div>}

      <h3 className="cfg__group">Frigate (optional, your own instance)</h3>
      <p className="muted">
        Surfaces a user-run Frigate’s close-range person/car detections as notifications + cached
        clips. Never bundled; close-range COCO-class only — not a hazard or MOB-at-distance
        detector.
      </p>
      <div className="cfg__grid">
        <label className="field">
          MQTT host
          <input
            value={form.mqttHost}
            placeholder="192.168.1.10 (blank = disabled)"
            onChange={(e) => set('mqttHost', e.target.value)}
          />
        </label>
        <label className="field">
          MQTT port
          <input
            type="number"
            value={form.mqttPort}
            placeholder="1883"
            onChange={(e) => set('mqttPort', e.target.value)}
          />
        </label>
        <label className="field">
          MQTT username
          <input value={form.mqttUsername} onChange={(e) => set('mqttUsername', e.target.value)} />
        </label>
        <label className="field">
          MQTT password
          <input
            type="password"
            value={form.mqttPassword}
            placeholder={passwordSet ? '•••••• (unchanged)' : '(none)'}
            onChange={(e) => set('mqttPassword', e.target.value)}
          />
        </label>
        <label className="field cfg__check">
          <input
            type="checkbox"
            checked={form.mqttTls}
            onChange={(e) => set('mqttTls', e.target.checked)}
          />
          Use TLS (mqtts)
        </label>
        <label className="field">
          HTTP API URL (for clips)
          <input
            value={form.apiUrl}
            placeholder="http://192.168.1.10:5000"
            onChange={(e) => set('apiUrl', e.target.value)}
          />
        </label>
        <label className="field">
          Alert labels
          <input
            value={form.labels}
            placeholder="person,car"
            onChange={(e) => set('labels', e.target.value)}
          />
        </label>
        <label className="field">
          Minimum score (0–1)
          <input
            type="number"
            step="0.05"
            min="0"
            max="1"
            value={form.minScore}
            placeholder="0.7"
            onChange={(e) => set('minScore', e.target.value)}
          />
        </label>
        <label className="field">
          Zones (optional)
          <input
            value={form.zones}
            placeholder="blank = any"
            onChange={(e) => set('zones', e.target.value)}
          />
        </label>
      </div>

      {cameraRows.length > 0 && (
        <>
          <h3 className="cfg__group">Camera health alarms</h3>
          <p className="muted">
            Normally the plugin raises a camera-dark alarm itself. Ticking a camera hands that alarm
            to the Signal K server’s zone watcher instead: the thresholds below become standard zone
            metadata, so any instrument (KIP included) shows the warn/alarm state — the alarm still
            appears in the same place either way.
          </p>
          {cameraRows.map((cam) => {
            const row = form.healthZones[cam.id] ?? DEFAULT_ZONE_ROW;
            return (
              <div className="cfg__grid" key={cam.id}>
                <label className="field cfg__check">
                  <input
                    type="checkbox"
                    checked={row.enabled}
                    onChange={(e) => setZoneRow(cam.id, { enabled: e.target.checked })}
                  />
                  {cam.name}
                </label>
                {row.enabled && (
                  <>
                    <label className="field">
                      Warn after (seconds)
                      <input
                        type="number"
                        min="1"
                        aria-label={`${cam.name} warn after seconds`}
                        value={row.warn}
                        onChange={(e) => setZoneRow(cam.id, { warn: e.target.value })}
                      />
                    </label>
                    <label className="field">
                      Alarm after (seconds)
                      <input
                        type="number"
                        min="2"
                        aria-label={`${cam.name} alarm after seconds`}
                        value={row.alarm}
                        onChange={(e) => setZoneRow(cam.id, { alarm: e.target.value })}
                      />
                    </label>
                  </>
                )}
              </div>
            );
          })}
        </>
      )}

      <h3 className="cfg__group">Automation</h3>
      <div className="cfg__grid">
        <label className="field">
          Anchor / geofence watch path
          <input
            value={form.anchorWatchPath}
            placeholder="notifications.navigation.anchor"
            onChange={(e) => set('anchorWatchPath', e.target.value)}
          />
        </label>
        <label className="field">
          Incident auto-trigger path
          <input
            value={form.autoTriggerPath}
            placeholder="blank = manual only"
            onChange={(e) => set('autoTriggerPath', e.target.value)}
          />
        </label>
      </div>
      <label className="field cfg__check">
        <input
          type="checkbox"
          checked={form.mobVisualRefine}
          onChange={(e) => set('mobVisualRefine', e.target.checked)}
        />
        Experimental visual MOB refine — <b>NOT safety-rated</b>; needs Frigate; fails safe to
        position-based aim
      </label>

      <label className="field cfg__check">
        <input
          type="checkbox"
          checked={form.recordingEnabled}
          onChange={(e) => set('recordingEnabled', e.target.checked)}
        />
        Buffered recording (per-camera Record + incident pre-roll). Turn off on a constrained host
        to save CPU and disk — recording is a copy, not a re-encode, so the saving is modest.
      </label>

      <label className="field cfg__check">
        <input
          type="checkbox"
          checked={form.hardwareAcceleration}
          onChange={(e) => set('hardwareAcceleration', e.target.checked)}
        />
        Hardware video acceleration (experimental). Uses the GPU to transcode H.265 cameras that
        have no H.264 sub-stream, so they play smoothly instead of falling to the low-frame-rate
        still image. Off by default — it can be unstable, and on a Raspberry Pi only the encode is
        offloaded (the H.265 decode stays on the CPU).
      </label>
      {form.hardwareAcceleration &&
        status?.ffmpegHwaccel != null &&
        (status.ffmpegHwaccel.hardwareEncode ? (
          <p className="muted">
            Hardware encoder detected: {status.ffmpegHwaccel.h264Encoders.join(', ')}.
          </p>
        ) : (
          <p className="chip chip--caution">
            {status.ffmpegHwaccel.ffmpegPresent
              ? 'No hardware H.264 encoder detected on this host — this setting will have no effect (software transcode).'
              : 'ffmpeg was not found on this host — transcoding (and this setting) can’t work until it’s installed.'}
          </p>
        ))}

      <h3 className="cfg__group">Advanced</h3>
      <label className="field">
        Hardware tier override
        <select value={form.hardwareTier} onChange={(e) => set('hardwareTier', e.target.value)}>
          {TIERS.map((t) => (
            <option key={t} value={t}>
              {t === 'auto' ? 'Auto-detect' : t}
            </option>
          ))}
        </select>
      </label>
      <p className="muted">
        The override is advisory — it re-budgets features (recording channels, analytics hints) but
        can’t make slower hardware faster. Leave it on auto-detect unless detection got it wrong.
      </p>

      <div className="wizard__actions">
        <button
          type="button"
          className="iconbtn iconbtn--wide iconbtn--on"
          disabled={busy}
          onClick={() => void save()}
        >
          {busy ? 'Saving…' : 'Save & apply'}
        </button>
      </div>
    </section>
  );
}
