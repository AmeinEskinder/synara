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

const driver = dirname(fileURLToPath(import.meta.url));
const root = process.cwd();
const targets = JSON.parse(readFileSync(resolve(driver, "targets.json"), "utf8"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const modes = ["no-preference"];
if (
  targets.length !== 2 ||
  new Set(targets.map(({ id }) => id)).size !== 2 ||
  targets.some(
    (target) =>
      !/^pr1826-(before|after)$/.test(target.id) ||
      !target.id.endsWith(`-${target.variant}`) ||
      !/^[a-f0-9]{40}$/.test(target.source) ||
      !/^[a-f0-9]{40}$/.test(target.tree),
  )
)
  throw new Error("Expected two explicit reviewed typography sources.");

function assertSource(target) {
  if (
    git("rev-parse", "HEAD") !== target.source ||
    git("rev-parse", "HEAD^{tree}") !== target.tree ||
    git("diff", "HEAD", "--name-only")
  ) {
    throw new Error("The application must remain at the exact clean reviewed source tree.");
  }
}

const command = process.argv[2];
if (command === "matrix") {
  const matrix = JSON.stringify({ include: targets });
  if (!process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is required.");
  appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${matrix}\n`);
} else if (command === "prepare") {
  const target = targets.find(({ id }) => id === process.env.PR_TYPOGRAPHY_TARGET);
  if (!target || target.source !== process.env.PR_TYPOGRAPHY_SOURCE)
    throw new Error("Unexpected target.");
  assertSource(target);
  const output = resolve(root, ".pr-typography-evidence", target.id);
  mkdirSync(output, { recursive: true });
  const overlays = [
    ["fixtures/PrUiEvidence175.browser.tsx", "apps/web/src/components/PrUiEvidence175.browser.tsx"],
    ["vitest.pr-typography-evidence.config.ts", "apps/web/vitest.pr-typography-evidence.config.ts"],
  ].map(([file, destination]) => {
    if (git("ls-files", "--", destination)) throw new Error(`Refusing to replace ${destination}`);
    copyFileSync(resolve(driver, file), resolve(root, destination));
    return { path: destination, sha256: hash(readFileSync(resolve(root, destination))) };
  });
  const sourceFiles = [
    "apps/web/src/components/ChatMarkdown.tsx",
    "apps/web/src/components/ChatMarkdown.test.tsx",
    "apps/web/src/components/chat/AgentActivityDetailView.tsx",
    "apps/web/src/components/chat/TimelineWorkEntryRow.tsx",
    "apps/web/src/components/chat/MessagesTimeline.tsx",
    "apps/web/src/components/chat/chatTypography.ts",
    "apps/web/src/hooks/useTheme.ts",
    "apps/web/src/index.css",
  ].map((path) => ({
    path,
    blob: git("rev-parse", `HEAD:${path}`),
    sha256: hash(readFileSync(resolve(root, path))),
  }));
  const manifest = {
    target,
    source: target.source,
    sourceTree: target.tree,
    driver: execFileSync("git", ["rev-parse", "HEAD"], { cwd: driver, encoding: "utf8" }).trim(),
    sourceFiles,
    overlays,
    status: "prepared",
    applicationCodeModified: false,
    qualification:
      "Actual production ChatMarkdown, syntax highlighting, AgentActivityDetailView and useTheme with controlled sample content and explicit RTL container. Both themes at 980/390px; no native desktop or live provider claim.",
  };
  writeFileSync(resolve(output, "provenance.json"), JSON.stringify(manifest, null, 2) + "\n");
  if (!process.env.GITHUB_ENV) throw new Error("GITHUB_ENV is required.");
  appendFileSync(
    process.env.GITHUB_ENV,
    `VITE_PR_UI_EVIDENCE_VARIANT=${target.variant}\nVITE_PR_UI_EVIDENCE_DIR=${output}\n`,
  );
  console.log(JSON.stringify(manifest));
} else if (command === "verify") {
  const output = process.env.VITE_PR_UI_EVIDENCE_DIR;
  if (!output?.startsWith(resolve(root, ".pr-typography-evidence") + "/"))
    throw new Error("Unexpected output.");
  const manifestPath = resolve(output, "provenance.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assertSource(manifest.target);
  for (const entry of [...manifest.overlays, ...manifest.sourceFiles]) {
    if (hash(readFileSync(resolve(root, entry.path))) !== entry.sha256)
      throw new Error(`Changed file ${entry.path}`);
  }
  const files = [];
  const observations = [];
  let actualExitCode = 0;
  for (const motion of modes) {
    const exits = JSON.parse(readFileSync(resolve(output, `${motion}-exits.json`), "utf8"));
    if (Object.keys(exits).toSorted().join(",") !== "tee,vitest" || Object.values(exits).some((value) => !Number.isInteger(value) || value < 0 || value > 255))
      throw new Error("Invalid recorded status.");
    actualExitCode ||= exits.vitest || exits.tee;
    const log = readFileSync(resolve(output, `${motion}.log`), "utf8");
    const prefix = "PR_TYPOGRAPHY_RESULT ";
    const emitted = log
      .split("\n")
      .filter((line) => line.includes(prefix))
      .map((line) =>
        line
          .slice(line.indexOf(prefix) + prefix.length)
          .replace(/\x1b\[[0-9;]*m/g, "")
          .trim(),
      )
      .filter((payload) => payload.startsWith("{"))
      .map((payload) => JSON.parse(payload));
    if (
      exits.vitest === 0 &&
      (emitted.length !== 1 ||
        emitted[0].variant !== manifest.target.variant ||
        emitted[0].cases.length !== 4 ||
        emitted[0].screenshots.length !== 20)
    )
      throw new Error("Missing asserted UI receipt.");
    observations.push({ motion, exits, logSha256: hash(log), observations: emitted });
    const videoDirectory = resolve(output, `video-${motion}`);
    const videos = existsSync(videoDirectory)
      ? readdirSync(videoDirectory).filter((name) => name.endsWith(".webm"))
      : [];
    if (exits.vitest === 0 && videos.length !== 1)
      throw new Error("Expected one context recording.");
    for (const name of videos) {
      const path = `video-${motion}/${name}`;
      const bytes = readFileSync(resolve(output, path));
      if (bytes.subarray(0, 4).toString("hex") !== "1a45dfa3") throw new Error("Invalid WebM.");
      files.push({ path, bytes: bytes.length, sha256: hash(bytes) });
    }
  }
  const pngs = readdirSync(output).filter((name) => name.endsWith(".png"));
  if (actualExitCode === 0 && pngs.length !== 20)
    throw new Error("Expected all twenty typography screenshots.");
  for (const path of pngs) {
    const bytes = readFileSync(resolve(output, path));
    if (bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a")
      throw new Error("Invalid PNG.");
    files.push({ path, bytes: bytes.length, sha256: hash(bytes) });
  }
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        ...manifest,
        status: actualExitCode === 0 ? "completed" : "failed",
        actualExitCode,
        files,
        observations,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ source: manifest.source, actualExitCode, files }));
  if (actualExitCode !== 0) process.exitCode = actualExitCode;
} else throw new Error("Use matrix, prepare, or verify.");
