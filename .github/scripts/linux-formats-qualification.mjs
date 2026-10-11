// Isolated utility driver. Production source and its startup assertions stay unchanged.
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { stripTypeScriptTypes } from "node:module";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertRpmInstallIntegrity } from "./rpm-install-integrity.mjs";

const [phase, sourceArgument, evidenceArgument] = process.argv.slice(2);
assert.ok(
  ["prepare", "inspect", "verify-deb", "verify-rpm"].includes(phase),
  "Unknown qualification phase",
);
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
const assets = join(dirname(evidence), "linux-formats-packages");
const packageName = "synara-desktop";
const installedExecutable = "/opt/Synara/synara";
const sourceSha = process.env.LINUX_FORMATS_QUALIFICATION_SOURCE_SHA;
const driverSha = process.env.LINUX_FORMATS_QUALIFICATION_DRIVER_SHA;
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
  const end = helper.indexOf("\n}\n\n", start) + 4;
  assert.ok(start > 0 && end > start, "Canonical Linux launch adapter was not found");
  assert.equal(helper.indexOf("function prepareLinuxLaunch(\n", start + 1), -1);
  const replacement = `function prepareLinuxLaunch(
  _assetsDirectory: string,
  _extractionRoot: string,
  executableName: string,
): LaunchCommand {
  if (executableName !== "synara") throw new Error("Expected the production Linux executable.");
  const executable = ${JSON.stringify(installedExecutable)};
  if (!existsSync(executable)) throw new Error("The installed Linux executable is missing.");
  return {
    command: "xvfb-run",
    args: ["-a", executable, "--no-sandbox", "--disable-gpu"],
    cwd: dirname(executable),
    runtime: { executable, resourcesDirectory: join(dirname(executable), "resources") },
  };
}

`;
  // Preserve all three startup proofs, isolation, timeouts and process-tree
  // teardown; only the package launch adapter and import locations differ.
  let adapter = helper.slice(0, start) + replacement + helper.slice(end);
  // This retained adapter lives outside the checkout. Resolve only these exact
  // new source imports to their immutable repository locations; their code and
  // every canonical startup assertion remain unchanged.
  const sharedManifest = JSON.parse(
    readFileSync(join(source, "packages/shared/package.json"), "utf8"),
  );
  assert.equal(sharedManifest.exports["./desktopIdentity"].import, "./src/desktopIdentity.ts");
  const imports = [
    ["@synara/shared/desktopIdentity", join(source, "packages/shared/src/desktopIdentity.ts")],
    [
      "./lib/desktop-artifact-identity.ts",
      join(source, "scripts/lib/desktop-artifact-identity.ts"),
    ],
    ["./lib/linux-package-targets.ts", join(source, "scripts/lib/linux-package-targets.ts")],
    ["./lib/linux-package-archive.ts", join(source, "scripts/lib/linux-package-archive.ts")],
  ];
  for (const [specifier, target] of imports) {
    const quoted = JSON.stringify(specifier);
    assert.equal(adapter.split(quoted).length, 2, "Expected one canonical import: " + specifier);
    assert.ok(existsSync(target));
    adapter = adapter.replace(quoted, JSON.stringify(pathToFileURL(target).href));
  }
  return adapter;
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
  assert.equal(run("git", ["diff", "--exit-code", "HEAD", "--"]).trim(), "");
  const version = JSON.parse(
    readFileSync(join(source, "apps/server/package.json"), "utf8"),
  ).version;
  // electron-builder's pinned LinuxTargetHelper sanitizes Debian and RPM
  // versions this way; the embedded application keeps its original SemVer.
  const debianVersion = version.replace(/-/g, "~");
  const lockfileSha256 = await sha256(join(source, "bun.lock"));
  const canonicalPath = join(source, "scripts/verify-packaged-desktop-startup.ts");

  if (phase === "prepare") {
    assert.equal(run("git", ["status", "--porcelain=v1", "--untracked-files=all"]).trim(), "");
    const canonical = readFileSync(canonicalPath, "utf8");
    writeFileSync(join(evidence, "canonical-startup.ts"), canonical);
    const adapter = createInstalledStartupAdapter(canonical);
    writeFileSync(join(evidence, "installed-linux-startup.ts"), adapter);
    // Node's --check does not support TypeScript. Validate a type-stripped copy;
    // the actual startup still runs the retained TypeScript adapter unchanged.
    const syntaxPath = join(evidence, "installed-linux-startup.syntax.mjs");
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
      rpmIntegrityScriptSha256: await sha256(
        join(driver, ".github/scripts/rpm-install-integrity.mjs"),
      ),
      rpmIntegrityTestSha256: await sha256(
        join(driver, ".github/scripts/rpm-install-integrity.test.mjs"),
      ),
      driverWorkflowSha256: await sha256(
        join(driver, ".github/workflows/linux-formats-qualification.yml"),
      ),
      canonicalStartupSha256: await sha256(canonicalPath),
      installedStartupAdapterSha256: await sha256(join(evidence, "installed-linux-startup.ts")),
      installedStartupSyntaxSha256: await sha256(syntaxPath),
      runner: { os: process.platform, arch: process.arch, node: process.version },
      limits:
        "Unsigned Linux x64; Ubuntu 24.04 packaging/Debian install and disposable Fedora 43 container RPM install. Isolated startup uses Xvfb with --no-sandbox. Does not qualify sandbox policy, provider sessions, upgrades, simultaneous Stable/Beta package installation, graphical desktop-menu launch, every distribution, signing or release publication.",
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
    provenance.rpmIntegrityScriptSha256,
    await sha256(join(driver, ".github/scripts/rpm-install-integrity.mjs")),
  );
  assert.equal(
    provenance.installedStartupAdapterSha256,
    await sha256(join(evidence, "installed-linux-startup.ts")),
  );
  const deb = singleAsset(".deb");
  const rpm = singleAsset(".rpm");

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
      [deb, rpm, appImage].map(async (path) => ({
        file: basename(path),
        bytes: statSync(path).size,
        sha256: await sha256(path),
      })),
    );
    const rpmFields = Object.fromEntries(
      ["NAME", "VERSION", "ARCH", "PACKAGER", "URL", "VENDOR"].map((field) => [
        field,
        run("rpm", ["--query", "--package", "--queryformat", `%{${field}}`, rpm]).trim(),
      ]),
    );
    const rpmDependencies = run("rpm", ["--query", "--package", "--requires", rpm], {
      log: "rpm-requires.txt",
    });
    run("rpm", ["--query", "--package", "--list", rpm], { log: "rpm-contents.txt" });
    run(
      "rpm",
      [
        "--query",
        "--package",
        "--queryformat",
        "[%{FILENAMES}\t%{FILEMODES:octal}\t%{FILELINKTOS}\n]",
        rpm,
      ],
      { log: "rpm-archive-modes-and-link-targets.txt" },
    );
    run("rpm", ["--query", "--package", "--scripts", rpm], { log: "rpm-scripts.txt" });
    save("package-inventory.json", { fields, rpmFields, payloads });
    assert.equal(fields.Package, packageName);
    assert.equal(fields.Version, debianVersion);
    assert.equal(fields.Architecture, "amd64");
    assert.match(fields.Maintainer, /^.+ <[^<>\s]+@[^<>\s]+>$/);
    assert.equal(fields.Maintainer, "Emanuele Di Pietro <feedback@trysynara.com>");
    assert.equal(fields.Homepage, "https://www.trysynara.com");
    assert.ok(fields.Depends.length > 0, "Debian runtime dependencies are absent");
    assert.equal(rpmFields.NAME, packageName);
    assert.equal(rpmFields.VERSION, debianVersion);
    assert.equal(rpmFields.ARCH, "x86_64");
    assert.equal(rpmFields.PACKAGER, "Emanuele Di Pietro <feedback@trysynara.com>");
    assert.equal(rpmFields.URL, "https://www.trysynara.com");
    assert.ok(rpmDependencies.trim().length > 0, "RPM runtime dependencies are absent");
    const temporary = mkdtempSync(join(tmpdir(), "synara-appimage-identity-"));
    try {
      const copied = join(temporary, basename(appImage));
      copyFileSync(appImage, copied);
      chmodSync(copied, 0o755);
      run(copied, ["--appimage-extract"], {
        cwd: temporary,
        log: "appimage-extraction.txt",
        timeout: 120_000,
      });
      const application = join(temporary, "squashfs-root");
      const executable = join(application, "synara");
      const asar = join(application, "resources/app.asar");
      const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
      delete env.NODE_OPTIONS;
      delete env.NODE_PATH;
      const embedded = JSON.parse(
        run(
          executable,
          [
            "--eval",
            `process.stdout.write(require("node:fs").readFileSync(${JSON.stringify(join(asar, "package.json"))}, "utf8"))`,
          ],
          { env, cwd: application },
        ),
      );
      save("appimage-embedded-package.json", embedded);
      assert.equal(embedded.synaraCommitHash, sourceSha);
      assert.equal(embedded.synaraLockfileSha256, lockfileSha256);
      assert.equal(embedded.version, version);
      assert.equal(embedded.synaraDesktopFlavor, "production");
      save("appimage-payload-identity.json", {
        sourceSha,
        lockfileSha256,
        version,
        asarSha256: await sha256(asar),
        executableSha256: await sha256(executable),
      });
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
    console.log("Actual AppImage, Debian and RPM metadata and SHA-256 inventory verified.");
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
  const isRpm = phase === "verify-rpm";
  if (isRpm) {
    assert.ok(
      existsSync("/.dockerenv"),
      "RPM installation requires the disposable Docker container",
    );
    assert.equal(process.getuid(), 0, "RPM qualification runs as container root only");
    const osRelease = readFileSync("/etc/os-release", "utf8");
    assert.match(osRelease, /^ID=fedora$/m);
    assert.match(osRelease, /^VERSION_ID=43$/m);
    writeFileSync(join(evidence, "rpm-os-release.txt"), osRelease);
  } else {
    assert.ok(
      !existsSync("/.dockerenv"),
      "Debian installation requires the disposable Ubuntu host",
    );
    const osRelease = readFileSync("/etc/os-release", "utf8");
    assert.match(osRelease, /^ID=ubuntu$/m);
    assert.match(osRelease, /^VERSION_ID="24\.04"$/m);
    writeFileSync(join(evidence, "deb-os-release.txt"), osRelease);
  }
  const format = isRpm ? "rpm" : "deb";
  const selectedPackage = isRpm ? rpm : deb;
  const inventory = JSON.parse(readFileSync(join(evidence, "package-inventory.json"), "utf8"));
  assert.equal(
    inventory.payloads.find((file) => file.file === basename(selectedPackage))?.sha256,
    await sha256(selectedPackage),
  );
  assert.ok(!existsSync(installedExecutable), "Refuse to replace an existing Synara installation");
  if (isRpm) {
    run("dnf", ["install", "-y", selectedPackage], { log: "rpm-install.log", timeout: 300_000 });
  } else {
    run("sudo", ["apt-get", "install", "-y", "--no-install-recommends", deb], {
      log: "dpkg-install.log",
      timeout: 180_000,
      env: { ...process.env, DEBIAN_FRONTEND: "noninteractive" },
    });
  }
  const status = isRpm
    ? run("rpm", ["--query", "--queryformat", "%{NAME}\n%{VERSION}\n%{ARCH}\n", packageName], {
        log: "rpm-installed-status.txt",
      })
    : run(
        "dpkg-query",
        ["--show", "--showformat=${Status}\n${Version}\n${Architecture}\n", packageName],
        { log: "dpkg-installed-status.txt" },
      );
  assert.equal(
    status.trim(),
    isRpm
      ? `${packageName}\n${debianVersion}\nx86_64`
      : `install ok installed\n${debianVersion}\namd64`,
  );
  const installedFiles = (
    isRpm
      ? run("rpm", ["--query", "--list", packageName], { log: "rpm-installed-files.txt" })
      : run("dpkg-query", ["--listfiles", packageName], { log: "dpkg-installed-files.txt" })
  ).split("\n");
  assert.ok(installedFiles.includes(installedExecutable));
  assert.equal(realpathSync("/usr/bin/synara"), installedExecutable);
  if (isRpm) {
    const sandboxPath = "/opt/Synara/chrome-sandbox";
    const modes = run(
      "rpm",
      ["--query", "--queryformat", "[%{FILENAMES}\t%{FILEMODES:octal}\n]", packageName],
      { log: "rpm-installed-modes.txt" },
    )
      .trim()
      .split("\n")
      .map((line) => line.split("\t"));
    const sandboxModes = modes.filter(([path]) => path === sandboxPath);
    assert.equal(sandboxModes.length, 1);
    assert.match(sandboxModes[0][1], /^[0-7]+$/);
    const sandbox = lstatSync(sandboxPath);
    const installedScript = run("rpm", ["--query", "--scripts", packageName], {
      log: "rpm-installed-scripts.txt",
    });
    let hasUserNamespaceLink = false;
    try {
      hasUserNamespaceLink = lstatSync("/proc/self/ns/user").isSymbolicLink();
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const probe = hasUserNamespaceLink
      ? spawnSync("unshare", ["--user", "true"], { encoding: "utf8", timeout: 10_000, shell: false })
      : null;
    const raw = spawnSync("rpm", ["--verify", packageName], {
      encoding: "utf8",
      timeout: 60_000,
      shell: false,
    });
    const verification = {
      status: raw.status,
      stdout: raw.stdout ?? "",
      stderr: raw.stderr ?? "",
      error: raw.error?.message ?? null,
    };
    writeFileSync(join(evidence, "rpm-verify.txt"), verification.stdout + verification.stderr);
    const namespaces = {
      hasUserNamespaceLink,
      status: probe?.status ?? null,
      error: probe?.error?.message ?? null,
    };
    const result = assertRpmInstallIntegrity({
      verification,
      installedScript,
      sandbox: {
        path: sandboxPath,
        regularFile: sandbox.isFile(),
        uid: sandbox.uid,
        gid: sandbox.gid,
        archiveMode: Number.parseInt(sandboxModes[0][1], 8),
        permissions: sandbox.mode & 0o7777,
      },
      namespaces,
    });
    save("rpm-install-integrity.json", {
      sourceSha,
      driverSha,
      result,
      verification,
      namespaces,
      namespaceStdout: probe?.stdout ?? "",
      namespaceStderr: probe?.stderr ?? "",
      installedScriptSha256: createHash("sha256").update(installedScript).digest("hex"),
    });
  } else {
    assert.equal(run("dpkg", ["--verify", packageName], { log: "dpkg-verify.txt" }).trim(), "");
  }
  const desktopFile = installedFiles.find((path) =>
    /^\/usr\/share\/applications\/[^/]+\.desktop$/.test(path),
  );
  assert.ok(desktopFile, "The package desktop entry was not installed");
  const desktopEntry = readFileSync(desktopFile, "utf8");
  writeFileSync(join(evidence, `${format}-installed-desktop-entry.txt`), desktopEntry);
  assert.match(desktopEntry, /^Type=Application$/m);
  assert.match(
    desktopEntry,
    /^Exec=(?:"\/opt\/Synara\/synara"|\/opt\/Synara\/synara|synara)(?:\s|$)/m,
  );

  const temporary = mkdtempSync(join(tmpdir(), "synara-linux-installed-"));
  try {
    const installedAsar = join(dirname(installedExecutable), "resources/app.asar");
    const appImageIdentity = JSON.parse(
      readFileSync(join(evidence, "appimage-payload-identity.json"), "utf8"),
    );
    assert.equal(appImageIdentity.sourceSha, sourceSha);
    assert.equal(appImageIdentity.lockfileSha256, lockfileSha256);
    assert.equal(appImageIdentity.version, version);
    assert.equal(await sha256(installedAsar), appImageIdentity.asarSha256);
    assert.equal(await sha256(installedExecutable), appImageIdentity.executableSha256);
    if (!isRpm) {
      run("dpkg-deb", ["--extract", deb, join(temporary, "payload")], { timeout: 120_000 });
      const packageAsar = join(temporary, "payload", relative("/", installedAsar));
      assert.equal(await sha256(installedAsar), await sha256(packageAsar));
      save("shared-installed-payload.json", {
        sourceSha,
        installedAsarSha256: await sha256(installedAsar),
      });
    } else {
      // The independently verified Debian payload is from the same one-pass
      // staged build. Require the actual RPM installation to contain its bytes.
      const shared = JSON.parse(
        readFileSync(join(evidence, "shared-installed-payload.json"), "utf8"),
      );
      assert.equal(shared.sourceSha, sourceSha);
      assert.equal(await sha256(installedAsar), shared.installedAsarSha256);
    }
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
    save(`${format}-installed-package-provenance.json`, packageJson);
    assert.equal(packageJson.synaraCommitHash, sourceSha);
    assert.equal(packageJson.synaraLockfileSha256, lockfileSha256);
    assert.equal(packageJson.version, version);
    assert.equal(packageJson.synaraDesktopFlavor, "production");
    run(
      process.execPath,
      [
        join(evidence, "installed-linux-startup.ts"),
        "--assets-dir",
        assets,
        "--platform",
        "linux",
        "--arch",
        "x64",
        "--version",
        version,
      ],
      { log: `${format}-startup.log`, timeout: 180_000 },
    );
    const executableSha256 = await sha256(installedExecutable);
    const installedAsarSha256 = await sha256(installedAsar);
    const dataHomes = [".synara", ".synara-beta"].map((name) => join(homedir(), name));
    const dataMarker = format + " removal qualification data: " + sourceSha + "\n";
    for (const home of dataHomes) {
      assert.ok(!existsSync(home), "Refuse to replace an existing application data home");
      mkdirSync(home);
      writeFileSync(join(home, "qualification-data.txt"), dataMarker);
    }
    if (isRpm) {
      run("dnf", ["remove", "-y", packageName], { log: "rpm-remove.log", timeout: 180_000 });
    } else {
      run("sudo", ["apt-get", "remove", "-y", packageName], {
        log: "dpkg-remove.log",
        timeout: 180_000,
        env: { ...process.env, DEBIAN_FRONTEND: "noninteractive" },
      });
    }
    assert.ok(!existsSync(installedExecutable), "Package removal left the application executable");
    assert.ok(!existsSync("/usr/bin/synara"), "Package removal left the executable registration");
    for (const home of dataHomes) {
      assert.equal(readFileSync(join(home, "qualification-data.txt"), "utf8"), dataMarker);
    }
    save(`${format}-removal-data-preservation.json`, {
      packageName,
      applicationRemoved: true,
      dataHomesPreserved: dataHomes,
      markerSha256: createHash("sha256").update(dataMarker).digest("hex"),
      boundary:
        "Actual removal of the installed production package. Beta data sentinel retained; no Beta package coexistence or upgrade claim.",
    });
    save(`installed-${format}-result.json`, {
      sourceSha,
      driverSha,
      package: basename(selectedPackage),
      installedExecutable,
      executableSha256,
      installedAsarSha256,
      installedAsarMatchesAppImageAndVerifiedDebianPayload: true,
      installedExecutableMatchesAppImage: true,
      runtimeDependencySmoke: "passed",
      startupProofs: [
        "app ready",
        "bootstrap main window created",
        "bootstrap backend ready source=",
      ],
    });
    console.log(
      "Installed Linux payload, source provenance, runtime dependencies and canonical startup proofs passed.",
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
