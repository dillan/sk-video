import type { IMqttConnection } from './frigate-mqtt';

/**
 * Wires a Frigate MQTT connection's lifecycle to the event handler. The key behaviour is that it
 * subscribes to the topic on every `connect` — including reconnects — so a dropped marina link that
 * MQTT.js re-establishes resumes the event flow cleanly without relying on the library's implicit
 * resubscribe. Lifecycle transitions are logged and errors are routed out; only messages on the
 * subscribed topic reach `onMessage`. Pure wiring (the connection itself is injected), so it is
 * unit-testable without a broker.
 */

export interface IWireFrigateMqttOptions {
  topic: string;
  onMessage: (payload: Uint8Array) => void;
  onError?: (err: Error) => void;
  log?: (msg: string) => void;
}

export function wireFrigateMqtt(conn: IMqttConnection, opts: IWireFrigateMqttOptions): void {
  conn.on('connect', () => {
    conn.subscribe(opts.topic, (err: Error | null) => {
      if (err) {
        opts.log?.(`frigate mqtt subscribe failed: ${err.message}`);
      } else {
        opts.log?.(`frigate mqtt connected; subscribed to ${opts.topic}`);
      }
    });
  });
  conn.on('reconnect', () => opts.log?.('frigate mqtt reconnecting'));
  conn.on('close', () => opts.log?.('frigate mqtt connection closed'));
  conn.on('error', (err: Error) => opts.onError?.(err));
  conn.on('message', (topic: string, payload: Uint8Array) => {
    if (topic === opts.topic) {
      opts.onMessage(payload);
    }
  });
}
