import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const mode = process.env.RUNTIME_SCROLL_CASE;
assert.ok(mode === "before" || mode === "after", "Unknown comparison case");
const expectedHead = process.env.RUNTIME_SCROLL_SOURCE;
assert.match(expectedHead ?? "", /^[0-9a-f]{40}$/);
const expectedHook = process.env.RUNTIME_SCROLL_HOOK_BLOB;
assert.match(expectedHook ?? "", /^[0-9a-f]{40}$/);
const suitePath = "apps/web/src/components/chat/useChatTranscriptScroll.browser.tsx";
const hookPath = "apps/web/src/components/chat/useChatTranscriptScroll.ts";
const suiteBlob = "1f390a8599188f8f418c3ae6fc87adbc8ad5c1d2";
const out = resolve(".runtime-scroll-output");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function verifySource() {
  assert.equal(git("rev-parse", "HEAD"), expectedHead);
  assert.equal(git("hash-object", hookPath), expectedHook);
  assert.equal(git("hash-object", suitePath), suiteBlob);
  // Diagnostics may add untracked output, but no tracked application or test
  // source may change between immutable checkout and the recorded result.
  assert.equal(git("diff", "--name-only", "HEAD", "--"), "");
}

verifySource();
mkdirSync(out, { recursive: true });
const provenance = {
  case: mode,
  source: expectedHead,
  hookBlob: expectedHook,
  suiteBlob,
  driver: process.env.GITHUB_SHA,
  runId: process.env.GITHUB_RUN_ID,
  hookSha256: sha256(readFileSync(hookPath)),
  suiteSha256: sha256(readFileSync(suitePath)),
  boundary:
    "Real Chromium and production React hook; controlled overflowing-node geometry and handler events. This does not prove native keyboard or wheel distances, packaged desktop behavior, or a live provider session.",
};

if (process.argv[2] === "prepare") {
  writeFileSync(resolve(out, "provenance.json"), JSON.stringify(provenance, null, 2) + "\n");
  console.log(JSON.stringify({ stage: "prepared", ...provenance }));
} else if (process.argv[2] === "verify") {
  const raw = readFileSync(resolve(out, "vitest.json"));
  const result = JSON.parse(raw.toString());
  const assertions = result.testResults.flatMap((suite) => suite.assertionResults);
  const failures = assertions.filter((test) => test.status === "failed");
  assert.equal(result.numTotalTests, 10);
  assert.equal(result.numPendingTests, 0);
  assert.equal(assertions.length, 10);
  assert.ok(assertions.every((test) => test.status === "passed" || test.status === "failed"));
  if (mode === "before") {
    assert.equal(result.numFailedTests, 1);
    assert.equal(result.numPassedTests, 9);
    assert.equal(failures.length, 1);
    assert.match(
      failures[0].fullName,
      /retains observed 'keyboard' ownership across row compensation \(moved up: true\)/,
    );
    assert.match(failures[0].failureMessages.join("\n"), /expected false to be true/);
  } else {
    assert.equal(result.numFailedTests, 0);
    assert.equal(result.numPassedTests, 10);
    assert.equal(failures.length, 0);
  }
  const verification = {
    ...provenance,
    verdict: mode === "before" ? "expected keyboard regression reproduced" : "all ten browser cases passed",
    passed: result.numPassedTests,
    failed: result.numFailedTests,
    failedNames: failures.map((test) => test.fullName),
    reportSha256: sha256(raw),
  };
  writeFileSync(resolve(out, "verification.json"), JSON.stringify(verification, null, 2) + "\n");
  console.log(JSON.stringify(verification));
} else {
  throw new Error("Expected prepare or verify");
}
