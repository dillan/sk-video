import { describe, it, expect } from 'vitest';
import { computeStatus, buildManifest, type IBundleParts } from './incident-bundle';
import type { IIncidentAsset, IIncidentFailure } from './incident-validation';
import type { ISnapshotTelemetry } from '../recording/snapshot-service';

const asset = (
  id: string,
  kind: IIncidentAsset['kind'],
  cameraId: string | null,
): IIncidentAsset => ({
  id,
  kind,
  cameraId,
  contentType: kind === 'clip' ? 'video/mp4' : 'application/json',
  size: 10,
  sha256: id,
  name: `${id}.x`,
  createdAt: 1,
});

const TELEMETRY: ISnapshotTelemetry = {
  position: null,
  headingTrue: null,
  speedOverGround: null,
  courseOverGroundTrue: null,
  depth: null,
  windSpeedApparent: null,
  windAngleApparent: null,
  oldestReadingAgeMs: null,
  positionAvailable: false,
};

describe('computeStatus', () => {
  it('complete when every camera has a clip and there are no failures', () => {
    const assets = [
      asset('c1', 'clip', 'bow'),
      asset('c2', 'clip', 'stern'),
      asset('t', 'telemetry', null),
    ];
    expect(computeStatus(['bow', 'stern'], assets, [])).toBe('complete');
  });

  it('partial when a camera is missing a clip or a failure was recorded', () => {
    const assets = [asset('c1', 'clip', 'bow'), asset('t', 'telemetry', null)];
    expect(computeStatus(['bow', 'stern'], assets, [])).toBe('partial');
    const fail: IIncidentFailure = {
      kind: 'snapshot',
      cameraId: 'stern',
      reason: 'frame fetch failed',
    };
    expect(computeStatus(['bow'], [asset('c1', 'clip', 'bow')], [fail])).toBe('partial');
  });

  it('failed when nothing usable was captured', () => {
    expect(
      computeStatus(['bow'], [], [{ kind: 'clip', cameraId: 'bow', reason: 'no segments' }]),
    ).toBe('failed');
  });
});

describe('buildManifest', () => {
  const parts: IBundleParts = {
    id: 'inc-1',
    createdAt: 1000,
    finalizedAt: 2000,
    trigger: { source: 'manual', firedAt: 1000 },
    window: { preMs: 30000, postMs: 30000 },
    cameras: ['bow'],
    telemetryAtTrigger: TELEMETRY,
    telemetry: {
      sampleCount: 1,
      positionAvailable: false,
      oldestReadingAgeMs: null,
      coversPreRoll: false,
      gaps: false,
      sampleIntervalMs: 1000,
    },
    assets: [asset('c1', 'clip', 'bow'), asset('t', 'telemetry', null)],
    failures: [],
  };

  it('stamps best-effort + schemaVersion, derives status, and folds a digest', () => {
    const m = buildManifest(parts);
    expect(m.evidence).toBe('best-effort');
    expect(m.schemaVersion).toBe(1);
    expect(m.status).toBe('complete');
    expect(m.digest.algo).toBe('sha256');
    expect(m.digest.value).toHaveLength(64);
  });
});
