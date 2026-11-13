#!/usr/bin/env bash
# Masters the score to about -14 LUFS with a true-peak-safe ceiling and muxes it onto the picture.
#   scripts/mux.sh out/veyra-heist-silent.mp4 audio/stems/mix.wav out/veyra-heist.mp4
# Gain is set from the measured loudness; a limiter at 4x oversampling (-2.5 dB ceiling) catches
# inter-sample peaks so the AAC encode stays under -1 dBTP.
set -euo pipefail
video="$1"; audio="$2"; out="$3"
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$video")
measure() { ffmpeg -hide_banner -nostats -i "$1" -t "$dur" -af loudnorm=print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p' | grep '"input_i"' | sed -E 's/.*: "([^"]+)".*/\1/'; }
master() { # $1 = gain dB, $2 = output wav
  ffmpeg -hide_banner -loglevel error -y -i "$audio" -t "$dur" -af "aresample=192000,volume=${1}dB,alimiter=limit=0.75:attack=2:release=80:level=disabled,aresample=48000,afade=t=out:st=$(echo "$dur - 0.6" | bc):d=0.6" -c:a pcm_s24le "$2"
}
tmp="$(dirname "$out")/.master.wav"
i0=$(measure "$audio"); g=$(echo "-14 - ($i0)" | bc -l)
master "$g" "$tmp"
i1=$(measure "$tmp"); g=$(echo "$g + (-14 - ($i1))" | bc -l)   # the limiter takes a little: correct once
master "$g" "$tmp"
# one final encode: standard-range yuv420p H.264 High (plays everywhere), AAC stereo
ffmpeg -hide_banner -y -i "$video" -i "$tmp" -map 0:v:0 -map 1:a:0 -t "$dur" \
  -vf "scale=in_range=full:out_range=tv,format=yuv420p" -c:v libx264 -preset slow -crf 18 -tune film -profile:v high -level 4.1 \
  -color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
  -c:a aac -b:a 320k -ar 48000 -ac 2 -movflags +faststart "$out"
rm -f -- "$tmp"
