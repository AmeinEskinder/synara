import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.cwd();
const driver = dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(readFileSync(resolve(driver, "observer.json"), "utf8"));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const command = process.argv[2];

if (command === "prepare") {
  const mode = process.env.PR_TAB_DIAGNOSTIC_MODE;
  if (!["focused", "lane", "cache-hold"].includes(mode))
    throw new Error("Unknown diagnostic mode.");
  if (
    git("rev-parse", "HEAD") !== spec.source ||
    git("rev-parse", "HEAD^{tree}") !== spec.sourceTree
  )
    throw new Error("Wrong immutable application source.");
  if (git("diff", "HEAD", "--name-only")) throw new Error("Application source is not clean.");
  const original = readFileSync(resolve(root, spec.path), "utf8");
  if (
    digest(original) !== spec.sourceSha256 ||
    git("rev-parse", `HEAD:${spec.path}`) !== spec.sourceBlob
  )
    throw new Error("The original test does not match the failing source.");
  const start = original.indexOf(spec.start);
  const end = original.indexOf(spec.end, start + spec.start.length);
  if (start < 0 || end < start || original.indexOf(spec.start, start + 1) !== -1)
    throw new Error("Unknown exact test boundary.");
  let observed = original.slice(start, end);
  const replacements = [
    ...spec.replacements,
    ...(mode === "cache-hold" ? spec.fixtureReplacements : []),
  ];
  for (const { before, after } of replacements) {
    if (!after.includes(before) || observed.split(before).length !== 2)
      throw new Error("Observer must only add text at one exact original statement.");
    observed = observed.replace(before, after);
  }
  const instrumented = original.slice(0, start) + observed + original.slice(end);
  writeFileSync(resolve(root, spec.path), instrumented);
  const output = resolve(root, ".pr-tab-diagnostic-output", mode);
  mkdirSync(output, { recursive: true });
  writeFileSync(
    resolve(output, "test-observer.patch"),
    execFileSync("git", ["diff", "--", spec.path], { cwd: root }),
  );
  const manifest = {
    source: spec.source,
    sourceTree: spec.sourceTree,
    test: spec.path,
    originalBlob: spec.sourceBlob,
    originalSha256: spec.sourceSha256,
    observedSha256: digest(instrumented),
    observerSha256: digest(readFileSync(resolve(driver, "observer.json"))),
    driver: execFileSync("git", ["rev-parse", "HEAD"], { cwd: driver, encoding: "utf8" }).trim(),
    mode,
    productionCodeModified: false,
    originalAssertionsPreserved: true,
    originalRoundsAndWaitsPreserved: true,
    controlledCacheFixture: mode === "cache-hold",
    qualification:
      mode === "cache-hold"
        ? "Controlled diagnostic fixture: seed the target durable cache and hold its authoritative snapshot until a retained read-only cached editor is observed, or a 2-second fallback deadline. Original zero-frame and draft/undo assertions remain; their actual exit is preserved. No production repair or canonical-CI claim."
        : "Diagnostic observer only. Exact original test and canonical project configuration; no production repair or flake classification.",
    status: "prepared",
  };
  writeFileSync(resolve(output, "provenance.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  if (!process.env.GITHUB_ENV) throw new Error("GITHUB_ENV is required.");
  appendFileSync(process.env.GITHUB_ENV, `PR_TAB_DIAGNOSTIC_DIR=${output}\n`);
  console.log(JSON.stringify(manifest));
} else if (command === "verify") {
  const output = process.env.PR_TAB_DIAGNOSTIC_DIR;
  if (!output || !output.startsWith(`${resolve(root, ".pr-tab-diagnostic-output")}/`))
    throw new Error("No prepared diagnostic output.");
  const manifestPath = resolve(output, "provenance.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (
    git("rev-parse", "HEAD") !== spec.source ||
    git("rev-parse", "HEAD^{tree}") !== spec.sourceTree
  )
    throw new Error("Application source changed.");
  if (git("diff", "HEAD", "--name-only") !== spec.path)
    throw new Error("Only the exact reviewed test observer may change tracked source.");
  if (digest(readFileSync(resolve(root, spec.path))) !== manifest.observedSha256)
    throw new Error("Test observer changed during execution.");
  const readExit = (name) => {
    const value = readFileSync(resolve(output, name), "utf8").trim();
    if (!/^\d+$/.test(value) || Number(value) > 255) throw new Error(`Invalid exit code: ${name}`);
    return Number(value);
  };
  const testExitCode = readExit("vitest-exit-code.txt");
  const logExitCode = readExit("log-exit-code.txt");
  const log = readFileSync(resolve(output, "vitest.log"), "utf8");
  const prefix = "TAB_FRAME_DIAGNOSTIC ";
  const observations = log
    .split("\n")
    .filter((line) => line.includes(prefix))
    .map((line) =>
      JSON.parse(
        line
          .slice(line.indexOf(prefix) + prefix.length)
          .replace(/\x1b\[[0-9;]*m/g, "")
          .trim(),
      ),
    );
  if (observations.some((observation) => observation.source !== spec.source))
    throw new Error("Wrong source observation.");
  const screenshots = [];
  const screenshotRoot = resolve(
    root,
    "apps/web/src/components/__screenshots__/ChatView.browser.tsx",
  );
  if (existsSync(screenshotRoot)) {
    for (const name of readdirSync(screenshotRoot).filter((name) => name.endsWith(".png"))) {
      const bytes = readFileSync(resolve(screenshotRoot, name));
      if (bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a")
        throw new Error("Invalid screenshot PNG.");
      mkdirSync(resolve(output, "screenshots"), { recursive: true });
      copyFileSync(resolve(screenshotRoot, name), resolve(output, "screenshots", name));
      screenshots.push({ path: `screenshots/${name}`, bytes: bytes.length, sha256: digest(bytes) });
    }
  }
  const status = testExitCode || logExitCode ? "failed" : "completed";
  const result = {
    ...manifest,
    status,
    testExitCode,
    logExitCode,
    logSha256: digest(log),
    observations,
    screenshots,
  };
  writeFileSync(manifestPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result));
  if (testExitCode || logExitCode) process.exitCode = testExitCode || logExitCode;
  else if (observations.length !== 1)
    throw new Error("Expected the original target's one complete diagnostic receipt.");
} else {
  throw new Error("Use prepare or verify.");
}
