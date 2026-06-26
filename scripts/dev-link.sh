#!/usr/bin/env bash
# Link this working copy into a Signal K server and rebuild as you edit.
#
#   scripts/dev-link.sh [SIGNALK_DIR]
#
# SIGNALK_DIR defaults to ~/.signalk. The plugin is symlinked into
# <SIGNALK_DIR>/node_modules/sk-video so the server loads it straight from dist/.
# Restart the server (or toggle the plugin in Server -> Plugin Config) to pick up a rebuild.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SIGNALK_DIR="${1:-$HOME/.signalk}"
LINK_DIR="$SIGNALK_DIR/node_modules"
LINK="$LINK_DIR/sk-video"

if [[ ! -d "$SIGNALK_DIR" ]]; then
  echo "Signal K directory not found: $SIGNALK_DIR" >&2
  echo "Pass the path as the first argument, e.g. scripts/dev-link.sh /opt/signalk" >&2
  exit 1
fi

mkdir -p "$LINK_DIR"

if [[ -L "$LINK" ]]; then
  echo "==> Link already present: $LINK -> $(readlink "$LINK")"
elif [[ -e "$LINK" ]]; then
  echo "Refusing to replace existing non-symlink: $LINK" >&2
  echo "Remove it first if you want to link your working copy there." >&2
  exit 1
else
  ln -s "$REPO_DIR" "$LINK"
  echo "==> Linked $LINK -> $REPO_DIR"
fi

echo "==> Building once, then watching for changes (Ctrl-C to stop)"
echo "    Restart Signal K (or toggle the plugin) to load each rebuild."
cd "$REPO_DIR"
npm run build
exec npm run dev
