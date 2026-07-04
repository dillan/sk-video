import { describe, it, expect } from 'vitest';
import { LastGoodTracker } from './last-good';

describe('LastGoodTracker', () => {
  it('reports never-seen (null) with the tracking horizon before any online reading', () => {
    let t = 1000;
    const tracker = new LastGoodTracker(() => t);
    t = 2000;
    expect(tracker.get('bow')).toEqual({ lastGoodAt: null, trackedSince: 1000 });
  });

  it('stamps only online readings and keeps the last one', () => {
    let t = 1000;
    const tracker = new LastGoodTracker(() => t);
    t = 1500;
    tracker.note('bow', true);
    t = 2000;
    tracker.note('bow', false); // going dark must not erase when it was last good
    expect(tracker.get('bow')).toEqual({ lastGoodAt: 1500, trackedSince: 1000 });
    t = 3000;
    tracker.note('bow', true);
    expect(tracker.get('bow').lastGoodAt).toBe(3000);
  });

  it('tracks cameras independently and forgets removed ones', () => {
    let t = 1000;
    const tracker = new LastGoodTracker(() => t);
    t = 1200;
    tracker.note('bow', true);
    expect(tracker.get('stern').lastGoodAt).toBeNull();
    tracker.forget('bow');
    expect(tracker.get('bow').lastGoodAt).toBeNull();
  });
});

describe('LastGoodTracker — persistence', () => {
  it('hydrates from a persisted snapshot so an outage spanning a restart stays visible', () => {
    let t = 10_000;
    const tracker = new LastGoodTracker(() => t, { seed: { bow: 4000 } });
    expect(tracker.get('bow').lastGoodAt).toBe(4000); // survives the restart
    expect(tracker.get('stern').lastGoodAt).toBeNull(); // unseeded cameras stay honest
    t = 12_000;
    tracker.note('bow', true);
    expect(tracker.get('bow').lastGoodAt).toBe(12_000); // fresh readings still win
  });

  it('snapshots stamped cameras for persistence, and forget() removes them from it', () => {
    let t = 1000;
    const tracker = new LastGoodTracker(() => t, { seed: { stern: 500 } });
    t = 1500;
    tracker.note('bow', true);
    tracker.note('helm', false); // never online -> not in the snapshot
    expect(tracker.snapshot()).toEqual({ stern: 500, bow: 1500 });
    tracker.forget('stern');
    expect(tracker.snapshot()).toEqual({ bow: 1500 });
  });
});
