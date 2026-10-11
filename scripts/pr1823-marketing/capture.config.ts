import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
import { join } from "node:path";
const output=process.env.PR1823_OUTPUT_DIR;
if(!output)throw new Error("Missing capture output.");
export default defineConfig({
  ...base,
  testMatch:"**/pr1823-capture.spec.ts",
  retries:0,
  reporter:[["list"],["json",{outputFile:join(output,"capture-report.json")}]],
  outputDir:join(output,"capture-test-results"),
  use:{...base.use,video:"on",trace:"on",screenshot:"on"}
});
