import { useEffect, useState } from 'react';
import { fetchActivity, type IActivity } from '../api';
import { formatBytes } from '../lib/format';

/** Poll cadence while the panel is open. Sampling is cheap, but there's no reason to hammer a Pi. */
const POLL_MS = 2500;
/** Temperature that fills the bar — a Pi begins throttling around here, so "full" means "throttling". */
const TEMP_FULL_C = 85;

type Tone = 'ok' | 'busy' | 'high';
const toneFor = (fraction: number, busy: number, high: number): Tone =>
  fraction >= high ? 'high' : fraction >= busy ? 'busy' : 'ok';

/** A labelled meter: name, a filled track, and the current reading. */
function Meter({
  label,
  fraction,
  value,
  tone,
}: {
  label: string;
  fraction: number;
  value: string;
  tone: Tone;
}) {
  const pct = Math.min(100, Math.max(0, Math.round(fraction * 100)));
  return (
    <div className="activity__meter">
      <div className="activity__meterhead">
        <span>{label}</span>
        <span className="mono">{value}</span>
      </div>
      <div
        className="activity__track"
        role="meter"
        aria-label={label}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={`activity__fill activity__fill--${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * Live device activity: whole-host CPU / memory / temperature against capacity, the heaviest
 * processes (the plugin plus the go2rtc and ffmpeg children it spawned), and a plain-language verdict
 * on whether this device is nearing its limit. Polls only while mounted (the Settings panel is open).
 * Temperature stands in for "GPU" — a fanless Pi has no usable GPU counter, and thermal throttling is
 * the real ceiling.
 */
export function ActivityMonitor() {
  const [activity, setActivity] = useState<IActivity | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();
    const poll = async (): Promise<void> => {
      try {
        const a = await fetchActivity(ctrl.signal);
        if (!alive) return;
        setActivity(a);
        setError(false);
      } catch {
        if (alive) setError(true);
      }
    };
    void poll();
    const t = setInterval(() => void poll(), POLL_MS);
    return () => {
      alive = false;
      ctrl.abort();
      clearInterval(t);
    };
  }, []);

  return (
    <section className="panel activity">
      <h2 className="panel__title">Device activity</h2>
      <p className="muted">
        Live load on this device and the video processes running on it. If it’s nearing capacity,
        fewer or lighter streams (or an H.264 sub-stream) will help.
      </p>

      {error && !activity && (
        <p className="chip chip--caution">Can’t read device activity right now.</p>
      )}
      {!error && !activity && <p className="muted">Reading device activity…</p>}
      {error && activity && <p className="muted">Couldn’t refresh — showing the last reading.</p>}

      {activity && (
        <>
          <div className={`activity__verdict activity__verdict--${activity.verdict.level}`}>
            <strong>{activity.verdict.headline}</strong>
            {activity.verdict.reasons.length > 0 && (
              <span className="activity__reasons"> {activity.verdict.reasons.join(' · ')}</span>
            )}
          </div>

          <div className="activity__meters">
            <Meter
              label={`CPU · ${activity.cpu.cores} cores`}
              fraction={activity.cpu.utilization}
              tone={toneFor(activity.cpu.utilization, 0.7, 0.9)}
              value={`${Math.round(activity.cpu.utilization * 100)}% · load ${activity.cpu.loadAvg1.toFixed(2)}`}
            />
            <Meter
              label="Memory"
              fraction={activity.memory.utilization}
              tone={toneFor(activity.memory.utilization, 0.8, 0.9)}
              value={`${formatBytes(activity.memory.usedBytes)} / ${formatBytes(activity.memory.totalBytes)}`}
            />
            {activity.temperatureC !== null ? (
              <Meter
                label="Temperature"
                fraction={activity.temperatureC / TEMP_FULL_C}
                tone={toneFor(activity.temperatureC, 70, 80)}
                value={`${Math.round(activity.temperatureC)}°C`}
              />
            ) : (
              <div className="activity__meter">
                <div className="activity__meterhead">
                  <span>Temperature</span>
                  <span className="muted">not reported</span>
                </div>
              </div>
            )}
          </div>

          {activity.processes.length > 0 && (
            <table className="activity__procs">
              <thead>
                <tr>
                  <th>Process</th>
                  <th>CPU</th>
                  <th>Memory</th>
                </tr>
              </thead>
              <tbody>
                {activity.processes.map((p) => (
                  <tr key={p.pid}>
                    <td className="mono">{p.name}</td>
                    <td className="mono">{Math.round(p.cpuPercent)}%</td>
                    <td className="mono">{formatBytes(p.rssBytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}
