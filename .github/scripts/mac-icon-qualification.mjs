// Native evidence only: no application, test, preference, or bundle source edits.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { release } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const phase = process.argv[2];
assert.ok(["prepare", "verify"].includes(phase));
assert.equal(process.platform, "darwin");
const source = process.cwd();
const driver = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const author = resolve(source, "../author");
const evidence = process.env.ICON_EVIDENCE;
assert.ok(evidence && !evidence.startsWith(source + "/"));
mkdirSync(evidence, { recursive: true });
const expected = {
  source: process.env.ICON_SOURCE_SHA,
  author: process.env.ICON_AUTHOR_SHA,
  driver: process.env.ICON_DRIVER_SHA,
};
const run = (args, cwd) => {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 30_000, shell: false });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const save = (name, value) =>
  writeFileSync(join(evidence, name), JSON.stringify(value, null, 2) + "\n");
const paths = [
  "apps/desktop/src/macAppIcon.native.test.ts",
  "apps/desktop/src/macAppIcon.test.ts",
  "apps/desktop/src/macAppIcon.ts",
  "apps/desktop/src/desktopAppIcon.ts",
  "apps/desktop/src/desktopAppIcon.test.ts",
  "apps/desktop/src/main.ts",
  "apps/desktop/resources/icon.icns",
  "apps/desktop/resources/dock-icon.png",
  "assets/prod/black-macos-legacy-1024.png",
  "scripts/build-desktop-artifact.ts",
  "scripts/lib/brand-assets.ts",
  "bun.lock",
];

function qualify() {
  try {
    const trees = {};
    for (const [name, cwd] of Object.entries({ source, author, driver })) {
      assert.match(expected[name] ?? "", /^[0-9a-f]{40}$/);
      assert.equal(run(["rev-parse", "HEAD"], cwd), expected[name]);
      assert.equal(run(["diff", "--exit-code", "HEAD", "--"], cwd), "");
      trees[name] = run(["rev-parse", "HEAD^{tree}"], cwd);
    }
    const sourceHashes = Object.fromEntries(
      paths.map((path) => [path, digest(join(source, path))]),
    );
    if (phase === "prepare") {
      copyFileSync(
        join(source, "apps/desktop/resources/dock-icon.png"),
        join(evidence, "current-main-runtime.png"),
      );
      copyFileSync(
        join(author, "assets/prod/black-macos-1024.png"),
        join(evidence, "before-author-modern-source.png"),
      );
      save("provenance.json", {
        ...expected,
        trees,
        sourceHashes,
        os: { platform: process.platform, arch: process.arch, release: release() },
        authorIcnsSha256: digest(join(author, "apps/desktop/resources/icon.icns")),
        driverScriptSha256: digest(fileURLToPath(import.meta.url)),
        driverWorkflowSha256: digest(join(driver, ".github/workflows/mac-icon-qualification.yml")),
        scope:
          "Original author asset versus current-main asset decoding and unchanged current native NSWorkspace persistence tests. Decoded PNGs are bundle artwork, not live Dock screenshots. No full desktop build, on-screen running/quit Dock comparison, signed installation or icon-cache upgrade claim.",
      });
      return;
    }
    const provenance = JSON.parse(readFileSync(join(evidence, "provenance.json"), "utf8"));
    assert.deepEqual(provenance.sourceHashes, sourceHashes);
    assert.deepEqual(provenance.trees, trees);
    assert.equal(provenance.source, expected.source);
    assert.equal(provenance.author, expected.author);
    assert.equal(provenance.driver, expected.driver);
    const tests = JSON.parse(readFileSync(join(evidence, "native-tests.json"), "utf8"));
    assert.equal(tests.success, true);
    assert.equal(tests.numPendingTests, 0);
    assert.equal(tests.numFailedTests, 0);
    const native = tests.testResults.find((result) =>
      result.name.endsWith("/macAppIcon.native.test.ts"),
    );
    assert.ok(native, "Native test file must actually run on macOS");
    assert.equal(native.assertionResults.length, 1);
    assert.equal(native.assertionResults[0].status, "passed");
    assert.match(
      native.assertionResults[0].fullName,
      /keeps a custom icon after the writer exits and removes it for Default/,
    );
    const images = Object.fromEntries(
      ["before-author-bundle.png", "after-current-main-bundle.png", "current-main-runtime.png"].map(
        (path) => [path, digest(join(evidence, path))],
      ),
    );
    save("native-result.json", {
      ...expected,
      passedTests: tests.numPassedTests,
      nativePersistence: native.assertionResults[0],
      images,
      allSourceHashesPreserved: true,
    });
    console.log(
      "Unchanged native persistence test passed; exact source bytes and native icon exports retained.",
    );
  } catch (error) {
    save(`${phase}-failure.json`, { message: String(error), stack: error.stack });
    throw error;
  }
}
qualify();
