import { describe, it, expect, vi, afterEach } from 'vitest';
import { registerServiceWorker } from './pwa';

afterEach(() => vi.restoreAllMocks());

describe('registerServiceWorker', () => {
  it('registers sw.js on window load when the API is available', () => {
    const register = vi.fn().mockResolvedValue(undefined);
    const nav = { serviceWorker: { register } } as unknown as Navigator;
    const addEventListener = vi
      .spyOn(window, 'addEventListener')
      .mockImplementation((_evt, cb) => (cb as () => void)());
    registerServiceWorker(nav);
    expect(addEventListener).toHaveBeenCalledWith('load', expect.any(Function));
    expect(register).toHaveBeenCalledWith('sw.js');
  });

  it('no-ops when serviceWorker is unavailable', () => {
    expect(() => registerServiceWorker({} as Navigator)).not.toThrow();
  });

  it('does not register in an insecure context', () => {
    const register = vi.fn();
    const nav = { serviceWorker: { register } } as unknown as Navigator;
    const orig = window.isSecureContext;
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
    registerServiceWorker(nav);
    expect(register).not.toHaveBeenCalled();
    Object.defineProperty(window, 'isSecureContext', { value: orig, configurable: true });
  });
});
