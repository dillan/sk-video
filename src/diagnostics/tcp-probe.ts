import { connect } from 'node:net';
import type { TTcpProbe } from './probe';

/** Opens a TCP connection to verify a host:port answers (used for ONVIF, which ffprobe can't read). */
export const tcpProbe: TTcpProbe = (host, port, timeoutMs) =>
  new Promise<boolean>((resolve) => {
    const socket = connect({ host, port });
    let settled = false;
    const done = (ok: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
