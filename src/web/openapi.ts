import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CAMERA_SCHEMES, CAMERA_ROLES, CAMERA_CODECS } from '../cameras/camera-validation';

/**
 * The plugin's OpenAPI 3 document, served through `Plugin.getOpenApi` so it appears in the
 * Signal K Admin UI under Documentation → OpenAPI — the same place every server API publishes its
 * contract. It documents the same-origin HTTP surface under /plugins/sk-video, and includes the
 * `cameras` resource document schema because custom Signal K resource types get no server-side
 * validation: this published shape IS the contract. Summaries stay honest about the security
 * model (write-only credentials, redacted health, auth-gated mutations).
 */

function packageVersion(): string {
  try {
    const raw = readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8');
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

type OpenApiOperation = Record<string, unknown>;

/** One operation: summary + tag + generic responses (route-specific codes live in the summary). */
function op(tag: string, summary: string, extra: OpenApiOperation = {}): OpenApiOperation {
  return {
    summary,
    tags: [tag],
    responses: {
      '200': { description: 'Success' },
      '4XX': { description: 'Request refused (unknown id, invalid body, or unauthorised)' },
      '5XX': { description: 'Upstream failure (camera/gateway) or plugin not started' },
    },
    ...extra,
  };
}

const CAMERA_ID_PARAM = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'Camera id (slug)',
  schema: { type: 'string', pattern: '^[A-Za-z0-9-]+$' },
};

const CAMERA_SCHEMA = {
  type: 'object',
  description:
    'A camera DEFINITION as stored in the Signal K resource (custom type `cameras`, managed at ' +
    '/signalk/v2/api/resources/cameras). Credentials are never part of this document — they live ' +
    'in a separate write-only store.',
  required: ['name', 'enabled', 'source'],
  properties: {
    name: { type: 'string' },
    enabled: { type: 'boolean' },
    source: {
      type: 'object',
      required: ['scheme', 'host'],
      properties: {
        scheme: { type: 'string', enum: [...CAMERA_SCHEMES] },
        host: { type: 'string' },
        port: { type: 'integer' },
        path: { type: 'string' },
      },
    },
    placement: {
      type: 'object',
      properties: {
        mount: { type: 'string' },
        bearingRelativeDeg: { type: 'number' },
        heightM: { type: 'number' },
      },
    },
    role: { type: 'string', enum: [...CAMERA_ROLES] },
    capabilities: {
      type: 'object',
      properties: {
        ptz: { type: 'boolean' },
        absolutePtz: { type: 'boolean' },
        audio: { type: 'boolean' },
        audioBackchannel: { type: 'boolean' },
        substreams: { type: 'boolean' },
        spotlight: { type: 'boolean' },
        alarm: { type: 'boolean' },
        imaging: { type: 'array', items: { type: 'string' } },
        auxCommands: { type: 'array', items: { type: 'string' } },
      },
    },
    media: {
      type: 'object',
      properties: {
        codec: { type: 'string', enum: [...CAMERA_CODECS] },
        profileToken: { type: 'string' },
        substreamPath: { type: 'string' },
        projection: { type: 'string' },
      },
    },
    device: {
      type: 'object',
      properties: {
        manufacturer: { type: 'string' },
        model: { type: 'string' },
        serial: { type: 'string' },
        firmware: { type: 'string' },
      },
    },
    allowSelfSigned: { type: 'boolean' },
    safetyCritical: {
      type: 'boolean',
      description: 'Opt-in: the plugin watches this camera and alarms when it goes dark.',
    },
  },
};

export function buildOpenApiDoc(): object {
  const cameraPath = (rest: string, ops: Record<string, OpenApiOperation>) => ({
    [`/cameras/{id}${rest}`]: { parameters: [CAMERA_ID_PARAM], ...ops },
  });

  return {
    openapi: '3.0.3',
    info: {
      title: 'SK Video plugin API',
      version: packageVersion(),
      description:
        'The same-origin HTTP surface of the SK Video plugin. The browser only ever talks to ' +
        'these endpoints — never to go2rtc or a camera directly, and a client-supplied source is ' +
        'never honoured. Mutating routes require an authenticated request when server security ' +
        'is enabled. Camera definitions are managed through the standard Signal K Resources API ' +
        'at /signalk/v2/api/resources/cameras (schema: #/components/schemas/Camera); per-camera ' +
        'health lives in the data model at cameras.<id>.* with alarms at ' +
        'notifications.cameras.<id>.*.',
    },
    servers: [{ url: '/plugins/sk-video' }],
    paths: {
      '/status': {
        get: op('Status', 'Plugin health: ready flag, camera count, hardware, Frigate posture.'),
      },
      '/session': {
        get: op(
          'Status',
          'Whoami: securityEnabled / authenticated / readOnly booleans + plugin version (no token).',
        ),
      },
      ...cameraPath('/credentials', {
        get: op(
          'Credentials',
          'Whether a login is stored — presence flags only, never the secret (write-only store).',
        ),
        post: op(
          'Credentials',
          'Store a write-only camera login. It is never echoed back by any endpoint.',
        ),
        delete: op('Credentials', 'Delete a stored write-only login.'),
      }),
      ...cameraPath('/whep', {
        post: op(
          'Streaming',
          'WebRTC (WHEP) signaling: POST an SDP offer, receive the answer. ?variant=sub selects the sub-stream.',
        ),
      }),
      ...cameraPath('/talk', {
        post: op('Streaming', 'Two-way audio backchannel (WebRTC SDP with a talk track).'),
      }),
      ...cameraPath('/stream.m3u8', { get: op('Streaming', 'HLS master playlist.') }),
      ...cameraPath('/hls/{resource}', {
        get: op('Streaming', 'HLS media playlist / segment / init segment.', {
          parameters: [
            { name: 'resource', in: 'path', required: true, schema: { type: 'string' } },
          ],
        }),
      }),
      ...cameraPath('/frame.jpeg', {
        get: op('Streaming', 'A single JPEG still from the stream (served no-store).'),
      }),
      ...cameraPath('/health', {
        get: op(
          'Streaming',
          'Stream diagnostics: online/producer/consumer counts and codecs, source URLs redacted, plus last-good tracking.',
        ),
      }),
      ...cameraPath('/transport', {
        get: op('Streaming', 'The recommended codec-aware transport walk (webrtc → hls → mjpeg).'),
      }),
      '/cameras': {
        get: op(
          'Streaming',
          'Aggregate wall projection: definitions (no network addresses), health, transport walks, and layout hints in one read.',
        ),
      },
      '/cameras/layout': {
        get: op('Streaming', 'Structured layout hints (sector/role grouping, suggested grid).'),
      },
      ...cameraPath('/ptz', {
        post: op('PTZ & imaging', 'Continuous/relative/absolute PTZ move (velocities clamped).'),
      }),
      ...cameraPath('/ptz/stop', { post: op('PTZ & imaging', 'Stop any PTZ motion now.') }),
      ...cameraPath('/ptz/presets', { get: op('PTZ & imaging', 'List the camera PTZ presets.') }),
      ...cameraPath('/ptz/position', {
        get: op('PTZ & imaging', 'Read the current PTZ position.'),
      }),
      ...cameraPath('/ptz/preset', {
        post: op(
          'PTZ & imaging',
          'Go to a PTZ preset (also available as a Signal K PUT on cameras.<id>.activePreset).',
        ),
      }),
      ...cameraPath('/spotlight', {
        post: op(
          'PTZ & imaging',
          'Switch the camera spotlight (ONVIF aux command; also a Signal K PUT on cameras.<id>.spotlight).',
        ),
      }),
      ...cameraPath('/alarm', {
        post: op('PTZ & imaging', 'Trigger the camera siren/alarm output (ONVIF aux command).'),
      }),
      ...cameraPath('/imaging', {
        get: op('PTZ & imaging', 'Read the current ONVIF imaging settings.'),
      }),
      ...cameraPath('/imaging/preset', {
        post: op('PTZ & imaging', 'Apply an imaging preset (e.g. a low-light profile).'),
      }),
      ...cameraPath('/calibration', {
        post: op('PTZ & imaging', 'Store the pan/tilt calibration used for geo-aiming.'),
      }),
      ...cameraPath('/slew-to-cue', {
        post: op(
          'PTZ & imaging',
          'One-shot aim of a calibrated PTZ camera at the nearest AIS target.',
        ),
      }),
      '/cameras/discover': {
        get: op(
          'Discovery',
          'Scan the LAN for cameras (WS-Discovery + mDNS; rate-limited, SSRF-guarded).',
        ),
      },
      '/cameras/onboarding-hints': {
        get: op('Discovery', 'Vendor stream-path suggestions for by-hand onboarding.'),
      },
      '/cameras/test': {
        post: op('Discovery', 'One-shot connection test of a candidate camera (ffprobe).'),
      },
      ...cameraPath('/rescan', {
        post: op('Discovery', 'Re-introspect a camera’s ONVIF capabilities.'),
      }),
      ...cameraPath('/record', {
        post: op(
          'Recording',
          'Start/stop continuous DVR recording ({active}); 409 when the hardware tier refuses a channel. Also a Signal K PUT on cameras.<id>.recording.',
        ),
      }),
      '/recordings': { get: op('Recording', 'List stored DVR segments (newest first).') },
      '/recordings/timeline': {
        get: op('Recording', 'The scrubbable DVR timeline (segments + coverage gaps per camera).'),
      },
      '/recordings/{name}': {
        get: op('Recording', 'Stream one segment with HTTP Range support.', {
          parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string' } }],
        }),
      },
      ...cameraPath('/snapshot', {
        post: op('Snapshots', 'Capture a snapshot (optionally stamped with boat data).'),
      }),
      '/snapshots': { get: op('Snapshots', 'List stored snapshots.') },
      '/snapshots/{id}': {
        get: op('Snapshots', 'Fetch one snapshot image.', {
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        }),
      },
      '/incidents': {
        post: op('Incidents', 'Mark an incident (snapshot + clip + telemetry evidence bundle).'),
        get: op('Incidents', 'List incident bundles (also a read-mostly Signal K resource).'),
      },
      '/incidents/{id}': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        get: op('Incidents', 'One incident bundle manifest.'),
        patch: op('Incidents', 'Edit label/notes/pinned — bundles are otherwise immutable.'),
        delete: op('Incidents', 'Delete an incident bundle.'),
      },
      '/incidents/{id}/assets/{assetId}': {
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'assetId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        get: op('Incidents', 'Serve one asset (snapshot/clip) from a bundle.'),
      },
      '/incidents/{id}/export.zip': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        get: op('Incidents', 'Download the whole bundle as a zip.'),
      },
      '/events/log': {
        get: op(
          'Events & alerts',
          'The durable safety/system event feed (?type= prefix filter, ?before= cursor).',
        ),
      },
      '/notifications/ack': {
        post: op(
          'Events & alerts',
          'Acknowledge a notification SHARED-STATE by key (helm ack silences every client).',
        ),
      },
      '/push/vapid-public-key': {
        get: op('Events & alerts', 'The VAPID public key for Web Push subscription.'),
      },
      '/push/subscribe': { post: op('Events & alerts', 'Subscribe this device to safety pushes.') },
      '/push/unsubscribe': { post: op('Events & alerts', 'Remove a push subscription.') },
      '/mob': {
        post: op(
          'Safety',
          'Activate/deactivate MOB (also a Signal K PUT on cameras.mob.activate).',
        ),
        get: op('Safety', 'Live MOB status (seed this before trusting deltas on reconnect).'),
      },
      '/operational-config': {
        get: op('Config', 'Read the operational config (Frigate password redacted to a flag).'),
        put: op(
          'Config',
          'Replace the operational config and restart the plugin to apply (video reconnects briefly).',
        ),
      },
      '/videos': {
        post: op('Videos', 'One-shot upload of a video (magic-byte validated, quota-bounded).'),
        get: op('Videos', 'List uploaded videos (also a read-mostly Signal K `videos` resource).'),
      },
      '/videos/{id}': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        get: op('Videos', 'Play an uploaded video (HTTP Range).'),
        delete: op('Videos', 'Delete an uploaded video.'),
      },
      '/videos/uploads': {
        post: op(
          'Videos',
          'Open a resumable upload session with {name, size}; returns {id, offset}. Rate-limited.',
        ),
      },
      '/videos/uploads/{id}': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        get: op(
          'Videos',
          'Probe the current offset {offset} — the resume handshake after a dropped connection.',
        ),
        patch: op(
          'Videos',
          'Append bytes at the X-Upload-Offset header; echoes the new offset. A mismatch answers 409 with {offset} to resume from; overflow 413.',
        ),
        delete: op('Videos', 'Discard a partial upload (idempotent).'),
      },
      '/videos/uploads/{id}/complete': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        post: op(
          'Videos',
          'Finalize a fully-uploaded session through the magic-byte sniff, quota, and atomic commit; returns the video. 409 while incomplete, 415 for a non-video, 413 over quota.',
        ),
      },
      '/frigate/clips': { get: op('Events & alerts', 'List cached Frigate detection clips.') },
      '/frigate/clips/{id}': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        get: op('Events & alerts', 'Serve one cached Frigate clip (same-origin).'),
      },
    },
    components: { schemas: { Camera: CAMERA_SCHEMA } },
  };
}
