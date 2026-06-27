import { describe, it, expect } from 'vitest';
import { suggestPlacement } from './placement-hints';

describe('suggestPlacement', () => {
  it('suggests a mount from a marine camera name', () => {
    expect(suggestPlacement('Foredeck Cam')).toEqual({ mount: 'bow' });
    expect(suggestPlacement('Masthead 360')).toEqual({ mount: 'mast' });
    expect(suggestPlacement('Port side')).toEqual({ mount: 'port' });
    expect(suggestPlacement('Swim platform')).toEqual({ mount: 'stern' });
  });

  it('suggests both a mount and a role when the name implies both', () => {
    expect(suggestPlacement('Engine Room')).toEqual({ mount: 'engine', role: 'engine' });
  });

  it('suggests a role from purpose words', () => {
    expect(suggestPlacement('Anchor watch')).toMatchObject({ role: 'anchor' });
    expect(suggestPlacement('Dock approach')).toMatchObject({ role: 'docking' });
    expect(suggestPlacement('Security')).toMatchObject({ role: 'security' });
  });

  it('prefers the specific mount over a generic one (foredeck is bow, not deck)', () => {
    expect(suggestPlacement('Foredeck')).toEqual({ mount: 'bow' });
  });

  it('returns nothing recognisable for an opaque name', () => {
    expect(suggestPlacement('IPC-A1B2')).toEqual({});
  });
});
