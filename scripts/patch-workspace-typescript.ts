import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// These workspaces use the legacy Effect language-service patch. Root
// postinstall owns the pass: Bun may run workspace prepare hooks concurrently
// even with --concurrent-scripts=1, and isolated installs share compiler files.
export const LEGACY_TYPESCRIPT_WORKSPACES = [
  "apps/server",
  "apps/web",
  "packages/contracts",
  "packages/shared",
  "scripts",
] as const;

export function patchWorkspaceTypeScript(root: string): void {
  const targets = new Map<string, string>();
  for (const workspace of LEGACY_TYPESCRIPT_WORKSPACES) {
    const modules = join(root, workspace, "node_modules");
    const compiler = join(modules, "typescript");
    // Filtered installs intentionally omit some workspace dependency trees.
    if (!existsSync(compiler)) continue;
    const cli = join(modules, "@effect/language-service/cli.js");
    if (!existsSync(cli)) {
      throw new Error(`Missing Effect language-service patcher for installed ${workspace}`);
    }
    const directory = realpathSync(compiler);
    const patcher = realpathSync(cli);
    const previous = targets.get(directory);
    if (previous !== undefined && previous !== patcher) {
      throw new Error(`Conflicting Effect language-service patchers for ${directory}`);
    }
    targets.set(directory, patcher);
  }

  for (const [directory, cli] of targets) {
    // Await each real compiler's patch before starting another. execFileSync
    // propagates nonzero exits and signals, so later preparation cannot mask it.
    execFileSync(process.execPath, [cli, "patch", "--dir", directory], {
      cwd: root,
      stdio: "inherit",
    });
  }
}

if (import.meta.main) {
  patchWorkspaceTypeScript(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
}
