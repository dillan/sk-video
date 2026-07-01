/**
 * ONVIF has no standardised "spotlight" or "siren" command — cameras that expose a white light / alarm
 * do so through freeform *auxiliary commands* (ONVIF `SendAuxiliaryCommand`), advertised as tokens like
 * `tt:Wiper`, `tt:IRLamp`, `tt:WhiteLight`, or vendor strings. This maps the advertised tokens to the
 * two controls the console offers, building the `<token>|On` / `<token>|Off` aux data strings ONVIF
 * expects.
 *
 * NOTE: the token→control mapping is a best-effort match against known naming; it is UNVERIFIED on real
 * hardware. The patterns are deliberately isolated here so they're trivial to widen as real cameras
 * report their tokens in pre-release feedback. The IR lamp and wiper are intentionally NOT spotlights.
 */

export interface IAuxCommand {
  /** ONVIF aux data to switch the feature on, e.g. `tt:WhiteLight|On`. */
  on: string;
  off: string;
}

export interface IAuxControls {
  spotlight?: IAuxCommand;
  alarm?: IAuxCommand;
}

// White-light / floodlight / spotlight — explicitly not the IR illuminator (`IRLamp`), which is a
// different fixture that most cameras drive automatically.
const SPOTLIGHT_RE =
  /white[\s_-]*(?:light|led)|spot[\s_-]*light|flood[\s_-]*light|supplement[\s_-]*light/i;
const ALARM_RE = /siren|alarm|buzzer/i;

function auxCommandFor(token: string): IAuxCommand {
  const base = token.split('|')[0].trim();
  return { on: `${base}|On`, off: `${base}|Off` };
}

/** Classify a camera's advertised auxiliary-command tokens into the spotlight + alarm controls. */
export function classifyAuxCommands(tokens: readonly string[]): IAuxControls {
  const controls: IAuxControls = {};
  for (const raw of tokens) {
    const token = (raw ?? '').trim();
    if (!token) continue;
    if (!controls.spotlight && SPOTLIGHT_RE.test(token)) controls.spotlight = auxCommandFor(token);
    else if (!controls.alarm && ALARM_RE.test(token)) controls.alarm = auxCommandFor(token);
  }
  return controls;
}

/** Whether a camera's aux tokens expose a spotlight / alarm — the booleans stored for the UI gate. */
export function auxCapabilities(tokens: readonly string[]): { spotlight: boolean; alarm: boolean } {
  const c = classifyAuxCommands(tokens);
  return { spotlight: !!c.spotlight, alarm: !!c.alarm };
}

/** One PTZ node as the `onvif` lib returns it (linerase yields a string or array for a repeated field). */
export interface IPtzNodeAux {
  auxiliaryCommands?: string | string[];
}

/**
 * Flatten the auxiliary commands advertised across a camera's PTZ nodes into a clean token list. The
 * `onvif` lib returns nodes keyed by token; a node's `auxiliaryCommands` is a single string when one is
 * advertised and an array when several are — normalise both, trim, and drop blanks.
 */
export function auxTokensFromNodes(
  nodes: Record<string, IPtzNodeAux | undefined> | null | undefined,
): string[] {
  if (!nodes) return [];
  const out: string[] = [];
  for (const node of Object.values(nodes)) {
    const a = node?.auxiliaryCommands;
    if (typeof a === 'string') out.push(a);
    else if (Array.isArray(a)) out.push(...a.filter((x): x is string => typeof x === 'string'));
  }
  return out.map((s) => s.trim()).filter(Boolean);
}
