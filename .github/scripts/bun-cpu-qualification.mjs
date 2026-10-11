import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const source = resolve(process.argv[2]);
const expectedSource = "45fc776f672acd83541069efaa6350145fe3ecef";
assert.equal(process.platform, "darwin");
assert.equal(process.arch, "arm64", "The named-x64 control must run on the opposite host CPU.");
assert.equal(
  execFileSync("git", ["rev-parse", "HEAD"], { cwd: source, encoding: "utf8" }).trim(),
  expectedSource,
);
assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: source, encoding: "utf8" }), "");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const inputs = Object.fromEntries(
  [
    "package.json",
    "bun.lock",
    "scripts/build-desktop-artifact.ts",
    "scripts/benchmark-cua-build.ts",
  ].map((path) => [path, hash(readFileSync(join(source, path)))]),
);
const packageManager = JSON.parse(
  readFileSync(join(source, "package.json"), "utf8"),
).packageManager;
assert.equal(packageManager, "bun@1.4.2");
const bunVersion = execFileSync("bun", ["--version"], { encoding: "utf8" }).trim();
assert.equal(bunVersion, packageManager.slice("bun@".length));
assert(
  readFileSync(join(source, "scripts/build-desktop-artifact.ts"), "utf8").includes(
    'const cpu = arch === "universal" ? "*" : arch;',
  ),
  "The observed feature must still use this exact wildcard mapping.",
);
const evidence = join(process.env.RUNNER_TEMP, "bun-cpu-evidence");
mkdirSync(evidence, { recursive: true });
const fixture = mkdtempSync(join(process.env.RUNNER_TEMP, "bun-cpu-fixture-"));
const report = {
  source: expectedSource,
  driver: process.env.GITHUB_SHA,
  platform: process.platform,
  hostArch: process.arch,
  bunVersion,
  inputs,
  purpose:
    "Pinned CLI optional dependency selection only; this is not a complete universal package build.",
  cases: [],
};
const save = () =>
  writeFileSync(join(evidence, "qualification.json"), JSON.stringify(report, null, 2) + "\n");
const manifest = {
  name: "synara-bun-cpu-qualification",
  private: true,
  version: "1.0.0",
  optionalDependencies: {
    "@esbuild/darwin-arm64": "0.28.1",
    "@esbuild/darwin-x64": "0.28.1",
  },
};
writeFileSync(join(fixture, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
save();
const run = (name, directory, args) => {
  const result = spawnSync("bun", args, { cwd: directory, encoding: "utf8", timeout: 90_000 });
  writeFileSync(join(evidence, `${name}.log`), `${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  assert.equal(
    result.status,
    0,
    `${name} failed: ${result.error ?? result.stderr ?? result.stdout}`,
  );
};
run("generate-fixture-lock", fixture, ["install", "--lockfile-only", "--ignore-scripts"]);
const lockBytes = readFileSync(join(fixture, "bun.lock"));
report.fixtureLockSha256 = hash(lockBytes);
copyFileSync(join(fixture, "package.json"), join(evidence, "fixture-package.json"));
copyFileSync(join(fixture, "bun.lock"), join(evidence, "fixture-bun.lock"));
for (const [name, cpu, expected] of [
  ["named-x64", "x64", ["x64"]],
  ["wildcard", "*", ["arm64", "x64"]],
]) {
  const directory = join(fixture, name);
  mkdirSync(directory);
  copyFileSync(join(fixture, "package.json"), join(directory, "package.json"));
  writeFileSync(join(directory, "bun.lock"), lockBytes);
  const args = [
    "install",
    "--frozen-lockfile",
    "--ignore-scripts",
    "--linker",
    "hoisted",
    `--cpu=${cpu}`,
  ];
  run(name, directory, args);
  assert.equal(
    hash(readFileSync(join(directory, "bun.lock"))),
    report.fixtureLockSha256,
    "The frozen fixture lock changed.",
  );
  const installed = [];
  for (const arch of ["arm64", "x64"]) {
    const packageDir = join(directory, "node_modules", "@esbuild", `darwin-${arch}`);
    if (!existsSync(packageDir)) continue;
    const pkg = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
    assert.equal(pkg.name, `@esbuild/darwin-${arch}`);
    assert.equal(pkg.version, "0.28.1");
    assert.deepEqual(pkg.cpu, [arch]);
    assert.deepEqual(pkg.os, ["darwin"]);
    const binary = readFileSync(join(packageDir, "bin", "esbuild"));
    assert(binary.length > 0, "An installed package must contain its actual native payload.");
    installed.push(arch);
    report.cases.push({ name, args, arch, binaryBytes: binary.length, binarySha256: hash(binary) });
  }
  save();
  assert.deepEqual(installed, expected, `${name} selected the wrong optional CPU packages.`);
}
for (const [path, expected] of Object.entries(inputs))
  assert.equal(hash(readFileSync(join(source, path))), expected);
assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: source, encoding: "utf8" }), "");
report.success = true;
save();
console.log(JSON.stringify(report, null, 2));
