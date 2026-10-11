import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const driver = dirname(fileURLToPath(import.meta.url));
const root = process.cwd();
const targets = JSON.parse(readFileSync(resolve(driver, "targets.json"), "utf8"));
const digest = (content) => createHash("sha256").update(content).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

if (!Array.isArray(targets) || targets.length < 1 || targets.length > 30) {
  throw new Error("Expected one to thirty explicit evidence targets.");
}
const ids = new Set();
for (const target of targets) {
  const native = target.mode === "native";
  const control = target.purpose === "regression-control";
  if (
    !/^pr\d+-(before|after|control)$/.test(target.id) ||
    ids.has(target.id) ||
    !/^[a-f0-9]{40}$/.test(target.source) ||
    (control ? target.variant !== "control" : !["before", "after"].includes(target.variant)) ||
    (target.purpose !== undefined && !control) ||
    (control &&
      (target.mode !== "standalone" ||
        !/^[a-f0-9]{40}$/.test(target.sourceTree) ||
        !/^[a-f0-9]{64}$/.test(target.fixtureSha256))) ||
    !target.id.endsWith(`-${target.variant}`) ||
    (!control &&
      (!Number.isInteger(target.expectedObservations) ||
        target.expectedObservations < 1 ||
        target.expectedObservations > 2)) ||
    !["standalone", "append-describe", "native"].includes(target.mode) ||
    (native
      ? target.fixture !== "native-ui" || target.destination !== "apps/web/e2e/evidence"
      : !/^[A-Za-z0-9.]+\.(tsx|ts)$/.test(target.fixture) ||
        !/^apps\/web\/src\/components\/[A-Za-z0-9.]+\.browser\.tsx$/.test(target.destination))
  ) {
    throw new Error(`Invalid evidence target ${JSON.stringify(target)}`);
  }
  ids.add(target.id);
}

const command = process.argv[2];
if (command === "matrix") {
  const matrix = JSON.stringify({
    include: targets.map(({ id, source, mode, purpose }) => ({
      id,
      source,
      kind: purpose === "regression-control" ? "control" : mode === "native" ? "native" : "web",
    })),
  });
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${matrix}\n`);
  else console.log(matrix);
} else if (command === "prepare") {
  const target = targets.find(({ id }) => id === process.env.PR_UI_EVIDENCE_ID);
  if (!target || target.source !== process.env.PR_UI_EVIDENCE_SOURCE) {
    throw new Error("The requested target must match the reviewed matrix.");
  }
  const source = git("rev-parse", "HEAD");
  if (source !== target.source) throw new Error(`Wrong source checkout: ${source}`);
  if (
    target.purpose === "regression-control" &&
    (git("rev-parse", "HEAD^{tree}") !== target.sourceTree || git("diff", "HEAD", "--name-only"))
  ) {
    throw new Error("The control requires the exact clean author source tree.");
  }
  const output = resolve(root, ".pr-ui-evidence-output", target.id);
  mkdirSync(output, { recursive: true });
  const destination = resolve(root, target.destination);
  const overlays = [];
  function assertUntracked(path) {
    try {
      execFileSync("git", ["ls-files", "--error-unmatch", path], {
        cwd: root,
        stdio: "ignore",
      });
      throw new Error(`Standalone evidence must not replace an application file: ${path}`);
    } catch (error) {
      if (error.status !== 1) throw error;
    }
  }
  if (target.mode === "native") {
    mkdirSync(destination, { recursive: true });
    const nativeRoot = resolve(driver, "fixtures", target.fixture);
    const names = readdirSync(nativeRoot).toSorted();
    if (
      names.length !== 5 ||
      names.some((name) => !/^[A-Za-z0-9]+\.(ts|tsx|mjs|cjs|html)$/.test(name))
    ) {
      throw new Error("Expected the five reviewed native fixture files.");
    }
    for (const name of names) {
      const path = `${target.destination}/${name}`;
      assertUntracked(path);
      copyFileSync(resolve(nativeRoot, name), resolve(root, path));
      overlays.push({
        path,
        originalSha256: null,
        sha256: digest(readFileSync(resolve(root, path))),
      });
    }
  } else {
    const fixture = readFileSync(resolve(driver, "fixtures", target.fixture), "utf8");
    if (target.purpose === "regression-control" && digest(fixture) !== target.fixtureSha256) {
      throw new Error("The control fixture does not match its reviewed hash.");
    }
    let original = null;
    if (target.mode === "append-describe") {
      original = readFileSync(destination, "utf8");
      if (!original.endsWith("\n});\n")) throw new Error("Unexpected outer describe boundary.");
      writeFileSync(destination, `${original.slice(0, -5)}\n${fixture}\n});\n`);
    } else {
      assertUntracked(target.destination);
      copyFileSync(resolve(driver, "fixtures", target.fixture), destination);
    }
    overlays.push({
      path: target.destination,
      originalSha256: original === null ? null : digest(original),
      fixtureSha256: digest(fixture),
      sha256: digest(readFileSync(destination)),
    });
    const config = "apps/web/vitest.pr-ui-evidence.config.ts";
    assertUntracked(config);
    copyFileSync(resolve(driver, "vitest.pr-ui-evidence.config.ts"), resolve(root, config));
    overlays.push({
      path: config,
      originalSha256: null,
      sha256: digest(readFileSync(resolve(root, config))),
    });
  }
  const manifest = {
    target,
    source,
    sourceTree: git("rev-parse", "HEAD^{tree}"),
    driver: execFileSync("git", ["rev-parse", "HEAD"], { cwd: driver, encoding: "utf8" }).trim(),
    overlays,
    status: "prepared",
    applicationCodeModified: false,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(resolve(output, "provenance.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const env = {
    VITE_PR_UI_EVIDENCE_VARIANT: target.variant,
    VITE_PR_UI_EVIDENCE_DIR: output,
    ...(target.mode === "native"
      ? { SYNARA_EVIDENCE_LABEL: target.id, SYNARA_EVIDENCE_OUTPUT: output }
      : { VITE_PR_UI_EVIDENCE_TEST: target.destination.replace("apps/web/", "") }),
  };
  if (!process.env.GITHUB_ENV) throw new Error("GITHUB_ENV is required for the isolated job.");
  for (const [key, value] of Object.entries(env)) {
    if (/[\r\n]/.test(value)) throw new Error("Invalid environment value.");
    appendFileSync(process.env.GITHUB_ENV, `${key}=${value}\n`);
  }
  console.log(JSON.stringify(manifest));
} else if (command === "verify") {
  const output = process.env.VITE_PR_UI_EVIDENCE_DIR;
  if (!output || !output.startsWith(`${resolve(root, ".pr-ui-evidence-output")}/`)) {
    throw new Error("Unexpected evidence directory.");
  }
  const manifestPath = resolve(output, "provenance.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (git("rev-parse", "HEAD") !== manifest.source)
    throw new Error("Source changed during capture.");
  const changed = git("diff", "HEAD", "--name-only").split("\n").filter(Boolean);
  const allowed = manifest.target.mode === "append-describe" ? [manifest.target.destination] : [];
  if (changed.some((path) => !allowed.includes(path))) {
    throw new Error(`Unexpected application modifications: ${changed.join(", ")}`);
  }
  for (const overlay of manifest.overlays) {
    if (digest(readFileSync(resolve(root, overlay.path))) !== overlay.sha256) {
      throw new Error(`The reviewed fixture changed during capture: ${overlay.path}`);
    }
  }
  const control = manifest.target.purpose === "regression-control";
  let controlResult;
  if (control) {
    const readExitCode = (name) => {
      const text = readFileSync(resolve(output, name), "utf8").trim();
      if (!/^\d+$/.test(text) || Number(text) > 255)
        throw new Error(`Invalid exit status: ${name}`);
      return Number(text);
    };
    controlResult = {
      testExitCode: readExitCode("vitest-exit-code.txt"),
      logExitCode: readExitCode("log-exit-code.txt"),
      testLogSha256: digest(readFileSync(resolve(output, "vitest.log"))),
      qualification:
        "Actual author-head regression result, not a Before/After screenshot or canonical CI.",
    };
  }
  const pngs = readdirSync(output).filter((name) => name.endsWith(".png"));
  if (!control && pngs.length === 0) throw new Error("The capture produced no PNG files.");
  const images = pngs.map((name) => {
    const content = readFileSync(resolve(output, name));
    if (content.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
      throw new Error(`Invalid PNG: ${name}`);
    }
    return { name, bytes: content.length, sha256: digest(content) };
  });
  const log = readFileSync(resolve(output, "vitest.log"), "utf8");
  const videos = [];
  const interaction = [];
  if (!control) {
    const videoNames = readdirSync(resolve(output, "video")).filter((name) =>
      name.endsWith(".webm"),
    );
    if (videoNames.length !== 1) throw new Error("Expected one actual UI interaction recording");
    const videoName = `video/${videoNames[0]}`;
    const videoBytes = readFileSync(resolve(output, videoName));
    if (videoBytes.subarray(0, 4).toString("hex") !== "1a45dfa3" || videoBytes.length < 1024)
      throw new Error("Invalid UI interaction video");
    videos.push({ name: videoName, bytes: videoBytes.length, sha256: digest(videoBytes) });
    const prefix = "PR_UI_INTERACTION_RESULT ";
    const observations = log.split("\n").filter((line) => line.includes(prefix));
    if (observations.length !== manifest.target.expectedObservations)
      throw new Error("Missing asserted UI interaction observations");
    for (const observation of observations) {
      const result = JSON.parse(
        observation
          .slice(observation.indexOf(prefix) + prefix.length)
          .replace(/\x1b\[[0-9;]*m/g, "")
          .trim(),
      );
      if (result.variant !== manifest.target.variant || result.pr !== manifest.target.pr)
        throw new Error("Wrong UI interaction source variant");
      interaction.push(result);
    }
    if (
      manifest.target.pr === 1809 &&
      (new Set(interaction.map((result) => result.resumeAfterRestart)).size !== 2 ||
        interaction.some((result) => typeof result.resumeAfterRestart !== "boolean"))
    )
      throw new Error("Both quit resume choices must be exercised");
  }
  const actualExitCode = controlResult
    ? controlResult.testExitCode || controlResult.logExitCode
    : 0;
  writeFileSync(
    manifestPath,
    `${JSON.stringify({ ...manifest, status: actualExitCode === 0 ? "completed" : "failed", ...(controlResult ? { controlResult } : {}), images, videos, interaction, logSha256: digest(log), completedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  console.log(
    JSON.stringify({
      source: manifest.source,
      ...(controlResult ? { controlResult } : {}),
      images,
      applicationCodeModified: false,
    }),
  );
  if (actualExitCode !== 0) process.exitCode = actualExitCode;
} else {
  throw new Error("Use matrix, prepare, or verify.");
}
