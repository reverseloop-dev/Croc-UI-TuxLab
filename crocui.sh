#!/bin/bash
# CroC UI launcher — works on Fedora Silverblue (no FUSE2)
DIR="$(dirname "$(readlink -f "$0")")"
APPIMAGE="$DIR/CroC UI-1.0.0.AppImage"
if [ ! -f "$APPIMAGE" ]; then
  echo "AppImage not found. Run 'npm run build:linux' first."
  exit 1
fi
export APPIMAGE_EXTRACT_AND_RUN=1
exec "$APPIMAGE" "$@"