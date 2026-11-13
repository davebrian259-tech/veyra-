#!/usr/bin/env bash
# Renders the film in scene-aligned chunks (robust on slow machines), skipping chunks already done.
set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p out/chunks
for r in 0-569 570-959 960-1634 1635-2309 2310-2549 2550-2789; do
  f="out/chunks/c-${r}.mp4"
  [ -s "$f" ] && { echo "skip $r"; continue; }
  for attempt in 1 2 3; do
    npx remotion render src/index.ts VeyraHeist "$f" --gl=swangle --concurrency=4 --muted --frames="$r" --timeout=240000 > "out/chunks/log-${r}.txt" 2>&1 && break
    echo "retry $r ($attempt)"; rm -f "$f"
  done
  echo "done $r"
done
echo ALL_DONE
