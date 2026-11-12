// Synthesizes the game's four sound cues as small 16-bit mono WAV files (no samples, no licences).
// Run: node scripts/gen-sfx.mjs
import { writeFileSync } from "node:fs";
const RATE = 22050;
function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(Math.max(-1, Math.min(1, s)) * 32767 | 0, i * 2));
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
/** Notes: [frequency, start s, length s, wave]. Short attack, exponential decay. */
function render(notes, total, gain = 0.35) {
  const out = new Float32Array(Math.ceil(total * RATE));
  for (const [f, start, len, wave = "sine"] of notes) {
    const s0 = Math.floor(start * RATE), n = Math.floor(len * RATE);
    for (let i = 0; i < n && s0 + i < out.length; i++) {
      const t = i / RATE, env = Math.min(1, t / 0.005) * Math.exp(-t / (len / 4));
      const ph = 2 * Math.PI * f * t;
      const v = wave === "square" ? Math.sign(Math.sin(ph)) * 0.5 : wave === "tri" ? (2 / Math.PI) * Math.asin(Math.sin(ph)) : Math.sin(ph);
      out[s0 + i] += v * env * gain;
    }
  }
  return [...out];
}
const dir = "apps/web/public/sfx";
writeFileSync(`${dir}/tick.wav`, wav(render([[1320, 0, 0.05, "tri"]], 0.06, 0.25)));
writeFileSync(`${dir}/hold.wav`, wav(render([[110, 0, 0.35, "sine"], [82, 0.04, 0.3, "tri"]], 0.4, 0.5)));
writeFileSync(`${dir}/crack.wav`, wav(render([[523, 0, 0.18, "tri"], [659, 0.07, 0.18, "tri"], [784, 0.14, 0.2, "tri"], [1047, 0.21, 0.3, "sine"]], 0.55, 0.3)));
writeFileSync(`${dir}/unlock.wav`, wav(render([[880, 0, 0.12, "sine"], [1319, 0.08, 0.25, "sine"]], 0.36, 0.3)));
console.log("wrote", dir);
