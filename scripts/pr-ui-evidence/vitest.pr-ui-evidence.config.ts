import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

import browserConfig from "./vitest.browser.config";

const fixture = process.env.VITE_PR_UI_EVIDENCE_TEST;
if (!fixture || !/^src\/components\/[A-Za-z0-9.]+\.browser\.tsx$/.test(fixture)) {
  throw new Error("An explicit reviewed browser fixture is required.");
}

const directory = process.env.VITE_PR_UI_EVIDENCE_DIR;
const motion = process.env.VITE_PR_UI_MOTION_MODE;
if (!directory?.startsWith("/") || !["no-preference", "reduce"].includes(motion ?? "")) {
  throw new Error("Explicit rail video output and motion preference are required.");
}

export default defineConfig({
  ...browserConfig,
  test: {
    ...browserConfig.test,
    include: [fixture],
    browser: {
      ...browserConfig.test?.browser,
      provider: playwright({
        contextOptions: {
          reducedMotion: motion as "no-preference" | "reduce",
          recordVideo: { dir: `${directory}/video-${motion}`, size: { width: 1280, height: 900 } },
        },
      }),
    },
    testNamePattern: /PR UI evidence/,
    passWithNoTests: false,
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
