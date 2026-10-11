// Real WorkspaceFilePreview captures for the header-overlap regression in #1655.
import "../index.css";

import type { NativeApi, ProjectReadFileResult } from "@synara/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { page } from "vitest/browser";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { WorkspaceFilePreview } from "./WorkspaceFilePreview";

const contents = "// needle first\n// source-only preview\n// needle stable\n// needle tail\n";
const file = (text: string): ProjectReadFileResult => ({
  relativePath: "src/find.ts",
  contents: text,
  truncated: false,
  version: `sha256:${"1".repeat(64)}`,
  encoding: "utf8",
  lineEnding: "lf",
});

it("PR UI evidence: find remains inside its pane and leaves Reload reachable", async () => {
  const directory = import.meta.env.VITE_PR_UI_EVIDENCE_DIR;
  const variant = import.meta.env.VITE_PR_UI_EVIDENCE_VARIANT;
  expect(directory).toMatch(/^\//);
  expect(["before", "after"]).toContain(variant);
  await page.viewport(1000, 760);
  const previousApi = Object.getOwnPropertyDescriptor(window, "nativeApi");
  const wasDark = document.documentElement.classList.contains("dark");
  document.documentElement.classList.add("dark");
  try {
    for (const width of [760, 320]) {
      const readFile = vi.fn().mockResolvedValue(file(contents));
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      client.setQueryData(["server", "config"], { keybindings: [] });
      Object.defineProperty(window, "nativeApi", {
        configurable: true,
        value: {
          projects: { readFile, onFileChange: () => () => undefined },
          git: { readWorkingTreeDiff: async () => ({ patch: "", truncated: false }) },
        } as unknown as NativeApi,
      });
      const host = document.createElement("div");
      Object.assign(host.style, {
        width: `${width}px`,
        height: "340px",
        margin: "24px",
        display: "flex",
        background: "var(--background)",
        border: "1px solid var(--border)",
      });
      document.body.append(host);
      const screen = await render(
        <QueryClientProvider client={client}>
          <WorkspaceFilePreview
            workspaceRoot="/workspace/file-find-fixture"
            filePath="src/find.ts"
          />
        </QueryClientProvider>,
        { container: host },
      );
      try {
        await expect
          .poll(() => host.querySelector('[data-syntax-highlighted="true"]'))
          .not.toBeNull();
        await page.getByRole("button", { name: "Find in file", exact: true }).click();
        await page.getByRole("textbox", { name: "Find in file" }).fill("needle");
        await expect.element(page.getByText("1 / 3", { exact: true })).toBeVisible();
        await page.getByRole("button", { name: "Next match (Enter)" }).click();
        await expect.element(page.getByText("2 / 3", { exact: true })).toBeVisible();
        const reload = page.getByRole("button", { name: "Reload file from disk", exact: true });
        const button = reload.element();
        const rect = button.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        expect(button.contains(hit)).toBe(variant === "after");
        const preview = host.querySelector("[data-workspace-file-preview]")!;
        const bounds = preview.getBoundingClientRect();
        const bar = page.getByTestId("workspace-file-find-bar").element().getBoundingClientRect();
        expect(bar.left).toBeGreaterThanOrEqual(bounds.left);
        expect(bar.right).toBeLessThanOrEqual(bounds.right);
        await document.fonts.ready;
        await new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        );
        await page.screenshot({ path: `${directory}/find-${width}px.png`, element: host });
        if (variant === "after") {
          readFile.mockResolvedValue(file(contents.replace("needle first", "absent first")));
          await reload.click();
          await expect.element(page.getByText("1 / 2", { exact: true })).toBeVisible();
          expect(readFile).toHaveBeenCalledTimes(2);
        }
      } finally {
        await screen.unmount();
        client.clear();
        host.remove();
      }
    }
  } finally {
    if (previousApi) Object.defineProperty(window, "nativeApi", previousApi);
    else Reflect.deleteProperty(window, "nativeApi");
    if (!wasDark) document.documentElement.classList.remove("dark");
  }
});
