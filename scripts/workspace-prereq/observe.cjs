const fs = require("node:fs");
const path = require("node:path");
const { fileURLToPath } = require("node:url");
const { createHash } = require("node:crypto");

const traceDirectory = process.env.SYNARA_PREREQ_TRACE_DIR;
const entrypoint = process.argv[1] || "";
let executable = entrypoint.replaceAll("\\", "/");
if (traceDirectory && entrypoint) {
  try {
    executable = fs.realpathSync(entrypoint).replaceAll("\\", "/");
  } catch {
    // A non-file Node entrypoint is outside this observation.
  }
}
const isPatcher = /\/@effect\/language-service\/cli\.js$/i.test(executable);

if (traceDirectory && isPatcher) {
  const original = {
    appendFileSync: fs.appendFileSync,
    statSync: fs.statSync,
    realpathSync: fs.realpathSync,
  };
  const tracePath = path.join(traceDirectory, `${process.pid}.jsonl`);
  let sequence = 0;
  let dropped = 0;
  let reportedFailure = false;

  function emit(event, details = {}, required = false) {
    if (!required && sequence >= 500) {
      dropped++;
      return;
    }
    try {
      original.appendFileSync(
        tracePath,
        JSON.stringify({
          event,
          pid: process.pid,
          sequence: sequence++,
          time: Date.now(),
          monotonic: process.hrtime.bigint().toString(),
          ...details,
        }) + "\n",
      );
    } catch (error) {
      if (!reportedFailure) {
        reportedFailure = true;
        process.stderr.write(`Prerequisite observation failed: ${String(error)}\n`);
      }
    }
  }

  function target(value) {
    const file =
      typeof value === "string" ? value : value instanceof URL ? fileURLToPath(value) : null;
    if (!file || !/[\\/]typescript[\\/]lib[\\/](?:typescript|_tsc)\.js$/i.test(file)) return null;
    return path.resolve(file);
  }

  function state(file) {
    try {
      const stat = original.statSync(file);
      return {
        realPath: original.realpathSync(file),
        size: stat.size,
        links: stat.nlink,
        modified: stat.mtimeMs,
      };
    } catch (error) {
      return { error: String(error) };
    }
  }

  function content(value) {
    if (!Buffer.isBuffer(value) && typeof value !== "string") return {};
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const text = bytes.toString("utf8");
    return {
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      patchMarker: text.includes('"use effect-lsp-patch-version 0.75.1";'),
      checkSourceFileWorker: text.indexOf("function checkSourceFileWorker"),
      checkGrammarSourceFile: text.indexOf("checkGrammarSourceFile(node)"),
    };
  }

  emit(
    "process-start",
    {
      parentPid: process.ppid,
      cwd: process.cwd(),
      executable: process.execPath,
      entrypoint,
      cli: executable,
      runtime: process.versions.node,
      lifecycle: process.env.npm_lifecycle_event ?? null,
      package: process.env.npm_package_name ?? null,
    },
    true,
  );

  for (const name of ["readFileSync", "writeFileSync"]) {
    const call = fs[name];
    fs[name] = function (...args) {
      const file = target(args[0]);
      if (!file) return Reflect.apply(call, this, args);
      emit(`${name}-start`, { file, state: state(file) });
      try {
        const result = Reflect.apply(call, this, args);
        emit(`${name}-end`, {
          file,
          state: state(file),
          ...content(name === "readFileSync" ? result : args[1]),
        });
        return result;
      } catch (error) {
        emit(`${name}-error`, { file, error: String(error), state: state(file) });
        throw error;
      }
    };
  }

  for (const name of ["readFile", "writeFile"]) {
    const call = fs[name];
    fs[name] = function (...args) {
      const file = target(args[0]);
      const callback = args.at(-1);
      if (!file || typeof callback !== "function") return Reflect.apply(call, this, args);
      emit(`${name}-start`, { file, state: state(file) });
      args[args.length - 1] = function (...callbackArgs) {
        const [error, value] = callbackArgs;
        emit(`${name}-${error ? "error" : "end"}`, {
          file,
          state: state(file),
          error: error ? String(error) : null,
          ...content(name === "readFile" ? value : args[1]),
        });
        return Reflect.apply(callback, this, callbackArgs);
      };
      return Reflect.apply(call, this, args);
    };

    const promiseCall = fs.promises[name];
    fs.promises[name] = async function (...args) {
      const file = target(args[0]);
      if (!file) return Reflect.apply(promiseCall, this, args);
      emit(`promises.${name}-start`, { file, state: state(file) });
      try {
        const result = await Reflect.apply(promiseCall, this, args);
        emit(`promises.${name}-end`, {
          file,
          state: state(file),
          ...content(name === "readFile" ? result : args[1]),
        });
        return result;
      } catch (error) {
        emit(`promises.${name}-error`, { file, state: state(file), error: String(error) });
        throw error;
      }
    };
  }

  require("node:module").syncBuiltinESMExports();
  process.on("uncaughtExceptionMonitor", (error) => {
    emit("uncaught-exception", { error: String(error) }, true);
  });
  process.on("exit", (code) => emit("process-exit", { code, dropped, reportedFailure }, true));
}
