import { Config } from "@remotion/cli/config";

// Render with the machine's Chromium and software WebGL (SwiftShader via ANGLE): no GPU needed.
Config.setBrowserExecutable(process.env.REMOTION_CHROME ?? "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome");
Config.setChromiumOpenGlRenderer("swangle");
Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(95);
Config.setConcurrency(4);
Config.setPixelFormat("yuv420p");
Config.setCodec("h264");
Config.setCrf(16);
