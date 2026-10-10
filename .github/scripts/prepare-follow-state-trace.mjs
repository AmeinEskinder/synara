import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Diagnostic only. Copy the pinned dependency into an isolated output directory;
// never mutate an installed package or poison a restored dependency cache.
const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));
const requireFromWeb = createRequire(join(sourceRoot, "apps/web/package.json"));
const packageRoot = dirname(realpathSync(requireFromWeb.resolve("@legendapp/list/react")));
const requireFromList = createRequire(join(packageRoot, "package.json"));
const original = readFileSync(join(packageRoot, "react.mjs"), "utf8");
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const expectedOriginalSha256 = "de9b0b58b4c97a32879c45ed9b96607aac7712b1ed0b918b23e749e33e27e91c";
if (sha256(original) !== expectedOriginalSha256)
  throw new Error("Pinned LegendList module bytes differ; refuse to instrument another version.");

let instrumented = original;
const replacements = [];
const insertOnce = (needle, replacement, label) => {
  if (instrumented.split(needle).length !== 2)
    throw new Error(`Expected exactly one instrumentation site: ${label}`);
  instrumented = instrumented.replace(needle, replacement);
  replacements.push(label);
};
const record = (label, state, extra = "{}") =>
  `globalThis.__SYNARA_FOLLOW_DIAGNOSTIC_TRACE__?.record(${JSON.stringify(label)}, ${state}, ${extra});`;

// Read only values already held by the list. Every original assignment still
// executes exactly once with its unchanged value and surrounding control flow.
let assignmentCount = 0;
instrumented = instrumented.replace(/^(\s*)state\.scroll = (\w+);$/gm, (match, indent, value) => {
  if (!["offset", "0", "maxScroll", "newScroll", "targetScroll"].includes(value))
    throw new Error(`Unexpected scroll assignment expression: ${value}`);
  const site = ++assignmentCount;
  const label = `scroll-write-${site}:${value}`;
  replacements.push(label);
  return `${indent}${record(label, "state", `{ next: ${value} }`)}\n${match}`;
});
if (assignmentCount !== 7) throw new Error(`Expected seven scroll writes, got ${assignmentCount}.`);

insertOnce(
  "function onScroll(ctx, event) {",
  `function onScroll(ctx, event) {\n  ${record("native-scroll", "ctx.state", "{ offset: event.nativeEvent?.contentOffset?.y, contentHeight: event.nativeEvent?.contentSize?.height }")}`,
  "native-scroll",
);
insertOnce(
  "function finishInitialScroll(ctx, options) {",
  `function finishInitialScroll(ctx, options) {\n  ${record("finish-initial-scroll", "ctx.state", "{ resolvedOffset: options?.resolvedOffset, syncObservedOffset: options?.syncObservedOffset }")}`,
  "finish-initial-scroll",
);
insertOnce(
  "      const internalState = ctx.state;",
  `      const internalState = ctx.state;\n      ${record("state-created", "internalState", "{ context: ctx.contextNum }")}`,
  "state-created",
);
insertOnce(
  "      state.scrollProcessingEnabled = enabled;",
  `      ${record("scroll-processing-toggle", "state", "{ enabled }")}\n      state.scrollProcessingEnabled = enabled;`,
  "scroll-processing-toggle",
);

// Separate end-follow, preserved initial-end correction, and visible-content
// adjustment without adding geometry reads or changing callback scheduling.
insertOnce(
  "function doMaintainScrollAtEnd(ctx) {",
  `function doMaintainScrollAtEnd(ctx) {\n  ${record("maintain-end-request", "ctx.state")}`,
  "maintain-end-request",
);
insertOnce(
  "      state.maintainingScrollAtEnd = pendingState;",
  `      ${record("maintain-end-schedule", "state")}\n      state.maintainingScrollAtEnd = pendingState;`,
  "maintain-end-schedule",
);
insertOnce(
  '        if (state.props.maintainScrollAtEnd && peek$(ctx, "isWithinMaintainScrollAtEndThreshold")) {',
  `        ${record("maintain-end-frame", "state")}\n        if (state.props.maintainScrollAtEnd && peek$(ctx, "isWithinMaintainScrollAtEndThreshold")) {`,
  "maintain-end-frame",
);
insertOnce(
  "function schedulePreservedEndAnchorCorrectionFrame(ctx, correction) {",
  `function schedulePreservedEndAnchorCorrectionFrame(ctx, correction) {\n  ${record("preserved-end-schedule", "ctx.state")}`,
  "preserved-end-schedule",
);
insertOnce(
  "    const activeCorrection = state.preservedEndAnchorCorrection;",
  `    const activeCorrection = state.preservedEndAnchorCorrection;\n    ${record("preserved-end-frame", "state")}`,
  "preserved-end-frame",
);
insertOnce(
  "function requestAdjust(ctx, positionDiff, dataChanged) {",
  `function requestAdjust(ctx, positionDiff, dataChanged) {\n  ${record("visible-content-adjust", "ctx.state", "{ positionDiff, dataChanged }")}`,
  "visible-content-adjust",
);
insertOnce(
  "      target.scrollTo(options);",
  `      ${record("native-scroll-dispatch", "ctx.state", "{ offset, clampedOffset, maxOffset, animated }")}\n      target.scrollTo(options);`,
  "native-scroll-dispatch",
);
insertOnce(
  "function retargetActiveInitialScrollAtEnd(ctx) {",
  `function retargetActiveInitialScrollAtEnd(ctx) {\n  ${record("retarget-initial-end", "ctx.state")}`,
  "retarget-initial-end",
);

const output = join(sourceRoot, "output/follow-instrumented");
const evidence = join(sourceRoot, "output/follow-diagnostics");
mkdirSync(output, { recursive: true });
mkdirSync(evidence, { recursive: true });
writeFileSync(join(output, "react.mjs"), instrumented);
// Keep the application's React identity and the list's existing shim dependency.
// All links live only under isolated output, outside cached node_modules.
const peers = join(output, "node_modules");
if (lstatSync(peers, { throwIfNoEntry: false })?.isSymbolicLink()) rmSync(peers);
mkdirSync(peers, { recursive: true });
for (const name of ["react", "react-dom", "use-sync-external-store"]) {
  const resolver = name === "use-sync-external-store" ? requireFromList : requireFromWeb;
  const target = dirname(realpathSync(resolver.resolve(`${name}/package.json`)));
  const link = join(peers, name);
  if (lstatSync(link, { throwIfNoEntry: false })) {
    if (realpathSync(link) !== target) throw new Error(`Unexpected existing peer link: ${name}`);
  } else {
    symlinkSync(target, link, "junction");
  }
}
writeFileSync(
  join(evidence, "dependency-trace-provenance.json"),
  `${JSON.stringify(
    {
      package: "@legendapp/list",
      version: JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")).version,
      module: "react.mjs",
      sourceSha256: expectedOriginalSha256,
      instrumentedSha256: sha256(instrumented),
      replacements,
      installedPackageModified: false,
    },
    null,
    2,
  )}\n`,
);
console.log(
  `Prepared isolated scalar trace at ${output}; ${replacements.length} bounded source sites.`,
);
