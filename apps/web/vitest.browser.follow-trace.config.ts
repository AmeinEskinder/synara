import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";
import canonicalConfig from "./vitest.browser.ci.config";

export default mergeConfig(
  canonicalConfig,
  defineConfig({
    resolve: {
      alias: {
        "@legendapp/list/react": fileURLToPath(
          new URL("../../output/follow-instrumented/react.mjs", import.meta.url),
        ),
      },
    },
    optimizeDeps: { force: true },
  }),
);
