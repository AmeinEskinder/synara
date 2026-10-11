import { defineConfig } from "vitest/config";

import baseConfig from "./vitest.browser.config";

export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    // Run the complete original 41-case file once in each independent arm.
    include: ["src/components/EventRouter.browser.tsx"],
  },
});
