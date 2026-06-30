import { describe, it, expect } from 'vitest';
import {
  isValidIncidentId,
  validateTriggerRequest,
  validateIncidentPatch,
  MAX_PRE_MS,
} from './incident-validation';

describe('isValidIncidentId', () => {
  it('accepts uuid-style slugs and rejects traversal / dotted names', () => {
    expect(isValidIncidentId('a1b2-c3')).toBe(true);
    expect(isValidIncidentId('../etc')).toBe(false);
    expect(isValidIncidentId('a.mp4')).toBe(false);
    expect(isValidIncidentId('a/b')).toBe(false);
    expect(isValidIncidentId('')).toBe(false);
  });
});

describe('validateTriggerRequest', () => {
  it('accepts a bare {} and leaves rolls absent so the controller default applies', () => {
    const r = validateTriggerRequest({});
    expect(r.valid).toBe(true);
    expect(r.value).toEqual({}); // no preMs/postMs forced to 0 — omitted stays omitted
  });

  it('accepts undefined input as an empty mark', () => {
    expect(validateTriggerRequest(undefined).valid).toBe(true);
  });

  it('rejects unknown keys (this is how embedded credentials/bytes are refused)', () => {
    const r = validateTriggerRequest({ credentials: 'x', bytes: 'y' });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/unexpected trigger field/);
  });

  it('clamps preMs/postMs into [0, MAX]', () => {
    const r = validateTriggerRequest({ preMs: -50, postMs: MAX_PRE_MS * 10 });
    expect(r.value).toMatchObject({ preMs: 0, postMs: MAX_PRE_MS });
  });

  it('rejects a non-numeric roll and a bad camera id', () => {
    expect(validateTriggerRequest({ preMs: 'soon' }).valid).toBe(false);
    expect(validateTriggerRequest({ cameras: ['../x'] }).valid).toBe(false);
  });

  it('accepts a retrospective triggerAt and passes it through', () => {
    const r = validateTriggerRequest({ triggerAt: 1_700_000_000_000 });
    expect(r.valid).toBe(true);
    expect(r.value).toMatchObject({ triggerAt: 1_700_000_000_000 });
  });

  it('rejects a non-numeric or negative triggerAt', () => {
    expect(validateTriggerRequest({ triggerAt: 'yesterday' }).valid).toBe(false);
    expect(validateTriggerRequest({ triggerAt: -5 }).valid).toBe(false);
  });

  it('strips control chars from the note and trims it', () => {
    const note = 'fire' + String.fromCharCode(7) + 'aft ';
    const r = validateTriggerRequest({ note });
    expect(r.value?.note).toBe('fireaft');
  });

  it('"clip last 30s" shape (pre 30s, no post) is valid', () => {
    const r = validateTriggerRequest({ preMs: 30000, postMs: 0 });
    expect(r.value).toEqual({ preMs: 30000, postMs: 0 });
  });
});

describe('validateIncidentPatch', () => {
  it('accepts an empty patch and the closed editable set', () => {
    expect(validateIncidentPatch({}).valid).toBe(true);
    const r = validateIncidentPatch({ label: 'grounding', notes: 'near the bar', pinned: true });
    expect(r.value).toEqual({ label: 'grounding', notes: 'near the bar', pinned: true });
  });

  it('rejects unknown keys, an oversized label and a non-boolean pinned', () => {
    expect(validateIncidentPatch({ status: 'complete' }).valid).toBe(false);
    expect(validateIncidentPatch({ label: 'x'.repeat(121) }).valid).toBe(false);
    expect(validateIncidentPatch({ pinned: 'yes' }).valid).toBe(false);
  });
});
