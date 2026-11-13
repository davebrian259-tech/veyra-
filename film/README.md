# VEYRA HEIST: the launch film

A 116-second cinematic for Veyra Heist, made entirely in code: the picture in React and Three.js
with [Remotion](https://www.remotion.dev), the score synthesized from scratch in Python. Every heist
on screen is the real referee's output; the economy is the game's own fast-forward simulation.

## What is in the film

| Time | Scene | What it shows |
|---|---|---|
| 0:00 | Open | A gold hairline closes into the outline of a vault door. *Every AI agent with a wallet is a vault.* |
| 0:09 | Reveal | Veyra's door in macro; its eight shields light on the beat, each named. *Make it overpay.* |
| 0:24 | Five vaults | The camera travels the five vaults, each with its shields and its real hint. |
| 0:40 | Build | A rogue agent assembled from the real "disguise" move; the payment verb highlighted. |
| 0:52 | The crack | The real duel on vault 4, beat by beat; the bars retract, the door opens on the gold. |
| 1:08 | The hold | The same move on vault 5; the taint trace fires and the bars slam home. |
| 1:20 | Economy | A failed fee splits 70 / 20 / 10; then a simulated week of NPC crews and backers in eight seconds, each decision in the NPC's own words. |
| 1:36 | Loot | The vault's gold bar, a NEP-245 item, minted to the winner and theirs to send. |
| 1:46 | Finale | The five doors lock on the beat; the mark; the line. |

## How it is made

- **Picture:** `src/` (Remotion). `src/three/Vault.tsx` is a procedural vault door: lathed steel,
  brushed-metal texture, 16 bolts (8 light as shields), locking bars, a spoke wheel, a hinge, and a
  custom GLSL energy-field shader (`ShieldField`) that ripples when a shield blocks.
  `src/three/Ingot.tsx` is the gold bar with an engraved top. Type is Geist, Geist Mono and
  Instrument Serif.
- **Data:** `src/data/` holds the real referee steps for the crack and the hold, a fast-forwarded
  week from `/heist/simulate`, the loot catalogue and the vaults, pulled from the game's API.
- **Timing:** `src/cues.json` is the cue sheet shared by picture and sound. 96 BPM at 24 fps is
  exactly 15 frames a beat; cuts and hits land on beats.
- **Sound:** `audio/score.py` synthesizes the music (drone, pulse, build, groove, tension, triumph,
  finale in D minor) and every effect (bolt latches panned around the door, locking clunks, the
  creak, the slam, coins, the clock) at the cue sheet's frames, with a stereo synthetic-room reverb,
  sidechain ducking, glue compression and a soft clip. `scripts/mux.sh` masters it to -14 LUFS,
  -1 dBTP (two-pass EBU R128) and muxes it onto the picture.

## Build it

```bash
npm install
```

```bash
npx remotion studio src/index.ts
```

```bash
npx remotion render src/index.ts VeyraHeist out/veyra-heist-silent.mp4 --gl=swangle --concurrency=4 --muted
```

```bash
python3 audio/score.py
```

```bash
scripts/mux.sh out/veyra-heist-silent.mp4 audio/stems/mix.wav out/veyra-heist.mp4
```

```bash
npx remotion still src/index.ts Cover out/cover.png --gl=swangle
```

Rendering uses software WebGL, so no GPU is needed; on four CPU cores the full film takes about two
hours. `remotion.config.ts` points at a local Chromium; set `REMOTION_CHROME` to use another.
The score needs Python 3 with numpy and scipy.
