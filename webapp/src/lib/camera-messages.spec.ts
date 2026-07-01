import { describe, it, expect } from 'vitest';
import { actionMessage } from './camera-messages';
import { ApiError } from '../api';

describe('actionMessage', () => {
  it('asks for sign-in on 401', () => {
    expect(actionMessage(new ApiError('x', 401), 'record').text).toMatch(/Sign in to Signal K/);
  });

  it('explains a full recording channel on a 409 record', () => {
    expect(actionMessage(new ApiError('x', 409), 'record').text).toMatch(/channels full/);
  });

  it('says unsupported on a generic 409', () => {
    expect(actionMessage(new ApiError('x', 409), 'move the camera').text).toMatch(
      /doesn’t support/,
    );
  });

  it('prefers the server’s diagnosed hint on a 502', () => {
    const err = new ApiError('move failed (502)', 502, 'Enable ONVIF on the camera.', 'onvif');
    expect(actionMessage(err, 'move the camera').text).toBe('Enable ONVIF on the camera.');
  });

  it('falls back to an honest generic retry otherwise', () => {
    expect(actionMessage(new Error('boom'), 'zoom').text).toBe('Couldn’t zoom — try again.');
  });
});
