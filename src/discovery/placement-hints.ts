/**
 * Pure heuristics that suggest a marine mount and role from a camera's own metadata (its discovered
 * name and ONVIF location/hardware scopes). Owners routinely name cameras by where they look ("Bow",
 * "Engine Room"), so reflecting that back as a structured suggestion removes a data-entry step. These
 * are SUGGESTIONS the user can override, never authoritative, and the values intentionally match the
 * mount/role vocabulary the camera resource validates (see cameras/camera-validation).
 */

export interface IPlacementHint {
  mount?: string;
  role?: string;
}

// Specific patterns first, so "foredeck" maps to bow (not the generic "deck"), and "masthead" to mast.
const MOUNT_PATTERNS: [RegExp, string][] = [
  [/masthead|\bmast\b/i, 'mast'],
  [/spreader/i, 'spreader'],
  [/foredeck|\bbow\b|pulpit/i, 'bow'],
  [/transom/i, 'transom'],
  [/stern|\baft\b|swim\s*platform/i, 'stern'],
  [/radar\s*arch|\barch\b/i, 'radararch'],
  [/cockpit/i, 'cockpit'],
  [/helm|wheelhouse|bridge/i, 'helm'],
  [/engine\s*room|\bengine\b|machinery/i, 'engine'],
  [/cabin|saloon|salon|galley/i, 'cabin'],
  [/\bport\b/i, 'port'],
  [/starboard|\bstbd\b/i, 'starboard'],
  [/interior|inside/i, 'interior'],
  [/\bdeck\b/i, 'deck'],
];

const ROLE_PATTERNS: [RegExp, string][] = [
  [/anchor/i, 'anchor'],
  [/\bdock|docking|berth/i, 'docking'],
  [/security|cctv|surveillance/i, 'security'],
  [/engine\s*room|\bengine\b/i, 'engine'],
  [/\bnav\b|navigation|underway/i, 'navigation'],
];

export function suggestPlacement(text: string): IPlacementHint {
  const mount = MOUNT_PATTERNS.find(([re]) => re.test(text))?.[1];
  const role = ROLE_PATTERNS.find(([re]) => re.test(text))?.[1];
  const hint: IPlacementHint = {};
  if (mount) {
    hint.mount = mount;
  }
  if (role) {
    hint.role = role;
  }
  return hint;
}
