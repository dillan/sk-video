#!/usr/bin/env bash
# Generate the six demo-camera stills with OpenAI's image API, from the prompts in README.md.
#
#   1. put your key in ./.env         (OPENAI_API_KEY=... — gitignored, never committed)
#   2. ./generate.sh                  (writes foredeck.jpg, stern.jpg, … here)
#   3. cd ../screenshots && ./capture-all.sh --admin --copy
#
# Consistency: foredeck is generated first, then passed as a REFERENCE IMAGE to the other five via
# the image-edits endpoint, so the whole set reads as one vessel on one afternoon. Costs a few cents
# per run. The key is read from the environment and never printed, logged, or written anywhere.
set -euo pipefail
cd "$(dirname "$0")"

# Load ./.env without echoing it.
if [ -f .env ]; then set -a; . ./.env; set +a; fi
if [ -z "${OPENAI_API_KEY:-}" ]; then
  echo "!! OPENAI_API_KEY is empty. Paste your key into e2e/stills/.env (see .env.example)." >&2
  exit 1
fi

MODEL="${OPENAI_IMAGE_MODEL:-gpt-image-1}"
SIZE="${OPENAI_IMAGE_SIZE:-1536x1024}"   # gpt-image-1's widest (3:2); app covers/crops. Note: this is
                                         # ~1.5 MP — plenty for docs, but not literally 4K/1080p.
QUALITY="${OPENAI_IMAGE_QUALITY:-high}"

# --- The vessel & scene bible (kept in sync with README.md) ---------------------------------------
BIBLE="A 46-foot modern cruising sloop (sailing yacht) under way in open water. Glossy white \
fiberglass topsides with a single navy-blue cove stripe just below the rail; pale silver-grey \
non-skid decks; varnished teak toe rail, handrails and cockpit coamings; navy-blue canvas dodger, \
bimini and sail cover with brushed stainless-steel frames; silver anodized aluminum mast and boom; \
brushed stainless stanchions with double lifelines. Late-morning sun, clear sky with a few soft \
cumulus, ~12-knot breeze, deep cobalt-blue offshore water with light whitecaps, a faint low \
headland on the horizon, gentle heel to starboard. Shot on a fixed wide-angle marine deck camera: \
~120 degree field of view with slight barrel distortion, deep depth of field, bright daylight white \
balance, natural contrast, faint sensor noise. Photorealistic, raw uncorrected camera frame. \
Absolutely no text, no timestamp, no watermark, no logo, no on-screen graphics or UI overlays. No \
readable lettering on the boat. 16:9."

SAME="Photorealistic raw frame from a fixed wide-angle marine deck camera on the SAME sailing yacht \
as the reference image — keep the identical glossy white hull, single navy cove stripe, silver-grey \
non-skid deck, varnished teak trim, navy canvas, brushed stainless rails and silver aluminum rig, in \
the same late-morning light on cobalt water with a gentle starboard heel. No text, no timestamp, no \
watermark, no logo, no overlay, no readable lettering anywhere. 16:9. New camera position and view:"

# --- Per-shot prompts (the "This shot:" paragraphs from README.md) --------------------------------
SHOT_foredeck="This shot: mounted high on the mast looking forward and slightly down along the \
centreline. In frame: the coachroof and a flush forward hatch, side decks with the teak toe rail \
running to a stainless bow pulpit and anchor roller at the far end, a furled headsail on the \
forestay, deck cleats and a low winch; open cobalt water and the high horizon beyond the bow. No people."

SHOT_stern="mounted high on the mast looking aft and down. In frame: the coachroof, the navy dodger \
and bimini, the cockpit with a stainless wheel and binnacle, cockpit coamings and winches, the boom \
edge across the top of frame, the backstay, and the wake trailing astern to the horizon. No people."

SHOT_bow="mounted on the bow pulpit looking dead ahead. Lower foreground filled by the stainless \
pulpit rails and anchor roller and the tip of the furled headsail; the rest is open cobalt water, \
the bow wave and light spray at the waterline, whitecaps, and a big sky with soft cumulus. No people."

SHOT_port="mounted on the port side rail looking outboard. Near foreground: the side deck, teak toe \
rail and stanchions with double lifelines crossing the frame, a sliver of white topside below. \
Beyond: cobalt water sliding past, light whitecaps, the low headland on the mid-frame horizon. \
Because the boat heels to starboard, the port rail sits a little higher above the water. No people."

SHOT_starboard="the mirror of the port view — mounted on the starboard side rail looking outboard. \
Same side-deck, teak toe rail, stanchions and lifelines in the near foreground; the same low \
headland on the horizon, seen from the opposite side. Because the boat heels to starboard, the \
starboard rail sits lower, closer to the passing water and a little spray. No people."

SHOT_engine="a tidy sailboat engine compartment lit by a cool LED work light — a compact marine \
diesel (beige/cream block) with belts and a black alternator, coolant header tank, twin fuel \
filters, a stainless exhaust elbow, neatly loomed wiring, cream sound-insulation foam on the hatch \
walls, a clean bilge below. Photorealistic, raw camera frame, no text/labels/overlays. 16:9."

# --- Helpers --------------------------------------------------------------------------------------
decode_to() { # decode_to <out.jpg>  (reads b64 on stdin; python3 avoids BSD/GNU base64 -d/-D drift)
  python3 -c 'import sys,base64; sys.stdout.buffer.write(base64.b64decode(sys.stdin.read()))' > "$1"
}

api_err() { # api_err <response.json> — print the API error message (never contains the key) and die
  local msg; msg="$(jq -r '.error.message // "unknown error (no data returned)"' "$1" 2>/dev/null)"
  echo "   !! OpenAI API error: ${msg}" >&2
  exit 1
}

RESP="$(mktemp)"; trap 'rm -f "$RESP"' EXIT

generate_first() { # generate_first <name> <prompt>
  local name="$1" prompt="$2"
  echo "==> ${name} (generations)"
  jq -n --arg m "$MODEL" --arg p "${BIBLE} ${prompt}" --arg s "$SIZE" --arg q "$QUALITY" \
    '{model:$m, prompt:$p, size:$s, quality:$q, output_format:"jpeg", n:1}' \
  | curl -sS https://api.openai.com/v1/images/generations \
      -H "Authorization: Bearer ${OPENAI_API_KEY}" -H "Content-Type: application/json" \
      -d @- > "$RESP"
  jq -e '.data[0].b64_json' "$RESP" >/dev/null 2>&1 || api_err "$RESP"
  jq -r '.data[0].b64_json' "$RESP" | decode_to "${name}.jpg"
  echo "   wrote ${name}.jpg ($(du -h "${name}.jpg" | cut -f1))"
}

generate_from_ref() { # generate_from_ref <name> <ref.jpg> <shot-prompt>
  local name="$1" ref="$2" shot="$3"
  echo "==> ${name} (edits, ref=${ref})"
  curl -sS https://api.openai.com/v1/images/edits \
    -H "Authorization: Bearer ${OPENAI_API_KEY}" \
    -F "model=${MODEL}" -F "image[]=@${ref}" \
    -F "size=${SIZE}" -F "quality=${QUALITY}" -F "output_format=jpeg" \
    -F "prompt=${SAME} ${shot}" > "$RESP"
  jq -e '.data[0].b64_json' "$RESP" >/dev/null 2>&1 || api_err "$RESP"
  jq -r '.data[0].b64_json' "$RESP" | decode_to "${name}.jpg"
  echo "   wrote ${name}.jpg ($(du -h "${name}.jpg" | cut -f1))"
}

# --- Run ------------------------------------------------------------------------------------------
generate_first    foredeck    "$SHOT_foredeck"
generate_from_ref stern       foredeck.jpg "$SHOT_stern"
generate_from_ref bow         foredeck.jpg "$SHOT_bow"
generate_from_ref port        foredeck.jpg "$SHOT_port"
generate_from_ref starboard   foredeck.jpg "$SHOT_starboard"
# The engine room is an interior — the deck reference would fight it, so generate it standalone.
generate_first    engine-room "$SHOT_engine"

echo "==> Done. Six stills written to $(pwd)."
echo "    Next: cd ../screenshots && ./capture-all.sh --admin --copy"
