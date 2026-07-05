#!/usr/bin/env bash
# Records the demo and converts it to an optimized GIF at demo/demo.gif.
#
# Usage:
#   cd demo && npm install && npx playwright install chromium
#   # in another terminal: cd frontend && npm run dev
#   ./record-demo.sh
set -euo pipefail

cd "$(dirname "$0")"

echo "==> Recording demo with Playwright..."
rm -rf recording
node record-demo.mjs

VIDEO=$(ls -t recording/*.webm | head -1)
echo "==> Converting $VIDEO to demo.gif..."

# Two-pass: build a palette for good color, then encode a compact, looping GIF.
# fps=12 and width=720 keep the file small while staying readable.
ffmpeg -y -i "$VIDEO" -vf "fps=12,scale=720:-1:flags=lanczos,palettegen=stats_mode=diff" /tmp/le-palette.png
ffmpeg -y -i "$VIDEO" -i /tmp/le-palette.png \
  -lavfi "fps=12,scale=720:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3" \
  demo.gif

rm -rf recording /tmp/le-palette.png
echo "==> Done: $(pwd)/demo.gif"
ls -lh demo.gif
