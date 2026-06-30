import { describe, it, expect } from 'vitest';
import { notificationForEvent } from './push-events';

describe('notificationForEvent', () => {
  it('builds an MOB alert that deep-links to the safety console', () => {
    const n = notificationForEvent('mob', 'emergency', 'Person overboard');
    expect(n).toEqual({
      title: 'Man overboard',
      body: 'Person overboard',
      tag: 'mob',
      url: '#/safety',
    });
  });

  it('humanises a camera-offline key with its id and links to events', () => {
    const n = notificationForEvent('camera.bow.offline', 'alarm', 'Bow camera went dark');
    expect(n?.title).toBe('Camera offline: bow');
    expect(n?.url).toBe('#/review/events');
    expect(n?.tag).toBe('camera.bow.offline');
  });

  it('badges a Frigate detection as close-range', () => {
    const n = notificationForEvent('frigate.person', 'alert', 'Person detected');
    expect(n?.title).toMatch(/detection/i);
    expect(n?.body).toMatch(/close-range/i); // honest: not a hazard/MOB-at-distance detector
  });

  it('does not push for a non-alerting state (e.g. normal/clear)', () => {
    expect(notificationForEvent('camera.bow.offline', 'normal', 'recovered')).toBeNull();
    expect(notificationForEvent('something', undefined, 'x')).toBeNull();
  });

  it('falls back to a humanised title and the message as the body', () => {
    const n = notificationForEvent('anchor.drag', 'alarm', 'Dragging anchor');
    expect(n?.title).toBe('Anchor watch');
    expect(n?.body).toBe('Dragging anchor');
  });
});
