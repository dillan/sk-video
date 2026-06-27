/**
 * Pure heuristics that suggest a marine mount and role from a camera's own metadata (its discovered
 * name and ONVIF location/hardware scopes). Owners routinely name cameras by where they look ("Bow",
 * "Engine Room"), so reflecting that back as a structured suggestion removes a data-entry step. These
 * are SUGGESTIONS the user can override, never authoritative, and the values intentionally match the
 * mount/role vocabulary the camera resource validates (see cameras/camera-validation).
 *
 * NOTE: stubbed implementation — behaviour is added in the GREEN step.
 */

export interface IPlacementHint {
  mount?: string;
  role?: string;
}

export function suggestPlacement(_text: string): IPlacementHint {
  return {};
}
