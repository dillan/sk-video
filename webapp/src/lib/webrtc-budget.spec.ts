import { describe, it, expect, beforeEach } from 'vitest';
import {
  tryAcquireWebrtc,
  releaseWebrtc,
  activeWebrtcCount,
  configureWebrtcBudget,
} from './webrtc-budget';

beforeEach(() => configureWebrtcBudget(2));

describe('webrtc budget', () => {
  it('grants slots up to the cap, then denies', () => {
    expect(tryAcquireWebrtc()).toBe(true);
    expect(tryAcquireWebrtc()).toBe(true);
    expect(tryAcquireWebrtc()).toBe(false); // the 3rd tile falls down its walk instead
    expect(activeWebrtcCount()).toBe(2);
  });

  it('frees a slot on release so the next player can climb back up', () => {
    tryAcquireWebrtc();
    tryAcquireWebrtc();
    releaseWebrtc();
    expect(tryAcquireWebrtc()).toBe(true);
  });

  it('never under-flows on a spurious release', () => {
    releaseWebrtc();
    expect(activeWebrtcCount()).toBe(0);
  });
});
