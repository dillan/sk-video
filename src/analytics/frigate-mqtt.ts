import mqtt from 'mqtt';

/**
 * Thin adapter over MQTT.js — the only place this plugin touches the `mqtt` package. The Frigate
 * client consumes the minimal interface below, so its orchestration stays unit-testable without a
 * broker. This file is an external IO wrapper (excluded from coverage, like the go2rtc/ONVIF seams).
 */

export interface IMqttConnection {
  on(event: 'message', cb: (topic: string, payload: Uint8Array) => void): void;
  on(event: 'connect' | 'close' | 'reconnect', cb: () => void): void;
  on(event: 'error', cb: (err: Error) => void): void;
  subscribe(topic: string, cb?: (err: Error | null) => void): void;
  end(force?: boolean): void;
}

export interface IFrigateMqttOptions {
  /** Broker URL, e.g. mqtt://192.168.1.10:1883 (or mqtts://, ws://, wss://). */
  url: string;
  username?: string;
  password?: string;
  /** Connection timeout / keepalive tuning in ms. */
  connectTimeoutMs?: number;
}

/** Open a Frigate MQTT connection. Auto-reconnects (MQTT.js default) on a flaky marina link. */
export function connectFrigateMqtt(options: IFrigateMqttOptions): IMqttConnection {
  const client = mqtt.connect(options.url, {
    username: options.username,
    password: options.password,
    connectTimeout: options.connectTimeoutMs ?? 10_000,
    reconnectPeriod: 10_000,
  });
  return client as unknown as IMqttConnection;
}
