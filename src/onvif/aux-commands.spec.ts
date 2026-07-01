import { describe, it, expect } from 'vitest';
import { classifyAuxCommands, auxCapabilities, auxTokensFromNodes } from './aux-commands';

describe('classifyAuxCommands', () => {
  it('maps a white-light / spotlight token to On/Off aux data', () => {
    expect(classifyAuxCommands(['tt:WhiteLight']).spotlight).toEqual({
      on: 'tt:WhiteLight|On',
      off: 'tt:WhiteLight|Off',
    });
    expect(classifyAuxCommands(['tt:FloodLight']).spotlight?.on).toBe('tt:FloodLight|On');
    expect(classifyAuxCommands(['ReolinkWhiteLed']).spotlight?.on).toBe('ReolinkWhiteLed|On');
  });

  it('maps a siren / alarm token', () => {
    expect(classifyAuxCommands(['tt:Siren']).alarm).toEqual({
      on: 'tt:Siren|On',
      off: 'tt:Siren|Off',
    });
    expect(classifyAuxCommands(['tt:AudioAlarm']).alarm?.on).toBe('tt:AudioAlarm|On');
    expect(classifyAuxCommands(['Buzzer']).alarm?.on).toBe('Buzzer|On');
  });

  it('does not treat the IR lamp or wiper as a spotlight or alarm', () => {
    const c = classifyAuxCommands(['tt:IRLamp', 'tt:Wiper']);
    expect(c.spotlight).toBeUndefined();
    expect(c.alarm).toBeUndefined();
  });

  it('strips any arg already on the advertised token before building On/Off', () => {
    expect(classifyAuxCommands(['tt:WhiteLight|On']).spotlight).toEqual({
      on: 'tt:WhiteLight|On',
      off: 'tt:WhiteLight|Off',
    });
  });

  it('picks up both from a mixed list and ignores blanks', () => {
    const c = classifyAuxCommands(['', '  ', 'tt:Wiper', 'tt:SpotLight', 'tt:AlarmSound']);
    expect(c.spotlight?.on).toBe('tt:SpotLight|On');
    expect(c.alarm?.on).toBe('tt:AlarmSound|On');
  });

  it('takes the first match of each kind', () => {
    const c = classifyAuxCommands(['tt:WhiteLight', 'tt:FloodLight']);
    expect(c.spotlight?.on).toBe('tt:WhiteLight|On');
  });
});

describe('auxCapabilities', () => {
  it('reports booleans for the UI gate', () => {
    expect(auxCapabilities(['tt:WhiteLight', 'tt:Siren'])).toEqual({
      spotlight: true,
      alarm: true,
    });
    expect(auxCapabilities(['tt:Wiper'])).toEqual({ spotlight: false, alarm: false });
    expect(auxCapabilities([])).toEqual({ spotlight: false, alarm: false });
  });
});

describe('auxTokensFromNodes', () => {
  it('flattens a single-string and an array of auxiliary commands across nodes', () => {
    const nodes = {
      node0: { auxiliaryCommands: 'tt:Wiper' },
      node1: { auxiliaryCommands: ['tt:WhiteLight', 'tt:Siren'] },
    };
    expect(auxTokensFromNodes(nodes)).toEqual(['tt:Wiper', 'tt:WhiteLight', 'tt:Siren']);
  });

  it('is safe on empty / missing / malformed input', () => {
    expect(auxTokensFromNodes(null)).toEqual([]);
    expect(auxTokensFromNodes({})).toEqual([]);
    expect(auxTokensFromNodes({ n: {} })).toEqual([]);
    expect(auxTokensFromNodes({ n: { auxiliaryCommands: ['  ', 'tt:Siren'] } })).toEqual([
      'tt:Siren',
    ]);
  });
});
