// Renders chosen frames of the film (one bundle, many stills) for review: node scripts/frames.mjs 100 400 ...
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import path from "node:path";

const frames = process.argv.slice(2).map(Number);
const scale = Number(process.env.SCALE ?? 0.5);
const entry = path.resolve("src/index.ts");
const serveUrl = await bundle({ entryPoint: entry });
const browserExecutable = "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";
const composition = await selectComposition({ serveUrl, id: process.env.COMP ?? "VeyraHeist", browserExecutable, chromiumOptions: { gl: "swangle" } });
for (const frame of frames) {
  const output = path.resolve(`out/review/f${String(frame).padStart(4, "0")}.jpg`);
  await renderStill({ composition, serveUrl, output, frame, scale, imageFormat: "jpeg", jpegQuality: 85, browserExecutable, chromiumOptions: { gl: "swangle" } });
  console.log("rendered", frame);
}
