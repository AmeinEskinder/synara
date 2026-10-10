import "../index.css";
import { useEffect } from "react";
import { expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { useTheme } from "../hooks/useTheme";
import ChatMarkdown from "./ChatMarkdown";

const diagram = [
  "flowchart LR",
  "accTitle: Review workflow",
  "A[Prepare change] --> B[Run checks]",
  "B --> C[Review result]",
].join("\n");
const readme = [
  "# Review workflow",
  "This README describes the path from a prepared change to a reviewed result.",
  `\`\`\`mermaid\n${diagram}\n\`\`\``,
  "Keep the source available for copying, then review the result when checks finish.",
].join("\n\n");

function Evidence() {
  const { resolvedTheme, setTheme } = useTheme();
  useEffect(() => setTheme("light"), [setTheme]);
  return (
    <main
      aria-label="README preview"
      data-evidence-theme={resolvedTheme}
      style={{
        width: 840,
        minHeight: 440,
        margin: "40px auto",
        padding: 32,
        background: "var(--background)",
        color: "var(--foreground)",
      }}
    >
      <ChatMarkdown text={readme} cwd={undefined} />
    </main>
  );
}

it("PR UI evidence: actual settled README Mermaid behavior at the selected source revision", async () => {
  const variant = import.meta.env.VITE_PR_UI_EVIDENCE_VARIANT;
  const directory = import.meta.env.VITE_PR_UI_EVIDENCE_DIR;
  expect(["before", "after"]).toContain(variant);
  expect(directory).toMatch(/^\//);
  await page.viewport(1000, 760);
  const screen = await render(<Evidence />);
  try {
    await expect.element(screen.getByRole("main")).toHaveAttribute("data-evidence-theme", "light");
    await expect.element(screen.getByRole("button", { name: "Copy code" })).toBeVisible();
    if (variant === "before") {
      await expect
        .poll(() => document.querySelector(".chat-markdown pre")?.textContent)
        .toContain(diagram);
      expect(document.querySelector(".chat-markdown img")).toBeNull();
    } else {
      await expect
        .poll(() => {
          const image = document.querySelector<HTMLImageElement>('img[alt="Review workflow"]');
          return image?.complete && image.naturalWidth > 0;
        })
        .toBe(true);
      await expect.element(screen.getByRole("img", { name: "Review workflow" })).toBeVisible();
      expect(document.querySelector(".chat-markdown-codeblock__body svg")).toBeNull();
      expect(document.querySelector(".chat-markdown pre")).toBeNull();
    }
    await document.fonts.ready;
    await page.screenshot({ path: `${directory}/mermaid.png` });
  } finally {
    await screen.unmount();
  }
});
