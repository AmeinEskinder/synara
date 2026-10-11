import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const driver = dirname(fileURLToPath(import.meta.url));
const root = process.cwd();
const source = "2c305f13ddc665bb10c483ab883f06d4f185cc5e";
const sourceTree = "0c52f40208a513659a175e5fb68051abdc292bd3";
const feature = "7e956fd3fd7ee1deca1c034057705675857100d3";
const mode = process.env.SYNARA_TOAST_DIAGNOSTIC_MODE;
if (mode !== "control" && mode !== "trace") throw new Error("Unknown diagnostic arm.");
const output = resolve(root, ".toast-retry-diagnostics", mode);
const testPath = "apps/web/src/components/EventRouter.browser.tsx";
const configPath = "apps/web/vitest.toast-retry-diagnostic.config.ts";
const helperPath = "apps/web/src/test/toastRetryDiagnostic.ts";
const repairPath = resolve(driver, "fixture-repair.patch");
const repairedTestBlob = "cd4e4cd7862820f5fb33511482ae526ce35cdfd8";
const expectedBlobs = {
  [testPath]: "eda204c2c0d980b6b5d40ff1025b29e05bd83f12",
  "apps/web/src/components/ui/toast.tsx": "4c3df6599142435cc3317c64e6f96d2e7279bed3",
  "apps/web/src/routes/__root.tsx": "76d0d6f86cd653be5f9f5b314d766c3e4ac37e7d",
  "bun.lock": "faddbd37ca5094a0f8907c6513046f9f39e9c00a",
};
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const digest = (data) => createHash("sha256").update(data).digest("hex");
const manifestPath = resolve(output, "provenance.json");

function replaceOnce(text, from, to) {
  if (text.split(from).length !== 2) throw new Error(`Unexpected source boundary: ${from}`);
  return text.replace(from, to);
}

function overlayTrace(original) {
  const start = original.indexOf('  it.each(["thread", "shell"])(\n');
  const end = original.indexOf(
    '  it("ignores a retry rejection after the thread consumer is disposed"',
  );
  if (start < 0 || end <= start) throw new Error("Original regression not found.");
  let block = original.slice(start, end);
  if (!block.includes('"surfaces one %s retry rejection even while the paused notice exits"')) {
    throw new Error("Wrong parameterized test block.");
  }
  block = replaceOnce(
    block,
    "      try {\n        for (let attempt = 0; attempt < 2; attempt++) {\n",
    `      const diagnostic = startToastRetryDiagnostic({
        scope,
        counters: () => ({
          mockSubscribeCalls: subscribe.mock.calls.length,
          threadRequests: subscribeThreadRequestCountById.get(THREAD_ID) ?? 0,
          shellRequests: subscribeShellRequestCount,
          threadFailureListeners: threadSnapshotFailureListeners.size,
          shellFailureListeners: shellStreamFailureListeners.size,
          threadDetailState: useStore.getState().threadDetailSyncById?.[THREAD_ID] ?? null,
        }),
      });
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          diagnostic.attempt(attempt);
`,
  );
  block = replaceOnce(
    block,
    '          await page.getByRole("button", { name: "Retry updates", exact: true }).click();\n',
    '          diagnostic.snapshot("before-click");\n' +
      '          await page.getByRole("button", { name: "Retry updates", exact: true }).click();\n' +
      '          diagnostic.snapshot("after-click");\n',
  );
  block = replaceOnce(
    block,
    "          );\n        }\n      } finally {\n        subscribe.mockRestore();",
    '          );\n          diagnostic.snapshot("after-assertions");\n        }\n      } finally {\n' +
      "        diagnostic.finish();\n        subscribe.mockRestore();",
  );
  return replaceOnce(
    original.slice(0, start) + block + original.slice(end),
    'import { toastManager } from "./ui/toast";\n',
    'import { toastManager } from "./ui/toast";\n' +
      'import { startToastRetryDiagnostic } from "../test/toastRetryDiagnostic";\n',
  );
}

if (process.argv[2] === "prepare") {
  if (git("rev-parse", "HEAD") !== source || git("rev-parse", "HEAD^{tree}") !== sourceTree) {
    throw new Error("The checkout must be the immutable merge actually tested by the failed job.");
  }
  if (git("diff", "HEAD", "--name-only"))
    throw new Error("Application source was already modified.");
  for (const [path, expected] of Object.entries(expectedBlobs)) {
    if (git("hash-object", path) !== expected) throw new Error(`Unexpected source blob: ${path}`);
  }
  mkdirSync(output, { recursive: true });
  // Apply exactly the independently reviewed fixture-readiness repair to both
  // arms. All runtime source and the original retry assertions stay unchanged.
  git("apply", "--unidiff-zero", "--check", repairPath);
  git("apply", "--unidiff-zero", repairPath);
  if (git("hash-object", testPath) !== repairedTestBlob) {
    throw new Error("The applied fixture repair does not match the reviewed candidate.");
  }
  const repaired = readFileSync(resolve(root, testPath), "utf8");
  const overlays = [testPath];
  for (const path of mode === "trace" ? [configPath, helperPath] : [configPath]) {
    if (git("ls-files", path)) throw new Error(`The diagnostic may not replace ${path}`);
  }
  if (mode === "trace") {
    writeFileSync(resolve(root, testPath), overlayTrace(repaired));
    copyFileSync(resolve(driver, "trace.ts"), resolve(root, helperPath));
    overlays.push(helperPath);
  }
  copyFileSync(
    resolve(driver, "vitest.toast-retry-diagnostic.config.ts"),
    resolve(root, configPath),
  );
  overlays.push(configPath);
  const manifest = {
    mode,
    source,
    sourceTree,
    feature,
    failedJob: 114334052483,
    driver: execFileSync("git", ["rev-parse", "HEAD"], { cwd: driver, encoding: "utf8" }).trim(),
    expectedBlobs,
    fixtureRepair: {
      originalTestBlob: expectedBlobs[testPath],
      repairedTestBlob,
      patchSha256: digest(readFileSync(repairPath)),
      scope:
        "Only retry-rejection variants require initial synced detail within the existing 60s mount guard.",
    },
    overlays: overlays.map((path) => ({ path, sha256: digest(readFileSync(resolve(root, path))) })),
    assertionPolicy:
      "Original retry interactions, assertions and 90s timeout unchanged; initial-sync setup assertion added; no force click or retry.",
    observationLimit:
      "Trace DOM reads can perturb timing. The control has the same fixture repair and no observers.",
    baseUiVersion: "1.7.0",
    status: "prepared",
    createdAt: new Date().toISOString(),
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(resolve(output, "test-overlay.patch"), git("diff", "HEAD", "--", testPath));
  console.log(JSON.stringify(manifest));
} else if (process.argv[2] === "verify") {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (git("rev-parse", "HEAD") !== source) throw new Error("Source changed during diagnostic.");
  const changed = git("diff", "HEAD", "--name-only").split("\n").filter(Boolean);
  if (changed.some((path) => path !== testPath)) {
    throw new Error(`Unexpected tracked modification: ${changed.join(", ")}`);
  }
  for (const overlay of manifest.overlays) {
    if (digest(readFileSync(resolve(root, overlay.path))) !== overlay.sha256) {
      throw new Error(`Diagnostic source changed: ${overlay.path}`);
    }
  }
  const testExitCode = Number(readFileSync(resolve(output, "vitest-exit-code.txt"), "utf8"));
  if (!Number.isInteger(testExitCode) || testExitCode < 0)
    throw new Error("Missing test exit status.");
  const log = readFileSync(resolve(output, "vitest.log"), "utf8");
  const marker = "SYNARA_TOAST_RETRY_TRACE ";
  const journals = log
    .split("\n")
    .filter((line) => line.includes(marker))
    .map((line) => JSON.parse(line.slice(line.indexOf(marker) + marker.length)));
  writeFileSync(resolve(output, "journals.json"), `${JSON.stringify(journals, null, 2)}\n`);
  const completed = {
    ...manifest,
    status: "completed",
    testExitCode,
    journalScopes: journals.map((entry) => entry.scope),
    applicationCodeModified: false,
    completedAt: new Date().toISOString(),
  };
  writeFileSync(manifestPath, `${JSON.stringify(completed, null, 2)}\n`);
  if (
    mode === "trace" &&
    testExitCode === 0 &&
    JSON.stringify(journals.map((entry) => entry.scope).toSorted()) !== '["shell","thread"]'
  ) {
    throw new Error("A passing trace must preserve journals from both original variants.");
  }
  console.log(JSON.stringify(completed));
} else {
  throw new Error("Use prepare or verify.");
}
