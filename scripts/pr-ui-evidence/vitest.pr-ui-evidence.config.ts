import { defineConfig } from "vitest/config";

import browserConfig from "./vitest.browser.config";

const fixture = process.env.VITE_PR_UI_EVIDENCE_TEST;
if (!fixture || !/^src\/components\/[A-Za-z0-9.]+\.browser\.tsx$/.test(fixture)) {
  throw new Error("An explicit reviewed browser fixture is required.");
}

export default defineConfig({
  ...browserConfig,
  test: {
    ...browserConfig.test,
    include: [fixture],
    testNamePattern: /PR UI evidence/,
    passWithNoTests: false,
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
