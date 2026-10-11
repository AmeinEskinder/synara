// Isolated utility driver. Production source and its startup assertions stay unchanged.
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { stripTypeScriptTypes } from "node:module";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [phase, sourceArgument, evidenceArgument] = process.argv.slice(2);
assert.ok(["prepare", "inspect", "verify"].includes(phase), "Unknown qualification phase");
assert.ok(sourceArgument && evidenceArgument, "Source and evidence paths are required");
const source = resolve(sourceArgument);
const evidence = resolve(evidenceArgument);
const driver = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const evidenceRelativePath = relative(source, evidence);
assert.ok(
  evidenceRelativePath === ".." || evidenceRelativePath.startsWith("../"),
  "Evidence must be outside the source",
);
mkdirSync(evidence, { recursive: true });
const assets = join(dirname(evidence), "deb-packages");
const packageName = "synara-desktop";
const installedExecutable = "/opt/Synara/synara";
const sourceSha = process.env.DEB_QUALIFICATION_SOURCE_SHA;
const driverSha = process.env.DEB_QUALIFICATION_DRIVER_SHA;
assert.match(sourceSha ?? "", /^[0-9a-f]{40}$/);
assert.match(driverSha ?? "", /^[0-9a-f]{40}$/);

function run(command, args, { log, timeout = 60_000, env = process.env, cwd = source } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout,
    killSignal: "SIGKILL",
    maxBuffer: 32 * 1024 * 1024,
    shell: false,
  });
  if (log) writeFileSync(join(evidence, log), `${result.stdout ?? ""}${result.stderr ?? ""}`);
  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} failed (exit=${result.status}): ${result.error?.message || result.stderr || result.stdout || "No output"}`,
    );
  }
  return result.stdout;
}

function save(name, value) {
  writeFileSync(join(evidence, name), `${JSON.stringify(value, null, 2)}\n`);
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function singleAsset(extension) {
  const files = readdirSync(assets).filter((file) => file.endsWith(extension));
  assert.equal(files.length, 1, `Expected one ${extension} artifact`);
  const path = join(assets, files[0]);
  assert.ok(statSync(path).isFile());
  return path;
}

function createInstalledStartupAdapter(helper) {
  const start = helper.indexOf("function prepareLinuxLaunch(\n");
  const end = helper.indexOf("function prepareWindowsLaunch(", start);
  assert.ok(start > 0 && end > start, "Canonical Linux launch adapter was not found");
  assert.equal(helper.indexOf("function prepareLinuxLaunch(\n", start + 1), -1);
  const replacement = `function prepareLinuxLaunch(
  _assetsDirectory: string,
  _extractionRoot: string,
  executableName: string,
): LaunchCommand {
  if (executableName !== "synara") throw new Error("Expected the production Debian executable.");
  const executable = ${JSON.stringify(installedExecutable)};
  if (!existsSync(executable)) throw new Error("The installed Debian executable is missing.");
  return {
    command: "xvfb-run",
    args: ["-a", executable, "--no-sandbox", "--disable-gpu"],
    cwd: dirname(executable),
    runtime: { executable, resourcesDirectory: join(dirname(executable), "resources") },
  };
}

`;
  // Preserve runtime imports, all three startup proofs, isolation, timeouts and
  // process-tree teardown byte-for-byte; only the package launch adapter differs.
  return helper.slice(0, start) + replacement + helper.slice(end);
}

async function qualify() {
  assert.equal(process.platform, "linux");
  assert.equal(process.arch, "x64");
  assert.equal(run("git", ["rev-parse", "HEAD"]).trim(), sourceSha);
  assert.equal(run("git", ["-C", driver, "rev-parse", "HEAD"]).trim(), driverSha);
  assert.equal(
    run("git", ["-C", driver, "status", "--porcelain=v1", "--untracked-files=all"]).trim(),
    "",
  );
  const version = JSON.parse(
    readFileSync(join(source, "apps/server/package.json"), "utf8"),
  ).version;
  // electron-builder's pinned LinuxTargetHelper sanitizes Debian package
  // versions this way; the embedded application keeps its original SemVer.
  const debianVersion = version.replace(/-/g, "~");
  const lockfileSha256 = await sha256(join(source, "bun.lock"));
  const canonicalPath = join(source, "scripts/verify-packaged-desktop-startup.ts");

  if (phase === "prepare") {
    assert.equal(run("git", ["status", "--porcelain=v1", "--untracked-files=all"]).trim(), "");
    const canonical = readFileSync(canonicalPath, "utf8");
    writeFileSync(join(evidence, "canonical-startup.ts"), canonical);
    const adapter = createInstalledStartupAdapter(canonical);
    writeFileSync(join(evidence, "installed-deb-startup.ts"), adapter);
    // Node's --check does not support TypeScript. Validate a type-stripped copy;
    // the actual startup still runs the retained TypeScript adapter unchanged.
    const syntaxPath = join(evidence, "installed-deb-startup.syntax.mjs");
    writeFileSync(syntaxPath, stripTypeScriptTypes(adapter, { mode: "strip" }));
    run(process.execPath, ["--check", syntaxPath]);
    save("provenance.json", {
      sourceSha,
      driverSha,
      version,
      debianVersion,
      lockfileSha256,
      sourceTree: run("git", ["rev-parse", "HEAD^{tree}"]).trim(),
      driverTree: run("git", ["-C", driver, "rev-parse", "HEAD^{tree}"]).trim(),
      driverScriptSha256: await sha256(fileURLToPath(import.meta.url)),
      driverWorkflowSha256: await sha256(join(driver, ".github/workflows/deb-qualification.yml")),
      canonicalStartupSha256: await sha256(canonicalPath),
      installedStartupAdapterSha256: await sha256(join(evidence, "installed-deb-startup.ts")),
      installedStartupSyntaxSha256: await sha256(syntaxPath),
      runner: { os: process.platform, arch: process.arch, node: process.version },
      limits:
        "Unsigned Linux x64 on Ubuntu 24.04; isolated startup uses Xvfb with --no-sandbox. Does not qualify sandbox policy, provider sessions, upgrades, every Debian distribution, signing or release publication.",
    });
    console.log(`Prepared qualification for source ${sourceSha}, driver ${driverSha}.`);
    return;
  }

  const provenance = JSON.parse(readFileSync(join(evidence, "provenance.json"), "utf8"));
  assert.equal(provenance.sourceSha, sourceSha);
  assert.equal(provenance.driverSha, driverSha);
  assert.equal(provenance.version, version);
  assert.equal(provenance.debianVersion, debianVersion);
  assert.equal(provenance.lockfileSha256, lockfileSha256);
  assert.equal(provenance.canonicalStartupSha256, await sha256(canonicalPath));
  assert.equal(
    provenance.installedStartupAdapterSha256,
    await sha256(join(evidence, "installed-deb-startup.ts")),
  );
  const deb = singleAsset(".deb");

  if (phase === "inspect") {
    const appImage = singleAsset(".AppImage");
    run("dpkg-deb", ["--info", deb], { log: "dpkg-info.txt" });
    run("dpkg-deb", ["--contents", deb], { log: "dpkg-contents.txt" });
    const fields = Object.fromEntries(
      ["Package", "Version", "Architecture", "Maintainer", "Homepage", "Depends"].map((field) => [
        field,
        run("dpkg-deb", ["--field", deb, field]).trim(),
      ]),
    );
    const payloads = await Promise.all(
      [deb, appImage].map(async (path) => ({
        file: basename(path),
        bytes: statSync(path).size,
        sha256: await sha256(path),
      })),
    );
    save("package-inventory.json", { fields, payloads });
    assert.equal(fields.Package, packageName);
    assert.equal(fields.Version, debianVersion);
    assert.equal(fields.Architecture, "amd64");
    assert.match(fields.Maintainer, /^.+ <[^<>\s]+@[^<>\s]+>$/);
    assert.equal(fields.Homepage, "https://github.com/Emanuele-web04/synara");
    assert.ok(fields.Depends.length > 0, "Debian runtime dependencies are absent");
    console.log("Actual AppImage and Debian metadata and SHA-256 inventory verified.");
    return;
  }

  assert.equal(
    process.env.GITHUB_ACTIONS,
    "true",
    "System installation requires a disposable Actions runner",
  );
  assert.equal(
    process.env.RUNNER_ENVIRONMENT,
    "github-hosted",
    "Refuse installation on a persistent runner",
  );
  const inventory = JSON.parse(readFileSync(join(evidence, "package-inventory.json"), "utf8"));
  assert.equal(
    inventory.payloads.find((file) => file.file === basename(deb))?.sha256,
    await sha256(deb),
  );
  assert.ok(!existsSync(installedExecutable), "Refuse to replace an existing Synara installation");
  run("sudo", ["apt-get", "install", "-y", "--no-install-recommends", deb], {
    log: "dpkg-install.log",
    timeout: 180_000,
    env: { ...process.env, DEBIAN_FRONTEND: "noninteractive" },
  });
  const status = run(
    "dpkg-query",
    ["--show", "--showformat=${Status}\n${Version}\n${Architecture}\n", packageName],
    { log: "dpkg-installed-status.txt" },
  );
  assert.equal(status.trim(), `install ok installed\n${debianVersion}\namd64`);
  const installedFiles = run("dpkg-query", ["--listfiles", packageName], {
    log: "dpkg-installed-files.txt",
  }).split("\n");
  assert.ok(installedFiles.includes(installedExecutable));
  assert.equal(realpathSync("/usr/bin/synara"), installedExecutable);
  assert.equal(run("dpkg", ["--verify", packageName], { log: "dpkg-verify.txt" }).trim(), "");
  const desktopFile = installedFiles.find((path) =>
    /^\/usr\/share\/applications\/[^/]+\.desktop$/.test(path),
  );
  assert.ok(desktopFile, "The Debian desktop entry was not installed");
  const desktopEntry = readFileSync(desktopFile, "utf8");
  writeFileSync(join(evidence, "installed-desktop-entry.txt"), desktopEntry);
  assert.match(desktopEntry, /^Type=Application$/m);
  assert.match(
    desktopEntry,
    /^Exec=(?:"\/opt\/Synara\/synara"|\/opt\/Synara\/synara|synara)(?:\s|$)/m,
  );

  const temporary = mkdtempSync(join(tmpdir(), "synara-deb-payload-"));
  try {
    run("dpkg-deb", ["--extract", deb, join(temporary, "payload")], { timeout: 120_000 });
    const installedAsar = join(dirname(installedExecutable), "resources/app.asar");
    const packageAsar = join(temporary, "payload", relative("/", installedAsar));
    assert.equal(await sha256(installedAsar), await sha256(packageAsar));
    const { createPackagedDesktopSmokeEnvironment } = await import(
      pathToFileURL(canonicalPath).href
    );
    const env = createPackagedDesktopSmokeEnvironment(join(temporary, "state"), {
      platform: "linux",
      version,
      executableName: "synara",
    });
    env.ELECTRON_RUN_AS_NODE = "1";
    delete env.NODE_OPTIONS;
    delete env.NODE_PATH;
    const packageJson = JSON.parse(
      run(
        installedExecutable,
        [
          "--eval",
          `process.stdout.write(require("node:fs").readFileSync(${JSON.stringify(join(installedAsar, "package.json"))}, "utf8"))`,
        ],
        { env },
      ),
    );
    save("installed-package-provenance.json", packageJson);
    assert.equal(packageJson.synaraCommitHash, sourceSha);
    assert.equal(packageJson.synaraLockfileSha256, lockfileSha256);
    assert.equal(packageJson.version, version);
    assert.equal(packageJson.synaraDesktopFlavor, "production");
    run(
      process.execPath,
      [
        join(evidence, "installed-deb-startup.ts"),
        "--assets-dir",
        assets,
        "--platform",
        "linux",
        "--arch",
        "x64",
        "--version",
        version,
      ],
      { log: "deb-startup.log", timeout: 180_000 },
    );
    save("installed-deb-result.json", {
      sourceSha,
      driverSha,
      package: basename(deb),
      installedExecutable,
      executableSha256: await sha256(installedExecutable),
      installedAsarSha256: await sha256(installedAsar),
      installedPackageMatchesDebianPayload: true,
      runtimeDependencySmoke: "passed",
      startupProofs: [
        "app ready",
        "bootstrap main window created",
        "bootstrap backend ready source=",
      ],
    });
    console.log(
      "Installed Debian payload, source provenance, runtime dependencies and canonical startup proofs passed.",
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

await qualify().catch((error) => {
  save(`${phase}-failure.json`, {
    sourceSha,
    driverSha,
    message: String(error),
    stack: error.stack,
  });
  console.error(error);
  process.exitCode = 1;
});
