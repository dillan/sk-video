import { CAMERA_CODECS, type ICamera, type ICameraCapabilities } from './camera-validation';
import type { IIntrospectResult } from '../onvif/onvif-introspect';

/**
 * Merge a fresh ONVIF introspection into an existing camera resource: refresh the discovered fields
 * (capabilities, media codec/substream, device identity + firmware) while preserving every operator-set
 * field (name, role, placement, calibration, safety flag, source). Pure — the caller validates + writes.
 * This is the server-side counterpart of the web app's mergeRescan (used by the firmware-change auto
 * re-scan on start).
 */

// A media path safe to store (leading slash, no query/fragment/space, no traversal) — mirrors the
// resource validator's PATH_RE so a re-scan never proposes a path the save would reject.
const SAFE_PATH = /^\/[\w\-./~]*$/;
const safePath = (p?: string): boolean => !!p && SAFE_PATH.test(p) && !p.includes('..');

/**
 * Whether a camera-reported serial is a durable identity. Some vendors report their IP address (or
 * nothing) as the serial; persisting that as identity breaks dedupe and the never-seen-vs-known
 * health UX the moment DHCP hands out a new lease — fall back to manufacturer+model instead.
 */
export function isStableSerial(serial: string): boolean {
  const trimmed = serial.trim();
  if (trimmed === '') return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(trimmed)) return false; // IPv4-shaped
  if (trimmed.includes(':') && /^[0-9a-f:.]+$/i.test(trimmed)) {
    const groups = trimmed.split(':');
    // A MAC (six 2-hex-digit groups) IS a durable identity; anything else colon-hex is IPv6-shaped.
    const isMac = groups.length === 6 && groups.every((g) => /^[0-9a-f]{2}$/i.test(g));
    if (!isMac) return false;
  }
  return true;
}

export function mergeDiscovered(existing: ICamera, r: IIntrospectResult): ICamera {
  const hasSub = r.substreams === true && safePath(r.substreamPath);
  const capabilities: ICameraCapabilities = {
    ptz: r.ptz === true,
    absolutePtz: r.absolutePtz === true,
    audio: r.audio === true,
    audioBackchannel: r.audioBackchannel === true,
    substreams: hasSub,
    spotlight: r.spotlight === true,
    alarm: r.alarm === true,
  };
  if (r.imaging && r.imagingControls.length) {
    // imagingControlsOf() only emits names the validator accepts (reconciled vocabulary).
    capabilities.imaging = r.imagingControls as ICameraCapabilities['imaging'];
  }
  if (r.auxCommands && r.auxCommands.length) {
    capabilities.auxCommands = r.auxCommands;
  }

  const media = { ...existing.media };
  if (r.codec && (CAMERA_CODECS as readonly string[]).includes(r.codec)) {
    media.codec = r.codec as (typeof CAMERA_CODECS)[number];
  }
  if (hasSub) {
    media.substreamPath = r.substreamPath;
  }

  const device = { ...existing.device };
  if (r.manufacturer) device.manufacturer = r.manufacturer;
  if (r.model) device.model = r.model;
  if (r.serialNumber !== undefined && isStableSerial(String(r.serialNumber))) {
    device.serial = String(r.serialNumber);
  }
  if (r.firmwareVersion) device.firmware = r.firmwareVersion;

  return {
    ...existing,
    capabilities,
    ...(Object.keys(media).length ? { media } : {}),
    ...(Object.keys(device).length ? { device } : {}),
  };
}
