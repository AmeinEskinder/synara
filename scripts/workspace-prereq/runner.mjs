import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const expectedSource = "70620c1ce1615239635905418b19a6b77fd0a642";
const driver = dirname(fileURLToPath(import.meta.url));
const root = process.cwd();
const output = resolve(process.env.SYNARA_PREREQ_OUTPUT);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const sourceFiles = [
  ".github/actions/setup-workspace/action.yml",
  "package.json",
  "apps/web/package.json",
  "bun.lock",
  "bunfig.toml",
];
const stamp = () => ({
  source: git("rev-parse", "HEAD"),
  sourceTree: git("rev-parse", "HEAD^{tree}"),
  driver: execFileSync("git", ["rev-parse", "HEAD"], { cwd: driver, encoding: "utf8" }).trim(),
  inputs: sourceFiles.map((path) => ({ path, sha256: sha256(readFileSync(path)) })),
  observerSha256: sha256(readFileSync(join(driver, "observe.cjs"))),
});
assert.equal(git("rev-parse", "HEAD"), expectedSource);
assert.equal(git("diff", "HEAD", "--name-only"), "");
mkdirSync(output, { recursive: true });
const provenancePath = join(output, "provenance.json");

if (process.argv[2] === "prepare") {
  assert.equal(process.platform, "win32");
  assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
  const traces = join(output, "traces");
  mkdirSync(traces, { recursive: true });
  const observer = join(driver, "observe.cjs");
  const env = {
    SYNARA_PREREQ_TRACE_DIR: traces,
    NODE_OPTIONS:
      `${process.env.NODE_OPTIONS || ""} --require ${JSON.stringify(observer.replaceAll("\\", "/"))}`.trim(),
  };
  assert.ok(process.env.GITHUB_ENV);
  for (const [name, value] of Object.entries(env)) {
    assert.ok(!/[\r\n]/.test(value));
    appendFileSync(process.env.GITHUB_ENV, `${name}=${value}\n`);
  }
  writeFileSync(
    provenancePath,
    JSON.stringify(
      {
        ...stamp(),
        preparedAt: new Date().toISOString(),
        runner: { os: process.platform, arch: process.arch, node: process.version },
        boundary:
          "Observed unmodified frozen runtime install and canonical Windows regression commands; compiler I/O observer may affect timing and does not itself establish a fix",
      },
      null,
      2,
    ) + "\n",
  );
} else if (process.argv[2] === "finish") {
  const provenance = JSON.parse(readFileSync(provenancePath, "utf8"));
  const current = stamp();
  for (const key of Object.keys(current)) assert.deepEqual(current[key], provenance[key]);
  const traces = readdirSync(join(output, "traces"))
    .filter((name) => /^\d+\.jsonl$/.test(name))
    .flatMap((name) =>
      readFileSync(join(output, "traces", name), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    );
  const snapshots = [];
  const seen = new Set();
  for (const workspace of [
    "apps/web",
    "apps/server",
    "packages/contracts",
    "packages/shared",
    "scripts",
  ]) {
    const installed = resolve(workspace, "node_modules/typescript");
    if (!existsSync(installed)) continue;
    const actual = realpathSync(installed);
    if (seen.has(actual)) continue;
    seen.add(actual);
    const metadata = JSON.parse(readFileSync(join(actual, "package.json"), "utf8"));
    for (const name of ["typescript.js", "_tsc.js"]) {
      const source = join(actual, "lib", name);
      if (!existsSync(source)) continue;
      const bytes = readFileSync(source);
      const target = `compiler-${seen.size}-${name}`;
      copyFileSync(source, join(output, target));
      snapshots.push({
        workspace,
        path: source,
        packageVersion: metadata.version,
        file: target,
        bytes: bytes.length,
        sha256: sha256(bytes),
      });
    }
  }
  const starts = traces.filter((event) => event.event === "process-start");
  const exits = traces.filter((event) => event.event === "process-exit");
  const summary = {
    ...provenance,
    finishedAt: new Date().toISOString(),
    setupOutcome: process.env.SYNARA_PREREQ_SETUP_OUTCOME,
    patcherProcesses: starts,
    patcherExits: exits,
    compilerSnapshots: snapshots,
    emptyReads: traces.filter((event) => /readFile.*-end$/.test(event.event) && event.bytes === 0),
    observationComplete:
      starts.length > 0 &&
      starts.length === exits.length &&
      exits.every((event) => event.dropped === 0 && !event.reportedFailure),
  };
  writeFileSync(provenancePath, JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify(summary));
  assert.ok(
    summary.observationComplete,
    "The prerequisite observer did not record complete patcher lifetimes",
  );
} else {
  throw new Error("Use prepare or finish");
}
