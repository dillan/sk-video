import { describe, it, expect } from 'vitest';
import {
  parseFrigateEvent,
  classifyEvent,
  frigateSlug,
  type IFrigateMatchConfig,
} from './frigate-events';

const CONFIG: IFrigateMatchConfig = { labels: ['person', 'car'], minScore: 0.7, zones: [] };

const message = (over: Record<string, unknown> = {}, after: Record<string, unknown> = {}) => ({
  type: 'new',
  after: {
    id: '1607123955.475377-mwz0e6',
    camera: 'front_door',
    label: 'person',
    score: 0.84,
    top_score: 0.9,
    false_positive: false,
    has_clip: false,
    entered_zones: ['yard'],
    ...after,
  },
  ...over,
});

describe('parseFrigateEvent', () => {
  it('parses a JSON string payload', () => {
    const msg = parseFrigateEvent(JSON.stringify(message()));
    expect(msg?.type).toBe('new');
    expect(msg?.after.label).toBe('person');
  });

  it('parses a Uint8Array payload (MQTT delivers Buffers)', () => {
    const bytes = new TextEncoder().encode(JSON.stringify(message()));
    expect(parseFrigateEvent(bytes)?.after.camera).toBe('front_door');
  });

  it('returns null for non-JSON, a wrong type, or a missing after object', () => {
    expect(parseFrigateEvent('not json')).toBeNull();
    expect(parseFrigateEvent(JSON.stringify({ type: 'bogus', after: {} }))).toBeNull();
    expect(parseFrigateEvent(JSON.stringify({ type: 'new' }))).toBeNull();
    expect(parseFrigateEvent(JSON.stringify({ type: 'new', after: { id: 'x' } }))).toBeNull();
    expect(parseFrigateEvent(42)).toBeNull();
  });
});

describe('classifyEvent', () => {
  it('qualifies a watched label above the score threshold and not a false positive', () => {
    const { object, qualifies } = classifyEvent(
      parseFrigateEvent(JSON.stringify(message()))!,
      CONFIG,
    );
    expect(qualifies).toBe(true);
    expect(object).toMatchObject({
      camera: 'front_door',
      label: 'person',
      score: 0.9,
      ended: false,
    });
  });

  it('uses the higher of score / top_score against the threshold', () => {
    const msg = parseFrigateEvent(JSON.stringify(message({}, { score: 0.5, top_score: 0.95 })))!;
    expect(classifyEvent(msg, CONFIG).object.score).toBe(0.95);
    expect(classifyEvent(msg, CONFIG).qualifies).toBe(true);
  });

  it('rejects an unwatched label, a low score, or a false positive', () => {
    expect(
      classifyEvent(parseFrigateEvent(JSON.stringify(message({}, { label: 'dog' })))!, CONFIG)
        .qualifies,
    ).toBe(false);
    expect(
      classifyEvent(
        parseFrigateEvent(JSON.stringify(message({}, { score: 0.2, top_score: 0.3 })))!,
        CONFIG,
      ).qualifies,
    ).toBe(false);
    expect(
      classifyEvent(
        parseFrigateEvent(JSON.stringify(message({}, { false_positive: true })))!,
        CONFIG,
      ).qualifies,
    ).toBe(false);
  });

  it('honours a zone filter when configured', () => {
    const zoned: IFrigateMatchConfig = { ...CONFIG, zones: ['dock'] };
    expect(classifyEvent(parseFrigateEvent(JSON.stringify(message()))!, zoned).qualifies).toBe(
      false,
    ); // entered 'yard', not 'dock'
    const onDock = parseFrigateEvent(JSON.stringify(message({}, { entered_zones: ['dock'] })))!;
    expect(classifyEvent(onDock, zoned).qualifies).toBe(true);
  });

  it('marks an end event with a clip', () => {
    const msg = parseFrigateEvent(JSON.stringify(message({ type: 'end' }, { has_clip: true })))!;
    const { object } = classifyEvent(msg, CONFIG);
    expect(object.ended).toBe(true);
    expect(object.hasClip).toBe(true);
  });
});

describe('frigateSlug', () => {
  it('turns a dotted Frigate id into a safe slug', () => {
    expect(frigateSlug('1607123955.475377-mwz0e6')).toBe('1607123955-475377-mwz0e6');
    expect(/^[A-Za-z0-9-]+$/.test(frigateSlug('a.b/c'))).toBe(true);
  });
});
