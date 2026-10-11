import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.cwd();
const driver = dirname(fileURLToPath(import.meta.url));
const cases = {
  before: { source: "ca7345b440a7a2fd3d9ffa4637d708cc1a1519e8", tree: "52cd21be0f9eb753962247437eb4f91ea2381d4e" },
  after: { source: "63c33e00238b4ca13aa52ecee29bb6494ed4f642", tree: "5254b4f85ae05c15c4a93ef82da8cb34e3e11025" },
};
const variant = process.env.PR_STATUS_CONTROL_VARIANT;
const target = cases[variant];
assert.ok(target && process.env.PR_STATUS_CONTROL_SOURCE === target.source, "Unknown source control");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fixture = "apps/web/src/components/chat/MessagesTimeline.workingStatus.browser.tsx";
const expectedFixture = "2f4abb76e41f438939e105c9da4b6688eab86ea1a47fca2a62e630a20d0b0718";
const output = resolve(root, ".pr-status-control", variant);
function guard() {
  assert.equal(git("rev-parse", "HEAD"), target.source);
  assert.equal(git("rev-parse", "HEAD^{tree}"), target.tree);
  assert.equal(git("diff", "HEAD", "--name-only"), "");
  assert.equal(hash(readFileSync(resolve(driver, "fixtures/MessagesTimeline.workingStatus.browser.tsx"))), expectedFixture);
}
guard();
const command = process.argv[2];
if (command === "prepare") {
  if (variant === "before") {
    assert.equal(git("ls-files", "--", fixture), "");
    assert.equal(existsSync(resolve(root, fixture)), false);
    copyFileSync(resolve(driver, "fixtures/MessagesTimeline.workingStatus.browser.tsx"), resolve(root, fixture));
  } else {
    assert.equal(git("rev-parse", `HEAD:${fixture}`), "d2a44f3bce586f6c714f4b46f4e0292dea5cde57");
  }
  assert.equal(hash(readFileSync(resolve(root, fixture))), expectedFixture);
  mkdirSync(output, { recursive: true });
  const receipt = {
    variant,
    source: target.source,
    tree: target.tree,
    driver: execFileSync("git", ["rev-parse", "HEAD"], { cwd: driver, encoding: "utf8" }).trim(),
    fixture,
    fixtureSha256: expectedFixture,
    productionBlob: git("rev-parse", "HEAD:apps/web/src/components/chat/MessagesTimeline.tsx"),
    status: "prepared",
    applicationCodeModified: false,
    qualification: "The exact two unfiltered production browser regressions run against the pre-repair and repaired source. Controlled conversation and real pointer state changes; actual exit status is retained, including expected negative controls. No native or live-provider claim.",
  };
  writeFileSync(resolve(output, "provenance.json"), JSON.stringify(receipt, null, 2) + "\n");
  assert.ok(process.env.GITHUB_ENV);
  appendFileSync(process.env.GITHUB_ENV, `PR_STATUS_CONTROL_OUTPUT=${output}\n`);
  console.log(JSON.stringify(receipt));
} else if (command === "verify") {
  assert.equal(hash(readFileSync(resolve(root, fixture))), expectedFixture);
  const receipt = JSON.parse(readFileSync(resolve(output, "provenance.json"), "utf8"));
  assert.equal(receipt.source, target.source);
  const exits = JSON.parse(readFileSync(resolve(output, "exits.json"), "utf8"));
  assert.equal(Object.keys(exits).toSorted().join(","), "tee,vitest");
  assert.ok(Object.values(exits).every((value) => Number.isInteger(value) && value >= 0 && value <= 255));
  const report = JSON.parse(readFileSync(resolve(output, "vitest.json"), "utf8"));
  assert.equal(report.numTotalTests, 2);
  assert.equal(report.numPendingTests, 0);
  assert.equal(report.numPassedTests + report.numFailedTests, 2);
  assert.equal(exits.vitest === 0, report.numFailedTests === 0);
  const files = ["vitest.log", "vitest.json", "exits.json"].map((path) => {
    const bytes = readFileSync(resolve(output, path));
    return { path, bytes: bytes.length, sha256: hash(bytes) };
  });
  const actualExitCode = exits.vitest || exits.tee;
  const result = { ...receipt, status: actualExitCode === 0 ? "completed" : "failed", actualExitCode, exits, passed: report.numPassedTests, failed: report.numFailedTests, files };
  writeFileSync(resolve(output, "provenance.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
  process.exitCode = actualExitCode;
} else throw new Error("Use prepare or verify.");
