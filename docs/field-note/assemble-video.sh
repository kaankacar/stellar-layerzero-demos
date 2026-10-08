#!/usr/bin/env bash
# Assemble the DR-3 demo video from the card, the auto-recorded clips and any extra clips given as arguments.
# Usage: docs/field-note/assemble-video.sh [extra1.mov extra2.mp4 ...]
# Output: docs/field-note/handin/DR-3_usdt0-field-note_<today>.mp4 (1920x1080, 30 fps, H.264, silent unless a clip has audio)
set -euo pipefail
cd "$(dirname "$0")"
OUT_DIR=handin; mkdir -p "$OUT_DIR" clips/mp4
TODAY=$(date -u +%Y-%m-%d)
OUT="$OUT_DIR/DR-3_usdt0-field-note_${TODAY}.mp4"
norm() { # normalise any input to 1920x1080 30fps H.264 yuv420p with a silent audio track so concat never fails
  ffmpeg -y -loglevel error -i "$1" -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=48000 -shortest \
    -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p" \
    -c:v libx264 -preset medium -crf 20 -c:a aac -b:a 96k -movflags +faststart "$2"
}
LIST=clips/mp4/concat.txt; : > "$LIST"
add() { echo "file '$(pwd)/$1'" >> "$LIST"; }
# 1. the card, 3 s
ffmpeg -y -loglevel error -loop 1 -t 3 -i card/card.png -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=48000 -shortest \
  -vf "scale=1920:1080,format=yuv420p" -r 30 -c:v libx264 -crf 20 -c:a aac -b:a 96k clips/mp4/00-card.mp4
add clips/mp4/00-card.mp4
# 2. auto clips in shot-list order, then any extra clips passed on the command line (wallet recordings)
for c in clips/clip-02-ground-truth.webm clips/clip-03-inspector.webm "$@" clips/clip-09-tracker.webm clips/clip-12-readme.webm; do
  [ -f "$c" ] || { echo "skip missing $c" >&2; continue; }
  base=$(basename "${c%.*}"); norm "$c" "clips/mp4/$base.mp4"; add "clips/mp4/$base.mp4"
done
ffmpeg -y -loglevel error -f concat -safe 0 -i "$LIST" -c copy "$OUT"
ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT" | xargs -I{} echo "wrote $OUT ({} s)"
