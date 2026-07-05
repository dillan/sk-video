import { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyImagingPreset,
  ptzNudge,
  ptzStop,
  listPtzPresets,
  gotoPtzPreset,
  captureSnapshot,
  setRecording,
  fetchPtzPosition,
  setSpotlight,
  setAlarm,
  type ICameraEntry,
  type IPtzPreset,
  type TImagingPreset,
  type TStreamVariant,
  type TTransport,
} from '../api';
import { codecLabel, transportLabel } from '../lib/transport';
import { allowPadEvent } from '../lib/ptz-prefs';
import { actionMessage, type IMsg } from '../lib/camera-messages';
import { useWriteGate } from '../lib/auth';
import { GlassMenu, type IMenuRow } from './GlassMenu';
import { PtzPad, type IPtzDetail } from './PtzPad';
import { useTwoWayTalk } from './useTwoWayTalk';

/**
 * The floating-cluster camera controls (Deference v2 "floating clusters"). Controls float as separate
 * glass clusters over the video — never one solid toolbar — and adapt per form factor: an oversized
 * tablet/desktop layout and a denser phone thumb-zone layout. Each cluster wires to real backend
 * capability: vision = imaging presets, zoom/aim/presets = ONVIF PTZ, capture = snapshot/record, the
 * stream chip = the served variants. Capabilities the camera/backend doesn't report are not shown.
 */

interface Props {
  cameraId: string;
  camera: ICameraEntry;
  formFactor: 'phone' | 'tablet';
  padSize: number;
  rung: TTransport;
  /** Still-refresh (~1 fps): continuous pan is blocked (steering blind between frames); discrete
   *  nudges + zoom stay usable — they're one-shot, and a nudge kicks the fast frame refresh. */
  delayed: boolean;
  variant: TStreamVariant;
  hasSub: boolean;
  mainIsHevc: boolean;
  onVariant: (v: TStreamVariant) => void;
  /** Manual transport pin (null = auto walk). A pinned rung never falls back — that's the point. */
  forcedTransport: TTransport | null;
  onForceTransport: (t: TTransport | null) => void;
  /** Per-device opt-in for continuous press-and-hold pan; discrete nudges are the default. */
  continuousPan: boolean;
  /** Tier gate for the record button: `allowed: false` disables it with the reason as the tooltip
   *  (zero recording channels is a hardware fact). Channel exhaustion stays the runtime 409. */
  recordGate?: { allowed: boolean; reason: string };
  onBack: () => void;
  live: boolean;
  flash: (m: IMsg) => void;
  /** Bump the player's fast-refresh window while a PTZ control is being driven. */
  onPtzActivity: () => void;
  /** Whether camera audio is being listened to (unmuted), and the toggle for it. */
  listening: boolean;
  onListen: (on: boolean) => void;
}

const VISION_MODES: { id: TImagingPreset; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'day', label: 'Day' },
  { id: 'night', label: 'Night' },
  { id: 'fog', label: 'Fog' },
  { id: 'glare', label: 'Glare' },
];

/* Stroke goes through `style` (not the SVG attribute) because callers pass var(--…) theme tokens —
 * Night-Red remaps them in CSS, and presentation attributes can't resolve custom properties. */
const svg = (path: string, w = 16, stroke = 'currentColor', sw = 1.9): React.ReactElement => (
  <svg width={w} height={w} viewBox="0 0 24 24" fill="none" style={{ stroke }} strokeWidth={sw}>
    {path.split('|').map((d, i) => (
      <path key={i} d={d} />
    ))}
  </svg>
);

/* Connected-state dot colours as theme tokens, so Night-Red's no-green remap applies. */
const DOT_LIVE = 'var(--status-online)';
const DOT_IDLE = 'var(--status-dark)';
const ICON = {
  vision:
    'M12 8a4 4 0 100 8 4 4 0 000-8|M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2',
  preset: 'M12 21s-7-5.6-7-11a7 7 0 0114 0c0 5.4-7 11-7 11z|M12 10.4a2.4 2.4 0 100-.01',
  caretDown: 'M6 9l6 6 6-6',
  caretUp: 'M6 15l6-6 6 6',
  back: 'M15 6l-6 6 6 6',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  snapshot: 'M3 6h18v13H3z|M12 9.1a3.4 3.4 0 100 6.8 3.4 3.4 0 000-6.8',
  record: 'M5 11h14v9H5z|M8 11V8a4 4 0 018 0v3',
  speaker: 'M4 9v6h4l5 4V5L8 9zM16 8a5 5 0 010 8',
  mic: 'M12 3a3 3 0 013 3v5a3 3 0 01-6 0V6a3 3 0 013-3z|M5 11a7 7 0 0014 0M12 18v3',
  spotlight:
    'M12 3a6 6 0 00-4 10.5c.6.5 1 1.4 1 2.5h6c0-1.1.4-2 1-2.5A6 6 0 0012 3z|M9 20h6M10 22.5h4',
  alarm: 'M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0',
};

export function CameraControls(props: Props) {
  const { cameraId, camera, formFactor, padSize, rung, delayed, variant, hasSub, onVariant } =
    props;
  const { mainIsHevc, onBack, live, flash, onPtzActivity, listening, onListen } = props;
  const { forcedTransport, onForceTransport, continuousPan, recordGate } = props;
  const ptz = camera.capabilities?.ptz === true;
  const hasAudio = camera.capabilities?.audio === true;
  const hasBackchannel = camera.capabilities?.audioBackchannel === true;
  const hasSpotlight = camera.capabilities?.spotlight === true;
  const hasAlarm = camera.capabilities?.alarm === true;
  const phone = formFactor === 'phone';
  const talk = useTwoWayTalk(cameraId, flash);
  // Read-only: every camera command (aim, zoom, presets, vision, snapshot, record, spotlight, alarm)
  // is a write, so disable them with a reason. Viewing the feed + listening stay available.
  const gate = useWriteGate('Camera controls need write access — ask an admin.');

  // ONVIF aux fixtures (spotlight / alarm). ONVIF has no reliable read-back, so state is optimistic:
  // reflect the requested state, and roll back + report if the command fails. The alarm is audible, so
  // turning it on takes a confirm.
  const [spotlightOn, setSpotlightOn] = useState(false);
  const toggleSpotlight = (): void => {
    const next = !spotlightOn;
    setSpotlightOn(next);
    void setSpotlight(cameraId, next).catch((err: unknown) => {
      setSpotlightOn(!next);
      flash(actionMessage(err, next ? 'turn on the spotlight' : 'turn off the spotlight'));
    });
  };
  const [alarmOn, setAlarmOn] = useState(false);
  const toggleAlarm = (): void => {
    const next = !alarmOn;
    if (next && !window.confirm('Sound this camera’s alarm? It plays an audible siren.')) return;
    setAlarmOn(next);
    void setAlarm(cameraId, next).catch((err: unknown) => {
      setAlarmOn(!next);
      flash(actionMessage(err, next ? 'sound the alarm' : 'stop the alarm'));
    });
  };

  // --- Vision (imaging presets) ---
  const [vision, setVision] = useState<TImagingPreset>('auto');
  const pickVision = (m: TImagingPreset): void => {
    setVision(m);
    void applyImagingPreset(cameraId, m).catch((err: unknown) =>
      flash(actionMessage(err, 'change the picture')),
    );
  };

  // --- Zoom (ONVIF continuousMove zoom) + normalized position readout ---
  const [zoomPct, setZoomPct] = useState<number | null>(null);
  const refreshZoom = useCallback(() => {
    fetchPtzPosition(cameraId)
      .then((p) => setZoomPct(typeof p.zoom === 'number' ? Math.round(p.zoom * 100) : null))
      .catch(() => setZoomPct(null));
  }, [cameraId]);
  useEffect(() => {
    if (ptz) refreshZoom();
  }, [ptz, refreshZoom]);
  const zoomStep = (dir: number): void => {
    onPtzActivity();
    void ptzNudge(cameraId, { zoom: dir * 0.5 })
      .then(() => setTimeout(() => void ptzStop(cameraId).catch(() => undefined), 350))
      .then(() => setTimeout(refreshZoom, 500))
      .catch((err: unknown) => flash(actionMessage(err, 'zoom')));
  };

  // --- Aim (pad drag = throttled velocity joystick, chevron = discrete step) ---
  const lastPan = useRef<{ t: number; timer: ReturnType<typeof setTimeout> | null }>({
    t: 0,
    timer: null,
  });
  const sendPan = useCallback(
    (x: number, y: number) => {
      if (lastPan.current.timer) clearTimeout(lastPan.current.timer);
      const fire = (): void => {
        lastPan.current = { t: Date.now(), timer: null };
        void ptzNudge(cameraId, { pan: x, tilt: y }).catch((err: unknown) =>
          flash(actionMessage(err, 'move the camera')),
        );
      };
      const wait = Math.max(0, 140 - (Date.now() - lastPan.current.t));
      if (wait === 0) fire();
      else lastPan.current.timer = setTimeout(fire, wait);
    },
    [cameraId, flash],
  );
  const onPtzPad = useCallback(
    (d: IPtzDetail) => {
      onPtzActivity();
      if (d.type === 'panend') {
        if (lastPan.current.timer) clearTimeout(lastPan.current.timer);
        lastPan.current = { t: 0, timer: null };
        void ptzStop(cameraId).catch(() => undefined);
      } else if (d.type === 'step') {
        void ptzNudge(cameraId, { pan: d.x * 0.5, tilt: d.y * 0.5 })
          .then(() => setTimeout(() => void ptzStop(cameraId).catch(() => undefined), 350))
          .catch((err: unknown) => flash(actionMessage(err, 'move the camera')));
      } else {
        sendPan(d.x, d.y);
      }
    },
    [cameraId, flash, onPtzActivity, sendPan],
  );
  const stopAll = (): void => {
    onPtzActivity();
    void ptzStop(cameraId).catch((err: unknown) => flash(actionMessage(err, 'stop')));
  };

  // --- Presets (named PTZ presets) ---
  const [presets, setPresets] = useState<IPtzPreset[] | null>(null);
  const [presetName, setPresetName] = useState<string | null>(null);
  useEffect(() => {
    if (!ptz) return;
    const ctrl = new AbortController();
    listPtzPresets(cameraId, ctrl.signal)
      .then(setPresets)
      .catch(() => setPresets([]));
    return () => ctrl.abort();
  }, [cameraId, ptz]);
  const gotoPreset = (p: IPtzPreset): void => {
    setPresetName(p.name ?? p.token);
    void gotoPtzPreset(cameraId, p.token).catch((err: unknown) =>
      flash(actionMessage(err, 'recall the preset')),
    );
  };

  // --- Capture (snapshot + record) ---
  const [recording, setRec] = useState(false);
  const snapshot = (): void => {
    void captureSnapshot(cameraId)
      .then((r) =>
        flash(
          r.hasFix === false
            ? { kind: 'caution', text: 'Snapshot saved — no GPS fix, position not stamped.' }
            : { kind: 'info', text: 'Snapshot saved.' },
        ),
      )
      .catch((err: unknown) => flash(actionMessage(err, 'save a snapshot')));
  };
  const toggleRecord = (): void => {
    void setRecording(cameraId, !recording)
      .then((r) => {
        setRec(r.recording);
        flash({ kind: 'info', text: r.recording ? 'Recording started.' : 'Recording stopped.' });
      })
      .catch((err: unknown) => flash(actionMessage(err, 'record')));
  };

  // --- Stream variants we actually serve (main, and the H.264 sub when present) ---
  const streamRows: IMenuRow[] = [
    {
      key: 'main',
      label: 'Main',
      sub: `${codecLabel(camera.media?.codec ?? 'h264')} · ${transportLabel(rung)}`,
      active: variant === 'main',
      dot: variant === 'main' && live ? DOT_LIVE : DOT_IDLE,
      onSelect: () => onVariant('main'),
    },
  ];
  if (hasSub) {
    streamRows.push({
      key: 'sub',
      label: 'Sub',
      sub: `H.264 · ${transportLabel(variant === 'sub' ? rung : 'webrtc')}`,
      active: variant === 'sub',
      dot: variant === 'sub' && live ? DOT_LIVE : DOT_IDLE,
      onSelect: () => onVariant('sub'),
    });
  }
  // Manual transport pin: auto is the server walk with fallback; a pinned rung plays exactly that
  // transport (useful to force low-latency WebRTC while docking, or to hold HLS on a weak link).
  streamRows.push({
    key: 't-auto',
    label: 'Transport · Auto',
    sub: 'server-recommended walk with fallback',
    active: forcedTransport === null,
    onSelect: () => onForceTransport(null),
  });
  for (const t of ['webrtc', 'hls', 'mjpeg'] as TTransport[]) {
    streamRows.push({
      key: `t-${t}`,
      label: `Transport · ${transportLabel(t)}`,
      sub: 'pinned — no automatic fallback',
      active: forcedTransport === t,
      onSelect: () => onForceTransport(t),
    });
  }

  // --- Discovered capabilities: only ones the camera reports AND we can act on. Audio "Listen"
  //     (unmute the stream) and "Two-way audio" (mic → the camera's native backchannel) are the ones
  //     with real backing; spotlight / alarm have no capability flag or endpoint, so — per "don't
  //     invent capabilities" — they're intentionally absent until a camera reports and a route drives them. ---
  interface ICapability {
    key: string;
    label: string;
    icon: string;
    active: boolean;
    busy?: boolean;
    onToggle: () => void;
  }
  const capabilities: ICapability[] = [];
  if (hasAudio) {
    capabilities.push({
      key: 'listen',
      label: 'Listen',
      icon: ICON.speaker,
      active: listening,
      onToggle: () => onListen(!listening),
    });
  }
  if (hasBackchannel) {
    capabilities.push({
      key: 'talk',
      label: 'Two-way audio',
      icon: ICON.mic,
      active: talk.talking,
      busy: talk.connecting,
      onToggle: talk.toggle,
    });
  }
  if (hasSpotlight) {
    capabilities.push({
      key: 'spotlight',
      label: 'Spotlight',
      icon: ICON.spotlight,
      active: spotlightOn,
      onToggle: toggleSpotlight,
    });
  }
  if (hasAlarm) {
    capabilities.push({
      key: 'alarm',
      label: 'Alarm',
      icon: ICON.alarm,
      active: alarmOn,
      onToggle: toggleAlarm,
    });
  }

  const caret = (open: boolean): React.ReactElement => (
    <span className={`menu__caret${open ? ' menu__caret--open' : ''}`}>
      {svg(ICON.caretDown, 14, 'var(--cx-muted)', 2)}
    </span>
  );

  const visionChip = (
    <GlassMenu
      title="Vision mode"
      align="center"
      up={phone}
      trigger={(open, toggle) => (
        <button
          type="button"
          className="cchip"
          onClick={toggle}
          aria-expanded={open}
          aria-label="Vision mode"
          disabled={gate.disabled}
          title={gate.title}
        >
          <span className="cchip__icon">{svg(ICON.vision, 16, 'var(--cx-accent-ico)')}</span>
          <span className="cchip__strong">{VISION_MODES.find((m) => m.id === vision)?.label}</span>
          <span className="cchip__muted">vision</span>
          {caret(open)}
        </button>
      )}
      rows={VISION_MODES.map((m) => ({
        key: m.id,
        label: m.label,
        active: m.id === vision,
        onSelect: () => pickVision(m.id),
      }))}
    />
  );

  const presetsChip = (
    <GlassMenu
      title="PTZ presets"
      align="center"
      up
      trigger={(open, toggle) => (
        <button
          type="button"
          className="cchip cchip--strong"
          onClick={toggle}
          aria-expanded={open}
          aria-label="PTZ presets"
          disabled={gate.disabled}
          title={gate.title}
        >
          <span className="cchip__icon">{svg(ICON.preset, 15, 'var(--cx-accent-ico)')}</span>
          <span>{presetName ?? 'Presets'}</span>
          <span className={`menu__caret${open ? ' menu__caret--open' : ''}`}>
            {svg(ICON.caretUp, 14, 'var(--cx-muted)', 2)}
          </span>
        </button>
      )}
      rows={
        presets && presets.length
          ? presets.map((p) => ({
              key: p.token,
              label: p.name ?? p.token,
              active: (p.name ?? p.token) === presetName,
              onSelect: () => gotoPreset(p),
            }))
          : [{ key: 'none', label: 'No saved presets', disabled: true, onSelect: () => undefined }]
      }
    />
  );

  const streamChip = (
    <GlassMenu
      title="Stream variant"
      align="right"
      trigger={(open, toggle) => (
        <button
          type="button"
          className="cchip cchip--mono"
          onClick={toggle}
          aria-expanded={open}
          aria-label="Stream variant"
        >
          <span className="cchip__dot" style={{ background: live ? DOT_LIVE : DOT_IDLE }} />
          {variant === 'sub' ? 'sub' : 'main'} · {transportLabel(rung)}
          {caret(open)}
        </button>
      )}
      rows={streamRows}
    />
  );

  const zoomPill = ptz && (
    <div className={`zoompill${delayed ? ' zoompill--off' : ''}`}>
      <button
        type="button"
        className="zoompill__btn"
        aria-label="Zoom in"
        onClick={() => zoomStep(1)}
        disabled={gate.disabled}
        title={gate.title}
      >
        {svg(ICON.plus, 17, 'currentColor', 2)}
      </button>
      <span className="zoompill__read mono">{zoomPct === null ? '—' : `${zoomPct}%`}</span>
      <button
        type="button"
        className="zoompill__btn"
        aria-label="Zoom out"
        onClick={() => zoomStep(-1)}
        disabled={gate.disabled}
        title={gate.title}
      >
        {svg(ICON.minus, 17, 'currentColor', 2)}
      </button>
    </div>
  );

  // Discrete steps + the safety stop always pass; continuous drag needs the per-device opt-in AND
  // a live feed (dragging a ~1 fps still-refresh steers blind between frames).
  const onPad = (d: IPtzDetail): void => {
    if (gate.disabled) return; // read-only: the pad is inert (also dimmed via .aim--readonly)
    if (allowPadEvent(d.type, { continuous: continuousPan, delayed })) onPtzPad(d);
  };
  const aimGroup = ptz && (
    <div
      className={`aim${delayed ? ' aim--degraded' : ''}${gate.disabled ? ' aim--readonly' : ''}`}
    >
      {zoomPill}
      <div className="aim__housing" title={gate.title}>
        <PtzPad size={padSize} onPtz={onPad} />
      </div>
      <button
        type="button"
        className={`stopbtn${phone ? ' stopbtn--phone' : ''}`}
        onClick={stopAll}
        aria-label="Stop camera movement"
        disabled={gate.disabled}
        title={gate.title}
      >
        STOP
      </button>
    </div>
  );

  const recordBlocked = recordGate?.allowed === false;
  const capturePod = (
    <div className="pod">
      <button
        type="button"
        className="pod__btn"
        aria-label="Snapshot"
        onClick={snapshot}
        disabled={gate.disabled}
        title={gate.title}
      >
        {svg(ICON.snapshot, 21, 'currentColor', 1.8)}
      </button>
      <button
        type="button"
        className={`pod__btn${recording ? ' pod__btn--rec' : ''}`}
        aria-label={recording ? 'Stop recording' : 'Record'}
        disabled={gate.disabled || recordBlocked}
        title={gate.disabled ? gate.title : recordBlocked ? recordGate?.reason : undefined}
        onClick={toggleRecord}
      >
        {svg(ICON.record, 20, 'currentColor', 2)}
      </button>
    </div>
  );

  const capabilityRail = capabilities.length > 0 && (
    <div className="rail">
      {capabilities.map((c) => (
        <button
          key={c.key}
          type="button"
          className={`rail__btn${c.active ? ' rail__btn--on' : ''}${c.busy ? ' rail__btn--busy' : ''}`}
          aria-pressed={c.active}
          aria-label={c.label}
          onClick={c.onToggle}
          disabled={gate.disabled}
          title={gate.title}
        >
          {svg(c.icon, 21, 'currentColor', 1.8)}
        </button>
      ))}
    </div>
  );

  const identity = (
    <div className="ctop__id">
      <button type="button" className="ctop__back" onClick={onBack} aria-label="Back to Live">
        {svg(ICON.back, 18, 'currentColor', 2)}
      </button>
      <span className={`livechip${live ? ' livechip--on' : ''}`}>
        <span className="livechip__dot" />
        {live ? 'LIVE' : '…'}
      </span>
      <span className="ctop__name">{camera.name ?? cameraId}</span>
    </div>
  );

  const delayNote = delayed && ptz && (
    <div className="cluster__note chip chip--caution">
      still-refresh ~1 fps — tap to nudge (continuous pan off)
    </div>
  );
  const subNote = variant === 'sub' && mainIsHevc && (
    <div className="cluster__note chip chip--caution">H.264 sub · main is H.265</div>
  );

  if (phone) {
    // Phone: top bar (back·LIVE·name·stream), then three stacked bottom rows.
    const moreMenu = (
      <GlassMenu
        title="Vision mode"
        align="left"
        up
        trigger={(open, toggle) => (
          <button
            type="button"
            className="morebtn"
            onClick={toggle}
            aria-label="More controls"
            aria-expanded={open}
            disabled={gate.disabled}
            title={gate.title}
          >
            <span /> <span /> <span />
          </button>
        )}
        rows={VISION_MODES.map((m) => ({
          key: m.id,
          label: m.label,
          active: m.id === vision,
          onSelect: () => pickVision(m.id),
        }))}
        footer={
          capabilities.length > 0 ? (
            <>
              <div className="menu__sep" />
              {capabilities.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  className="menu__row"
                  aria-pressed={c.active}
                  aria-label={c.label}
                  onClick={c.onToggle}
                >
                  <span className="menu__rowmain">
                    <span className="menu__label">{c.label}</span>
                  </span>
                  <span className={`toggle${c.active ? ' toggle--on' : ''}`} aria-hidden="true" />
                </button>
              ))}
            </>
          ) : undefined
        }
      />
    );
    return (
      <>
        <div className="ctop ctop--phone">
          {identity}
          <div className="ctop__spacer" />
          {streamChip}
        </div>
        <div className="cbottom cbottom--phone">
          <div className="cbottom__presets">{presetsChip}</div>
          <div className="cbottom__row">
            {moreMenu}
            {aimGroup}
            {capturePod}
          </div>
          {(delayNote || subNote) && (
            <div className="cbottom__notes">
              {delayNote}
              {subNote}
            </div>
          )}
        </div>
      </>
    );
  }

  // Tablet / desktop: vision top-center, capabilities bottom-left, presets-above-aim bottom-center,
  // capture bottom-right, identity top-left, stream top-right.
  return (
    <>
      <div className="ctop">
        {identity}
        <div className="cvision">{visionChip}</div>
        {streamChip}
      </div>
      {capabilityRail && <div className="ccap">{capabilityRail}</div>}
      <div className="ccenter">
        {presetsChip}
        {aimGroup}
        {(delayNote || subNote) && (
          <div className="cluster__notes">
            {delayNote}
            {subNote}
          </div>
        )}
      </div>
      <div className="ccapture">{capturePod}</div>
    </>
  );
}
