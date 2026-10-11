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
const destination = "apps/web/e2e/nativeStack";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
if (!Array.isArray(targets) || targets.length !== 6)
  throw new Error("Expected exactly six reviewed native targets");
const ids = new Set();
const scenarios = new Map([
  ["pr1790", "retention"],
  ["pr1792", "parallel"],
  ["pr1793", "restart"],
]);
for (const target of targets) {
  const match = /^(pr1790|pr1792|pr1793)-(before|after)$/.exec(target.id);
  if (
    !match ||
    ids.has(target.id) ||
    match[2] !== target.variant ||
    scenarios.get(match[1]) !== target.scenario ||
    !/^[a-f0-9]{40}$/.test(target.source)
  ) {
    throw new Error(`Invalid native-stack target: ${JSON.stringify(target)}`);
  }
  ids.add(target.id);
}
const command = process.argv[2];
if (command === "matrix") {
  const matrix = JSON.stringify({ include: targets });
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${matrix}\n`);
  else console.log(matrix);
} else if (command === "prepare") {
  const target = targets.find((entry) => entry.id === process.env.NATIVE_STACK_ID);
  if (
    !target ||
    target.source !== process.env.NATIVE_STACK_SOURCE ||
    git("rev-parse", "HEAD") !== target.source
  )
    throw new Error("Native source must match the reviewed matrix");
  const output = resolve(root, ".native-stack-output", target.id);
  mkdirSync(output, { recursive: true });
  mkdirSync(resolve(root, destination), { recursive: true });
  const fixtures = readdirSync(resolve(driver, "fixtures")).toSorted();
  if (
    fixtures.length !== 6 ||
    fixtures.some((name) => !/^[A-Za-z]+\.(ts|tsx|cjs|mjs|html)$/.test(name))
  )
    throw new Error("Expected the six reviewed native-stack fixture files");
  const overlays = [];
  for (const name of fixtures) {
    const path = `${destination}/${name}`;
    try {
      execFileSync("git", ["ls-files", "--error-unmatch", path], { cwd: root, stdio: "ignore" });
      throw new Error(`The fixture must not replace application source: ${path}`);
    } catch (error) {
      if (error.status !== 1) throw error;
    }
    copyFileSync(resolve(driver, "fixtures", name), resolve(root, path));
    overlays.push({ path, sha256: hash(readFileSync(resolve(root, path))) });
  }
  const provenance = {
    target,
    source: git("rev-parse", "HEAD"),
    sourceTree: git("rev-parse", "HEAD^{tree}"),
    lockfileSha256: hash(readFileSync(resolve(root, "bun.lock"))),
    driver: execFileSync("git", ["rev-parse", "HEAD"], { cwd: driver, encoding: "utf8" }).trim(),
    overlays,
    status: "prepared",
    applicationCodeModified: false,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(resolve(output, "provenance.json"), JSON.stringify(provenance, null, 2) + "\n");
  const environment = {
    SYNARA_NATIVE_STACK_LABEL: target.id,
    SYNARA_NATIVE_STACK_SCENARIO: target.scenario,
    SYNARA_NATIVE_STACK_VARIANT: target.variant,
    SYNARA_NATIVE_STACK_OUTPUT: output,
  };
  if (!process.env.GITHUB_ENV)
    throw new Error("GITHUB_ENV is required for the isolated capture job");
  for (const [key, value] of Object.entries(environment)) {
    if (/[\r\n]/.test(value)) throw new Error("Invalid evidence environment value");
    appendFileSync(process.env.GITHUB_ENV, `${key}=${value}\n`);
  }
  console.log(JSON.stringify(provenance));
} else if (command === "verify") {
  const output = process.env.SYNARA_NATIVE_STACK_OUTPUT;
  if (!output || !output.startsWith(resolve(root, ".native-stack-output") + "/"))
    throw new Error("Unexpected native output directory");
  const file = resolve(output, "provenance.json");
  const provenance = JSON.parse(readFileSync(file, "utf8"));
  if (
    git("rev-parse", "HEAD") !== provenance.source ||
    git("rev-parse", "HEAD^{tree}") !== provenance.sourceTree ||
    git("diff", "HEAD", "--name-only")
  )
    throw new Error("Application source changed during native acceptance");
  if (hash(readFileSync(resolve(root, "bun.lock"))) !== provenance.lockfileSha256)
    throw new Error("Source lockfile changed");
  for (const overlay of provenance.overlays) {
    if (hash(readFileSync(resolve(root, overlay.path))) !== overlay.sha256)
      throw new Error(`Reviewed native fixture changed: ${overlay.path}`);
  }
  const metadata = JSON.parse(
    readFileSync(resolve(output, `${provenance.target.id}-metadata.json`), "utf8"),
  );
  if (
    metadata.source !== provenance.source ||
    metadata.sourceTree !== provenance.sourceTree ||
    metadata.lockfileSha256 !== provenance.lockfileSha256 ||
    metadata.label !== provenance.target.id ||
    metadata.scenario !== provenance.target.scenario ||
    metadata.variant !== provenance.target.variant ||
    metadata.errors.length !== 0
  )
    throw new Error("Native acceptance failed or its exact-source metadata does not match");
  const expectedImages =
    metadata.scenario === "parallel" ||
    (metadata.scenario === "restart" && metadata.variant === "after")
      ? 3
      : 2;
  const pngs = readdirSync(output)
    .filter((name) => name.endsWith(".png"))
    .toSorted();
  if (pngs.length !== expectedImages || metadata.images.length !== expectedImages)
    throw new Error("The native scenario did not produce all required captures");
  const images = pngs.map((name) => {
    const bytes = readFileSync(resolve(output, name));
    if (bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a")
      throw new Error(`Invalid PNG: ${name}`);
    const sha256 = hash(bytes);
    const recorded = metadata.images.find((image) => image.name === name);
    if (!recorded || recorded.sha256 !== sha256 || recorded.bytes !== bytes.length)
      throw new Error(`Native capture hash mismatch: ${name}`);
    return { name, sha256, bytes: bytes.length };
  });
  writeFileSync(
    file,
    JSON.stringify(
      {
        ...provenance,
        status: "completed",
        images,
        metadataSha256: hash(
          readFileSync(resolve(output, `${provenance.target.id}-metadata.json`)),
        ),
        completedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      source: provenance.source,
      images,
      applicationCodeModified: false,
      nativeAssertions: "passed",
    }),
  );
} else {
  throw new Error("Use matrix, prepare, or verify");
}
