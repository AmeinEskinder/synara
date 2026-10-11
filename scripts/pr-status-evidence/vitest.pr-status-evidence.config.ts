import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

import browserConfig from "./vitest.browser.config";

const directory = process.env.VITE_PR_UI_EVIDENCE_DIR;
const motion = process.env.VITE_PR_UI_MOTION_MODE;
if (!directory?.startsWith("/") || !["no-preference", "reduce"].includes(motion ?? "")) {
  throw new Error("Explicit status video output and motion preference are required.");
}

export default defineConfig({
  ...browserConfig,
  test: {
    ...browserConfig.test,
    include: ["src/components/PrUiEvidence174.browser.tsx"],
    browser: {
      ...browserConfig.test?.browser,
      provider: playwright({
        contextOptions: {
          reducedMotion: motion as "no-preference" | "reduce",
          recordVideo: { dir: `${directory}/video-${motion}`, size: { width: 1280, height: 900 } },
        },
      }),
    },
    passWithNoTests: false,
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 90_000,
    hookTimeout: 90_000,
  },
});
