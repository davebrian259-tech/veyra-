#!/usr/bin/env bash
# Masters the score to -14 LUFS / -1 dBTP (two-pass EBU R128) and muxes it onto the picture.
#   scripts/mux.sh out/veyra-heist-silent.mp4 audio/stems/mix.wav out/veyra-heist.mp4
set -euo pipefail
video="$1"; audio="$2"; out="$3"
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$video")
stats=$(ffmpeg -hide_banner -nostats -i "$audio" -t "$dur" -af loudnorm=I=-14:TP=-1:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')
get() { echo "$stats" | grep "\"$1\"" | sed -E 's/.*: "([^"]+)".*/\1/'; }
af="loudnorm=I=-14:TP=-1:LRA=11:measured_I=$(get input_i):measured_TP=$(get input_tp):measured_LRA=$(get input_lra):measured_thresh=$(get input_thresh):offset=$(get target_offset):linear=true,afade=t=out:st=$(echo "$dur - 0.6" | bc):d=0.6"
ffmpeg -hide_banner -y -i "$video" -i "$audio" -map 0:v:0 -map 1:a:0 -t "$dur" -c:v copy -af "$af" -ar 48000 -ac 2 -c:a aac -b:a 320k -movflags +faststart "$out"
