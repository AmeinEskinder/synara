// Read-only display probe. Never request, grant, reset or bypass TCC permissions.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { release } from "node:os";
import { fileURLToPath } from "node:url";

const source = process.cwd();
const driver = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = join(process.env.RUNNER_TEMP, "mac-display-probe");
const sourceSha = "ec8c940e07582454a475250ade40147e3c89d59f";
const sourceTree = "26c3b060469f224dce8135d8046697eb43fe0794";
mkdirSync(output, { recursive: true });
const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const save = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2) + "\n");
function command(executable, args, cwd = source, timeout = 20_000) {
  const result = spawnSync(executable, args, { cwd, encoding: "utf8", timeout, shell: false });
  return {
    executable,
    args,
    status: result.status,
    signal: result.signal,
    error: result.error?.message ?? null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}
function git(args, cwd = source) {
  const result = command("git", args, cwd);
  assert.equal(result.status, 0, JSON.stringify(result));
  return result.stdout.trim();
}
function assertSource() {
  assert.equal(process.platform, "darwin");
  assert.equal(git(["rev-parse", "HEAD"]), sourceSha);
  assert.equal(git(["rev-parse", "HEAD^{tree}"]), sourceTree);
  assert.equal(git(["diff", "--exit-code", "HEAD", "--"]), "");
  assert.match(process.env.GITHUB_SHA ?? "", /^[a-f0-9]{40}$/);
  assert.equal(git(["rev-parse", "HEAD"], driver), process.env.GITHUB_SHA);
  assert.equal(git(["diff", "--exit-code", "HEAD", "--"], driver), "");
}

try {
  assertSource();
  save("provenance.json", {
    sourceSha,
    sourceTree,
    driverSha: process.env.GITHUB_SHA,
    driverTree: git(["rev-parse", "HEAD^{tree}"], driver),
    run: process.env.GITHUB_RUN_ID,
    os: { platform: process.platform, arch: process.arch, release: release() },
    scriptSha256: digest(fileURLToPath(import.meta.url)),
    workflowSha256: digest(join(driver, ".github/workflows/mac-display-probe.yml")),
    mainSha256: digest(join(source, "apps/desktop/src/main.ts")),
    iconSha256: digest(join(source, "apps/desktop/resources/icon.icns")),
    qualification:
      "Existing hosted-runner display access only. No application launched, native Dock behavior established, permission prompt requested, TCC modified, privilege elevation or GUI authorization bypass. A successful capture still requires visual inspection before planning any app experiment.",
  });
  const windowServer = command("/usr/bin/pgrep", ["-x", "WindowServer"]);
  const preflight = command("/usr/bin/swift", ["-e", `
    import CoreGraphics
    var count: UInt32 = 0
    let status = CGGetActiveDisplayList(0, nil, &count)
    print("activeDisplayCount=\\(count)")
    print("activeDisplayListError=\\(status.rawValue)")
    print("screenCapturePreflight=\\(CGPreflightScreenCaptureAccess())")
  `], source, 30_000);
  const imagePath = join(output, "display-probe.png");
  const capture = command("/usr/sbin/screencapture", ["-x", "-t", "png", "-T", "1", imagePath]);
  let image = null;
  if (existsSync(imagePath)) {
    const bytes = readFileSync(imagePath);
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.ok(bytes.length >= 24);
    image = {
      bytes: bytes.length,
      sha256: digest(imagePath),
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
    };
  }
  assertSource();
  const captured = capture.status === 0 && image !== null && image.width > 0 && image.height > 0;
  save("display-result.json", { sourceSha, windowServer, preflight, capture, image, captured });
  console.log(JSON.stringify({ captured, windowServerStatus: windowServer.status, captureStatus: capture.status, image }));
  if (!captured) process.exitCode = 1;
} catch (error) {
  save("probe-failure.json", { message: String(error), stack: error.stack });
  console.error(error);
  process.exitCode = 1;
}
