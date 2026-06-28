import { describe, it, expect, vi } from 'vitest';
import { wireFrigateMqtt } from './frigate-mqtt-wiring';
import type { IMqttConnection } from './frigate-mqtt';

/** A fake MQTT connection that records handlers so a test can fire lifecycle events at will. */
function fakeConn() {
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  const subscribe = vi.fn();
  const conn = {
    on(event: string, cb: (...args: unknown[]) => void) {
      (handlers[event] ??= []).push(cb);
    },
    subscribe,
    end: vi.fn(),
  } as unknown as IMqttConnection;
  const fire = (event: string, ...args: unknown[]) =>
    (handlers[event] ?? []).forEach((h) => h(...args));
  return { conn, fire, subscribe };
}

describe('wireFrigateMqtt', () => {
  it('subscribes to the topic on connect', () => {
    const { conn, fire, subscribe } = fakeConn();
    wireFrigateMqtt(conn, { topic: 'frigate/events', onMessage: vi.fn() });
    fire('connect');
    expect(subscribe).toHaveBeenCalledWith('frigate/events', expect.any(Function));
  });

  it('re-subscribes on every reconnect so a broker drop resumes event flow cleanly', () => {
    const { conn, fire, subscribe } = fakeConn();
    wireFrigateMqtt(conn, { topic: 'frigate/events', onMessage: vi.fn() });
    fire('connect'); // initial
    fire('connect'); // after a drop + reconnect
    expect(subscribe).toHaveBeenCalledTimes(2);
  });

  it('forwards only messages on the subscribed topic to onMessage', () => {
    const { conn, fire } = fakeConn();
    const onMessage = vi.fn();
    wireFrigateMqtt(conn, { topic: 'frigate/events', onMessage });
    fire('message', 'frigate/events', new Uint8Array([1]));
    fire('message', 'frigate/stats', new Uint8Array([2])); // unrelated topic
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith(new Uint8Array([1]));
  });

  it('routes errors to onError and logs reconnect/close lifecycle', () => {
    const { conn, fire } = fakeConn();
    const onError = vi.fn();
    const log = vi.fn();
    wireFrigateMqtt(conn, { topic: 'frigate/events', onMessage: vi.fn(), onError, log });
    fire('reconnect');
    fire('close');
    fire('error', new Error('boom'));
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }));
    expect(log).toHaveBeenCalled();
  });

  it('logs a subscribe failure surfaced by the broker', () => {
    const { conn, fire, subscribe } = fakeConn();
    subscribe.mockImplementation((_topic: string, cb: (err: Error | null) => void) =>
      cb(new Error('not authorized')),
    );
    const log = vi.fn();
    wireFrigateMqtt(conn, { topic: 'frigate/events', onMessage: vi.fn(), log });
    fire('connect');
    expect(log.mock.calls.flat().join(' ')).toMatch(/subscribe failed/i);
  });
});
