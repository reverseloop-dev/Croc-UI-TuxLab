#!/bin/bash
# croc-commander — build Linux AppImage
set -e
cd "$(dirname "$0")"

echo "==> Installing dependencies"
npm install

echo "==> Building Linux AppImage"
npm run build:linux

echo
echo "==> Done. Artifact:"
ls -1 dist/croc-commander-*.AppImage
echo
echo "Run it:  ./croc-commander"
