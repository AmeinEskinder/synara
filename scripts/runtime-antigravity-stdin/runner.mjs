import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  copyFileSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.cwd();
const driver = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = join(process.env.RUNNER_TEMP, "antigravity-stdin-output");
const phase = process.argv[2];
const caseName = process.env.RUNTIME_STDIN_CASE;
const cases = {
  before: {
    source: "92f0d641ce24a4c0bea9c55278795a016aa4a953",
    tree: "90bc91c709215b7dc04244fd8a897072481cf68a",
    production: "3fb57ec1ca590bbb115a4efd9c80d180b03e049e",
    originalTest: "ab36be4d82b5a165ed93ebbcf22de49cfa520883",
  },
  after: {
    source: "44c8c8e93896af9d9e8d0fe91591bd6c55be61a1",
    tree: "4c0cb96ef065024cbf692b10a8707b61ee2b2f11",
    production: "5fa183a93744105d02193cea546dbc61fc9ca8cc",
    originalTest: "8c378198f9cc9532e3959c7139182a665870c14f",
  },
};
const pins = cases[caseName];
assert.ok(pins, "Only the reviewed Before/After cases are supported");
assert.equal(process.env.RUNTIME_STDIN_SOURCE, pins.source);
mkdirSync(output, { recursive: true });
const fixture = "apps/server/src/provider/Layers/AntigravityAdapter.test.ts";
const fixtureBlob = "8c378198f9cc9532e3959c7139182a665870c14f";
const production = "apps/server/src/provider/Layers/AntigravityAdapter.ts";
const changed = [
  production,
  fixture,
  "packages/shared/src/windowsProcess.ts",
  "packages/shared/src/windowsProcess.test.ts",
  "packages/shared/src/platformProcess.ts",
];
const hash = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const gitBlob = (file) => {
  const bytes = readFileSync(file);
  return createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
};
const save = (name, value) =>
  writeFileSync(join(output, name), JSON.stringify(value, null, 2) + "\n");
function git(args, cwd = root) {
  const result = spawnSync("git", args, {
    cwd,
    shell: false,
    windowsHide: true,
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}
function sourceGuard(prepared) {
  assert.equal(git(["rev-parse", "HEAD"]), pins.source);
  assert.equal(git(["rev-parse", "HEAD^{tree}"]), pins.tree);
  assert.equal(git(["rev-parse", "HEAD"], driver), process.env.GITHUB_SHA);
  assert.equal(git(["diff", "--exit-code", "HEAD", "--"], driver), "");
  assert.equal(gitBlob(join(root, production)), pins.production);
  assert.equal(
    gitBlob(join(root, fixture)),
    prepared ? fixtureBlob : pins.originalTest,
  );
  const allowed = prepared && caseName === "before" ? [fixture] : [];
  assert.deepEqual(
    git(["diff", "--name-only", "HEAD", "--"]).split("\n").filter(Boolean).sort(),
    allowed,
    "Only the declared identical Before test overlay may differ from immutable source",
  );
}
function suite(name) {
  sourceGuard(true);
  if (name === "native") assert.equal(process.platform, "win32");
  else assert.equal(caseName, "after");
  const workspace = name === "shared" ? "packages/shared" : "apps/server";
  const files = name === "shared"
    ? ["src/windowsProcess.test.ts", "src/platformProcess.test.ts", "src/processRuntime.test.ts"]
    : name === "native"
      ? ["src/provider/Layers/AntigravityAdapter.test.ts", "-t", "Antigravity Windows process boundary"]
      : [
          "src/provider/Layers/AntigravityAdapter.test.ts",
          "src/provider/Layers/AntigravityAdapter.output.test.ts",
          "src/provider/antigravityPrintResult.test.ts",
        ];
  const args = [
    "run", "--cwd", workspace, "test", ...files,
    "--reporter=default", "--reporter=json", "--outputFile=" + join(output, name + ".json"),
  ];
  const log = join(output, name + ".log");
  const descriptor = openSync(log, "w");
  let result;
  try {
    // File descriptors retain all output without an exec buffer cap. The
    // unchanged Vitest timeouts and hosted job deadline remain authoritative.
    result = spawnSync("bun", args, {
      cwd: root, shell: false, windowsHide: true,
      stdio: ["ignore", descriptor, descriptor],
    });
  } finally {
    closeSync(descriptor);
  }
  process.stdout.write(readFileSync(log));
  save(name + "-exit.json", {
    source: pins.source,
    driver: process.env.GITHUB_SHA,
    command: "bun",
    args,
    status: result.status,
    signal: result.signal,
    error: result.error?.message,
    logSha256: hash(log),
  });
  sourceGuard(true);
  if (result.error || result.status !== 0 || result.signal !== null) {
    process.exitCode = Number.isInteger(result.status) && result.status > 0 && result.status < 256
      ? result.status
      : 1;
  }
}
function readOutcome(name) {
  const result = JSON.parse(readFileSync(join(output, name + ".json"), "utf8"));
  const exit = JSON.parse(readFileSync(join(output, name + "-exit.json"), "utf8"));
  assert.equal(exit.source, pins.source);
  assert.equal(exit.driver, process.env.GITHUB_SHA);
  assert.equal(exit.logSha256, hash(join(output, name + ".log")));
  assert.equal(exit.signal, null);
  assert.equal(exit.error, undefined);
  return { result, exit };
}
function main() {
  if (phase === "prepare") {
    sourceGuard(false);
    assert.equal(gitBlob(join(driver, fixture)), fixtureBlob);
    if (caseName === "before") copyFileSync(join(driver, fixture), join(root, fixture));
    sourceGuard(true);
    save("provenance.json", {
      source: pins.source,
      sourceTree: pins.tree,
      driver: process.env.GITHUB_SHA,
      driverTree: git(["rev-parse", "HEAD^{tree}"], driver),
      driverScriptSha256: hash(fileURLToPath(import.meta.url)),
      fixtureBlob,
      fixtureSha256: hash(join(root, fixture)),
      lockfileSha256: hash(join(root, "bun.lock")),
      platform: process.platform,
      node: process.version,
      files: changed.map(path => ({ path, gitBlob: gitBlob(join(root, path)), sha256: hash(join(root, path)) })),
      qualification: "Exact source with the identical full test file overlaid only on Before. Native Windows uses a real compiled fixture.exe and raw fixture.cmd in spaced Unicode paths; synthetic provider protocol, no authenticated Antigravity or process-tree Goal412 claim. Before must visibly fail exactly both batch LF/CRLF turns while the other five native cases pass.",
    });
    appendFileSync(process.env.GITHUB_ENV, "RUNTIME_STDIN_OUTPUT=" + output + "\n");
    return;
  }
  sourceGuard(true);
  if (["native", "server", "shared"].includes(phase)) return suite(phase);
  if (phase === "format-copy") {
    assert.equal(caseName, "after");
    for (const path of changed) {
      const destination = join(output, "formatted", path);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(join(root, path), destination);
    }
    return;
  }
  if (phase === "verify-source") return;
  if (phase === "verify-native") {
    assert.equal(process.platform, "win32");
    const { result, exit } = readOutcome("native");
    const cases = result.testResults.flatMap(file => file.assertionResults)
      .filter(test => test.fullName.includes("Antigravity Windows process boundary"));
    assert.equal(cases.length, 7);
    const failed = cases.filter(test => test.status === "failed");
    const passed = cases.filter(test => test.status === "passed");
    assert.equal(failed.length, caseName === "before" ? 2 : 0);
    assert.equal(passed.length, caseName === "before" ? 5 : 7);
    assert.equal(result.testResults.length, 1);
    assert.equal(result.numFailedTests, failed.length);
    assert.equal(result.numPassedTests, passed.length);
    assert.equal(result.success, caseName === "after");
    if (result.numRuntimeErrorTestSuites !== undefined) assert.equal(result.numRuntimeErrorTestSuites, 0);
    assert.equal(exit.status, caseName === "before" ? 1 : 0);
    for (const test of failed) {
      assert.match(test.fullName, /keeps batch turn prompts literal/);
      assert.ok(test.failureMessages.join("\n").includes(
        "Cannot safely execute Windows batch argument containing cmd.exe control characters.",
      ));
    }
    save("native-qualification.json", {
      source: pins.source, driver: process.env.GITHUB_SHA, fixtureBlob,
      expectedControlObserved: true,
      actualExit: exit.status,
      passed: passed.map(test => test.fullName),
      failed: failed.map(test => ({ name: test.fullName, messages: test.failureMessages })),
      reportSha256: hash(join(output, "native.json")),
      note: "An expected Before failure is retained as a failing test step/job; it is not a product pass.",
    });
    return;
  }
  assert.equal(phase, "verify-focused");
  const outcomes = ["server", "shared"].map(name => {
    const { result, exit } = readOutcome(name);
    return { name, exit: exit.status, passed: result.numPassedTests, failed: result.numFailedTests, success: result.success };
  });
  const staticOutcomes = Object.fromEntries([
    "FORMAT_OUTCOME", "LINT_OUTCOME", "SERVER_TYPES_OUTCOME", "SHARED_TYPES_OUTCOME", "BOUNDARY_OUTCOME",
  ].map(name => [name, process.env[name]]));
  const qualified = outcomes.every(x => x.exit === 0 && x.passed > 0 && x.failed === 0 && x.success === true)
    && Object.values(staticOutcomes).every(x => x === "success");
  save("focused-qualification.json", { source: pins.source, driver: process.env.GITHUB_SHA, qualified, outcomes, staticOutcomes });
  assert.ok(qualified, "A real focused/static check failed; retain its original log and outcome");
}
try {
  main();
} catch (error) {
  save(phase + "-failure.json", { message: String(error), stack: error.stack });
  console.error(error);
  process.exitCode = 1;
}
