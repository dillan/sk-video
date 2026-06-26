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
  mse: { scheme: 'ws', path: '/api/ws' }
};

export function go2rtcApiUrl(apiPort: number, transport: TGatewayTransport, cameraId: string): string {
  if (!isValidCameraId(cameraId)) {
    throw new Error(`invalid camera id: ${cameraId}`);
  }
  const { scheme, path } = ENDPOINTS[transport];
  return `${scheme}://127.0.0.1:${apiPort}${path}?src=${cameraId}`;
}
