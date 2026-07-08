import type { ICamera } from './camera-validation';

/**
 * The per-camera capability manifest, modeled on the Signal K Radar API's "provider declares what
 * the device can do" pattern: read-only characteristics, a supportedFeatures list, typed controls
 * a generic client can render without brand knowledge, and credential-free relative stream URLs
 * (the same-origin proxy is our "built-in stream endpoint"). Everything derives from the ONE
 * stored capability source (ICamera.capabilities, filled by ONVIF introspection) so the manifest,
 * the PUT controls, and the routes' capability gates can never disagree. Projection-only and
 * source-free — this is a view for clients, never stored on the resource.
 */

export interface ICameraControlDescriptor {
  /** Semantic control id (e.g. "spotlight", "activePreset"). */
  id: string;
  name: string;
  dataType: 'boolean' | 'number' | 'string' | 'button';
  /** base = everyday operation; info = read-only identity (radar's isReadOnly idiom). */
  category: 'base' | 'info';
  isReadOnly?: boolean;
  /** Whether the control can be used right now (autopilot's per-action availability idiom). */
  available: boolean;
  /** The Signal K PUT path that drives it, when one is registered. */
  putPath?: string;
  /** The plugin REST route that drives it (relative, same-origin). */
  restPath?: string;
  /** Current value for read-only info controls. */
  value?: string;
}

export interface ICameraManifest {
  characteristics: {
    make?: string;
    model?: string;
    serial?: string;
    firmware?: string;
    codec?: string;
    projection?: string;
  };
  supportedFeatures: string[];
  controls: ICameraControlDescriptor[];
  /** Credential-free relative playback URLs — same-origin proxy, keyed by internal camera id. */
  streams: { webrtc: string; hls: string; mjpeg: string };
}

const PLUGIN_MOUNT = '/plugins/sk-video';

export function buildCameraManifest(
  id: string,
  camera: ICamera,
  options: { recordingAvailable: boolean },
): ICameraManifest {
  const caps = camera.capabilities ?? {};
  const rest = (suffix: string) => `${PLUGIN_MOUNT}/cameras/${id}${suffix}`;

  const supportedFeatures: string[] = [];
  const feature = (flag: boolean | undefined, name: string) => {
    if (flag === true) supportedFeatures.push(name);
  };
  feature(caps.ptz, 'ptz');
  feature(caps.absolutePtz, 'absolutePtz');
  feature(caps.audio, 'audio');
  feature(caps.audioBackchannel, 'audioBackchannel');
  feature(caps.substreams, 'substreams');
  feature(caps.spotlight, 'spotlight');
  feature(caps.alarm, 'alarm');
  feature((caps.imaging ?? []).length > 0, 'imaging');
  // Declared sensor readouts, one feature each (e.g. sensor:bearing) so a generic client can discover them.
  for (const sensor of caps.sensors ?? []) {
    supportedFeatures.push(`sensor:${sensor}`);
  }
  supportedFeatures.push('snapshots');
  if (options.recordingAvailable) supportedFeatures.push('recording');

  const controls: ICameraControlDescriptor[] = [];

  if (caps.ptz === true) {
    controls.push({
      id: 'ptzMove',
      name: 'PTZ move',
      dataType: 'button',
      category: 'base',
      available: true,
      restPath: rest('/ptz'),
    });
    controls.push({
      id: 'activePreset',
      name: 'Active PTZ preset',
      dataType: 'string',
      category: 'base',
      available: true,
      putPath: `cameras.${id}.activePreset`,
      restPath: rest('/ptz/preset'),
    });
  }
  if (caps.spotlight === true) {
    controls.push({
      id: 'spotlight',
      name: 'Spotlight',
      dataType: 'boolean',
      category: 'base',
      available: true,
      putPath: `cameras.${id}.spotlight`,
      restPath: rest('/spotlight'),
    });
  }
  if (caps.alarm === true) {
    controls.push({
      id: 'alarm',
      name: 'Siren / alarm output',
      dataType: 'button',
      category: 'base',
      available: true,
      restPath: rest('/alarm'),
    });
  }
  controls.push({
    id: 'recording',
    name: 'Continuous recording',
    dataType: 'boolean',
    category: 'base',
    // Honest availability: the tier/channel budget may refuse recording on this install.
    available: options.recordingAvailable,
    putPath: `cameras.${id}.recording`,
    restPath: rest('/record'),
  });
  controls.push({
    id: 'snapshot',
    name: 'Take snapshot',
    dataType: 'button',
    category: 'base',
    available: true,
    restPath: rest('/snapshot'),
  });
  for (const imaging of caps.imaging ?? []) {
    controls.push({
      id: imaging,
      name: `Imaging — ${imaging}`,
      dataType: 'number',
      category: 'base',
      available: true,
      restPath: rest('/imaging'),
    });
  }
  // Read-only identity as info controls (radar exposes serialNumber/firmwareVersion this way).
  const info = (id2: string, name: string, value: string | undefined) => {
    if (value) {
      controls.push({
        id: id2,
        name,
        dataType: 'string',
        category: 'info',
        isReadOnly: true,
        available: true,
        value,
      });
    }
  };
  info('manufacturer', 'Manufacturer', camera.device?.manufacturer);
  info('model', 'Model', camera.device?.model);
  info('firmwareVersion', 'Firmware version', camera.device?.firmware);

  return {
    characteristics: {
      make: camera.device?.manufacturer,
      model: camera.device?.model,
      serial: camera.device?.serial,
      firmware: camera.device?.firmware,
      codec: camera.media?.codec,
      projection: camera.media?.projection,
    },
    supportedFeatures,
    controls,
    streams: {
      webrtc: rest('/whep'),
      hls: rest('/stream.m3u8'),
      mjpeg: rest('/frame.jpeg'),
    },
  };
}
