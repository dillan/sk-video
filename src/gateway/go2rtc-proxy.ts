import { isValidCameraId } from '../cameras/camera-store';

export type TGatewayTransport = 'webrtc' | 'hls' | 'mse' | 'frame';

/**
 * Builds the loopback go2rtc API URL for a transport, keyed by an internal camera id. The id is
 * validated here so the proxy can never be tricked into forwarding a client-supplied `src=` — it only
 * ever targets a known camera. Throws on an invalid id.
 */
export function go2rtcApiUrl(apiPort: number, transport: TGatewayTransport, cameraId: string): string {
  void apiPort;
  void transport;
  void cameraId;
  void isValidCameraId;
  // RED stub.
  return '';
}
