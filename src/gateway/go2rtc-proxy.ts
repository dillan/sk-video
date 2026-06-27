import { isValidCameraId } from '../cameras/camera-store';

export type TGatewayTransport = 'webrtc' | 'hls' | 'mse' | 'frame';

/**
 * Builds the loopback go2rtc API URL for a transport, keyed by an internal camera id. The id is
 * validated here so the proxy can never be tricked into forwarding a client-supplied `src=` — it only
 * ever targets a known camera. Throws on an invalid id.
 */
const ENDPOINTS: Record<TGatewayTransport, { scheme: 'http' | 'ws'; path: string }> = {
  webrtc: { scheme: 'http', path: '/api/webrtc' },
  hls: { scheme: 'http', path: '/api/stream.m3u8' },
  frame: { scheme: 'http', path: '/api/frame.jpeg' },
  mse: { scheme: 'ws', path: '/api/ws' },
};

export function go2rtcApiUrl(
  apiPort: number,
  transport: TGatewayTransport,
  cameraId: string,
): string {
  if (!isValidCameraId(cameraId)) {
    throw new Error(`invalid camera id: ${cameraId}`);
  }
  const { scheme, path } = ENDPOINTS[transport];
  return `${scheme}://127.0.0.1:${apiPort}${path}?src=${cameraId}`;
}

/**
 * Builds the loopback go2rtc /api/streams introspection URL for a camera, validating the id so a
 * client-supplied src can never be injected.
 */
export function go2rtcStreamsUrl(apiPort: number, cameraId: string): string {
  if (!isValidCameraId(cameraId)) {
    throw new Error(`invalid camera id: ${cameraId}`);
  }
  return `http://127.0.0.1:${apiPort}/api/streams?src=${cameraId}`;
}

/** HLS sub-resource names the master/media playlists reference (media playlist, segments, init). */
const HLS_RESOURCE = /^[A-Za-z0-9._-]+$/;

/**
 * Builds the loopback go2rtc URL for an HLS sub-resource (the media playlist, a segment, or the init
 * segment) that the master playlist points at. The camera id and resource name are validated and any
 * client-supplied `src=` is stripped, so the proxy can never be redirected to another stream or path.
 */
export function go2rtcHlsUrl(
  apiPort: number,
  cameraId: string,
  resource: string,
  rawQuery = '',
): string {
  if (!isValidCameraId(cameraId)) {
    throw new Error(`invalid camera id: ${cameraId}`);
  }
  if (!HLS_RESOURCE.test(resource) || resource.includes('..')) {
    throw new Error(`invalid hls resource: ${resource}`);
  }
  const params = new URLSearchParams(rawQuery);
  params.delete('src'); // never honour a client-supplied src
  const query = params.toString();
  return `http://127.0.0.1:${apiPort}/api/hls/${resource}${query ? `?${query}` : ''}`;
}
