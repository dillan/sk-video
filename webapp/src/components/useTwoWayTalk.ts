import { useCallback, useEffect, useRef, useState } from 'react';
import { negotiateTalk } from '../api';
import { actionMessage, type IMsg } from '../lib/camera-messages';

/**
 * Two-way audio (A4): opens a WebRTC session that streams the browser mic to the camera's native audio
 * backchannel via the same-origin /talk proxy. A toggle — tap to open the channel, tap to close (which
 * releases the mic). Best-effort hailing, not telephony-grade. Only meaningful when the camera reports
 * an audio backchannel; the caller gates the control on that capability.
 */

const ICE_GATHER_CAP_MS = 400;
function waitForIceGathering(pc: RTCPeerConnection, capMs: number): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const finish = (): void => {
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = (): void => {
      if (pc.iceGatheringState === 'complete') finish();
    };
    pc.addEventListener('icegatheringstatechange', check);
    setTimeout(finish, capMs);
  });
}

export interface ITwoWayTalk {
  talking: boolean;
  /** Whether a request is in flight (mic prompt / negotiation), to disable the control briefly. */
  connecting: boolean;
  toggle: () => void;
}

export function useTwoWayTalk(cameraId: string, flash: (m: IMsg) => void): ITwoWayTalk {
  const [talking, setTalking] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setTalking(false);
    setConnecting(false);
  }, []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
      flash({ kind: 'caution', text: 'This browser can’t capture the mic for two-way audio.' });
      return;
    }
    setConnecting(true);
    let pc: RTCPeerConnection | null = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      pc = new RTCPeerConnection();
      pcRef.current = pc;
      // Send the mic to the camera; go2rtc routes it to the native backchannel.
      stream.getAudioTracks().forEach((t) => pc!.addTrack(t, stream));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGathering(pc, ICE_GATHER_CAP_MS);
      const answer = await negotiateTalk(cameraId, pc.localDescription?.sdp ?? offer.sdp ?? '');
      await pc.setRemoteDescription({ type: 'answer', sdp: answer });
      setTalking(true);
      setConnecting(false);
      flash({ kind: 'info', text: 'Two-way audio open — best-effort hailing.' });
    } catch (err) {
      stop();
      flash(actionMessage(err, 'open two-way audio'));
    }
  }, [cameraId, flash, stop]);

  const toggle = useCallback(() => {
    if (talking || connecting) stop();
    else void start();
  }, [talking, connecting, start, stop]);

  // Release the mic + connection if the view is torn down mid-call.
  useEffect(() => stop, [stop]);

  return { talking, connecting, toggle };
}
