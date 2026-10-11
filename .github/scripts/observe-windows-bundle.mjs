// Source-pinned observation of the unchanged Windows packaging command.
import assert from "node:assert/strict";
import { spawn, spawnSync, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const source = process.cwd();
const driver = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const evidence = join(process.env.RUNNER_TEMP, "windows-bundle-observation");
const sourceSha = "620c7d39e8b7b71572999d4742d9453c44a73587";
const sourceTree = "c0a5a673823102d78f50b22cfbac48fea33dfac9";
const phase = process.argv[2];
assert.equal(process.platform, "win32");
assert.ok(["prepare", "build", "finish"].includes(phase));
mkdirSync(evidence, { recursive: true });
const save = (name, value) =>
  writeFileSync(join(evidence, name), JSON.stringify(value, null, 2) + "\n");
const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
function run(command, args, cwd = source) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 30_000, shell: false });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}
function assertSource() {
  assert.equal(run("git", ["rev-parse", "HEAD"]), sourceSha);
  assert.equal(run("git", ["rev-parse", "HEAD^{tree}"]), sourceTree);
  assert.equal(run("git", ["diff", "--exit-code", "HEAD", "--"]), "");
  assert.equal(run("git", ["rev-parse", "HEAD"], driver), process.env.GITHUB_SHA);
  assert.equal(run("git", ["diff", "--exit-code", "HEAD", "--"], driver), "");
}
async function observeBuild(provenance) {
  const bun = run("where.exe", ["bun"])
    .split(/\r?\n/)
    .find((path) => /\.exe$/i.test(path) && existsSync(path));
  assert.ok(bun, "The pinned native Bun executable must be installed");
  const args = [
    "run",
    "dist:desktop:artifact",
    "--",
    "--platform",
    "win",
    "--flavor",
    "production",
    "--target",
    "nsis",
    "--arch",
    "x64",
    "--build-version",
    "0.8.4",
    "--source-commit",
    sourceSha,
    "--lockfile-sha256",
    provenance.lockfileSha256,
    "--keep-stage",
    "--verbose",
    "--output-dir",
    join(process.env.RUNNER_TEMP, "size-artifacts"),
  ];
  const env = {
    ...process.env,
    TMPDIR: provenance.stageParent,
    TMP: provenance.stageParent,
    TEMP: provenance.stageParent,
  };
  const log = join(evidence, "build.log");
  writeFileSync(log, "");
  const child = spawn(bun, args, {
    cwd: source,
    env,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let samples = 0;
  let sampleTail = Promise.resolve();
  const started = new Date().toISOString();
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk) => {
      appendFileSync(log, chunk);
      process.stdout.write(chunk);
    });
  function sample() {
    // Only process identifiers, names and memory sizes are sampled. Never read
    // command lines, environment variables, unrelated files, or credentials.
    sampleTail = sampleTail.then(
      () =>
        new Promise((resolveSample) => {
          execFile(
            "powershell.exe",
            [
              "-NoLogo",
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CreationDate,WorkingSetSize | ConvertTo-Json -Compress",
            ],
            { encoding: "utf8", timeout: 10_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
            (error, stdout) => {
              const timestamp = new Date().toISOString();
              try {
                if (error) throw error;
                const parsed = JSON.parse(stdout);
                const all = Array.isArray(parsed) ? parsed : [parsed];
                const pids = new Set([child.pid]);
                let previous;
                do {
                  previous = pids.size;
                  for (const row of all) if (pids.has(row.ParentProcessId)) pids.add(row.ProcessId);
                } while (previous !== pids.size);
                const descendants = all.filter((row) => pids.has(row.ProcessId));
                appendFileSync(
                  join(evidence, "descendant-processes.jsonl"),
                  JSON.stringify({ timestamp, buildPid: child.pid, descendants }) + "\n",
                );
                samples++;
              } catch (sampleError) {
                appendFileSync(
                  join(evidence, "observer-errors.jsonl"),
                  JSON.stringify({ timestamp, message: String(sampleError) }) + "\n",
                );
              }
              resolveSample();
            },
          );
        }),
    );
  }
  sample();
  const interval = setInterval(sample, 30_000);
  let deadline;
  let termination;
  let expired = false;
  const result = await new Promise((resolveResult) => {
    let finished = false;
    const finish = (value) => {
      if (!finished) {
        finished = true;
        resolveResult(value);
      }
    };
    child.once("error", (error) => finish({ exitCode: 127, error: String(error) }));
    child.once("close", (code, signal) => finish({ exitCode: code ?? 1, signal }));
    deadline = setTimeout(() => {
      expired = true;
      const kill = spawnSync("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], {
        encoding: "utf8",
        timeout: 15_000,
        windowsHide: true,
        shell: false,
      });
      termination = {
        status: kill.status,
        error: kill.error?.message,
        stdout: kill.stdout,
        stderr: kill.stderr,
      };
      save("deadline-termination.json", termination);
      child.stdout.destroy();
      child.stderr.destroy();
      child.kill();
      finish({ exitCode: 124, error: "Thirty-minute child build deadline exceeded" });
    }, 30 * 60_000);
  });
  clearInterval(interval);
  clearTimeout(deadline);
  await sampleTail;
  const completed = {
    sourceSha,
    driverSha: process.env.GITHUB_SHA,
    started,
    completed: new Date().toISOString(),
    bun,
    bunVersion: run(bun, ["--version"]),
    args,
    ...result,
    deadlineExceeded: expired,
    termination,
    processSamples: samples,
    logSha256: digest(log),
  };
  save("build-result.json", completed);
  if (result.exitCode !== 0 || expired)
    throw new Error(
      `Windows build failed with exit ${result.exitCode}; retained full log and process samples.`,
    );
  assert.ok(samples > 0, "No successful process sample was captured");
}
async function main() {
  assertSource();
  if (phase === "prepare") {
    const stageParent = mkdtempSync(join(process.env.RUNNER_TEMP, "ba-"));
    const provenance = {
      sourceSha,
      sourceTree,
      driverSha: process.env.GITHUB_SHA,
      driverTree: run("git", ["rev-parse", "HEAD^{tree}"], driver),
      lockfileSha256: digest(join(source, "bun.lock")),
      stageParent,
      driverScriptSha256: digest(fileURLToPath(import.meta.url)),
      builderSha256: digest(join(source, "scripts/build-desktop-artifact.ts")),
      canonicalStartupSha256: digest(join(source, "scripts/verify-packaged-desktop-startup.ts")),
      measurementSha256: digest(join(source, ".github/scripts/measure-bundle-size.mjs")),
      node: process.version,
      flavor: "production",
      platform: "win",
      arch: "x64",
      version: "0.8.4",
      signed: false,
      qualification:
        "Actual unchanged exact-head unsigned Windows NSIS build, measurement and canonical runtime/startup. Read-only descendant process sampling and a child deadline retain failure evidence before the whole-job timeout. No source mutation, signing, release, comparison benchmark, or original timeout-cause claim.",
    };
    save("provenance.json", provenance);
    appendFileSync(
      process.env.GITHUB_ENV,
      `AUDIT_TEMP_ROOT=${stageParent}\nAUDIT_LOCKFILE_SHA256=${provenance.lockfileSha256}\nAUDIT_EVIDENCE=${evidence}\n`,
    );
    return;
  }
  const provenance = JSON.parse(readFileSync(join(evidence, "provenance.json"), "utf8"));
  assert.equal(provenance.sourceSha, sourceSha);
  assert.equal(provenance.driverSha, process.env.GITHUB_SHA);
  assert.equal(provenance.lockfileSha256, digest(join(source, "bun.lock")));
  assert.equal(provenance.builderSha256, digest(join(source, "scripts/build-desktop-artifact.ts")));
  assert.equal(
    provenance.canonicalStartupSha256,
    digest(join(source, "scripts/verify-packaged-desktop-startup.ts")),
  );
  assert.equal(
    provenance.measurementSha256,
    digest(join(source, ".github/scripts/measure-bundle-size.mjs")),
  );
  if (phase === "build") return observeBuild(provenance);
  const result = JSON.parse(readFileSync(join(evidence, "build-result.json"), "utf8"));
  const qualified =
    result.exitCode === 0 &&
    !result.deadlineExceeded &&
    process.env.MEASUREMENT_OUTCOME === "success" &&
    process.env.STARTUP_OUTCOME === "success";
  const files = readdirSync(evidence)
    .filter((name) => statSync(join(evidence, name)).isFile())
    .map((name) => ({
      name,
      bytes: statSync(join(evidence, name)).size,
      sha256: digest(join(evidence, name)),
    }));
  save("qualification.json", {
    sourceSha,
    driverSha: process.env.GITHUB_SHA,
    qualified,
    measurement: process.env.MEASUREMENT_OUTCOME,
    startup: process.env.STARTUP_OUTCOME,
    files,
  });
  assert.ok(qualified, "Windows qualification failed; original outcome and artifacts retained");
}
await main().catch((error) => {
  save(`${phase}-failure.json`, { message: String(error), stack: error.stack });
  console.error(error);
  process.exitCode = 1;
});
