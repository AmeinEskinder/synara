import "../index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { page } from "vitest/browser";
import { expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { useTheme } from "../hooks/useTheme";
import type { WorkLogEntry } from "../workLog";
import ChatMarkdown from "./ChatMarkdown";
import { AgentActivityDetailView } from "./chat/AgentActivityDetailView";
import { getChatTranscriptTextStyle } from "./chat/chatTypography";

const common = { cwd: undefined, isStreaming: false, style: getChatTranscriptTextStyle(13) };
const prose = [
  "## A readable build review",
  "The primary answer explains the result. Supporting details remain available, while process updates stay quieter.",
  "",
  "**Next step:** inspect the output before publishing.",
  "",
  "- **Review:** examine the focused changes.",
  "- **Verify:** keep the original checks meaningful.",
  "",
  "Use `bun run test` to inspect the relevant suite.",
].join("\n");
const longCommand = "bun run test -- src/components/ChatMarkdown.test.tsx src/components/chat/MessagesTimeline.test.tsx src/components/chat/AgentActivityDetailView.test.tsx src/appSettings.test.ts";
const code = "## Long command\n\n```bash\n" + longCommand + "\n```\n\nSoft wrap changes the presentation without changing the command.";
const rtl = "> [!NOTE]\n> هذه ملاحظة عربية للمراجعة. يبقى النص واضحاً وتظهر حافة التنبيه في بداية السطر.\n\n> هذا اقتباس عادي مع مساحة قراءة هادئة.";
const table = "| Item | Result |\n| --- | --- |\n| Typography | Primary answers and supporting details |\n| Code | Wrapped commands with a manual toggle |";
const activityEntries: WorkLogEntry[] = [
  { id: "reasoning", createdAt: "2026-10-11T12:00:00.000Z", label: "Reasoning update", tone: "thinking", detail: "Considering the dependency changes before choosing the next verification step." },
  { id: "summary", createdAt: "2026-10-11T12:00:02.000Z", label: "Build review", tone: "info", activityKind: "tool.summary", detail: "The build output is available for review. Supporting details remain visible beside the primary result." },
];

function TypographyContent() {
  const { setTheme } = useTheme();
  const [panel, setPanel] = useState<"prose" | "code" | "rtl" | "activity">("prose");
  return (
    <>
      <header className="space-y-2 border-b pb-3">
        <h1 className="text-lg font-medium">Chat typography review</h1>
        <p className="text-sm text-muted-foreground">Production markdown and activity components with controlled sample content.</p>
        <nav aria-label="Evidence controls" className="flex flex-wrap gap-2 text-sm">
          <button className="rounded border px-2 py-1" onClick={() => setTheme("dark")}>Dark theme</button>
          <button className="rounded border px-2 py-1" onClick={() => setTheme("light")}>Light theme</button>
          <button className="rounded border px-2 py-1" onClick={() => setPanel("prose")}>Prose sample</button>
          <button className="rounded border px-2 py-1" onClick={() => setPanel("code")}>Code sample</button>
          <button className="rounded border px-2 py-1" onClick={() => setPanel("rtl")}>RTL sample</button>
          <button className="rounded border px-2 py-1" onClick={() => setPanel("activity")}>Activity sample</button>
        </nav>
      </header>
      <main className="min-h-0 flex-1 overflow-auto" data-evidence-panel={panel}>
        {panel === "prose" && <div className="mx-auto max-w-[46rem] space-y-5">
          <section data-evidence-tone="default"><ChatMarkdown {...common} text={prose} /></section>
          <section data-evidence-tone="subtle"><ChatMarkdown {...common} {...{ tone: "subtle" as const }} text="Supporting detail: this additional context stays readable while the primary answer carries more visual weight." /></section>
          <section data-evidence-tone="process"><ChatMarkdown {...common} {...{ tone: "process" as const }} text="Process update: reading the command output and checking the next step." /></section>
        </div>}
        {panel === "code" && <div className="mx-auto max-w-[46rem]"><ChatMarkdown {...common} text={code} /></div>}
        {panel === "rtl" && <div className="mx-auto max-w-[46rem] space-y-6">
          <section dir="rtl" data-evidence-rtl><ChatMarkdown {...common} text={rtl} /></section>
          <section><ChatMarkdown {...common} text={table} /></section>
        </div>}
        {panel === "activity" && <AgentActivityDetailView
          detail={{ id: "typography-review", title: "Build review", summary: "Actual activity-detail tone selection", primaryEntry: activityEntries[0]!, entries: activityEntries }}
          chatFontSizePx={13} markdownCwd={undefined} onBack={() => setPanel("prose")} onImageExpand={() => {}} timestampFormat="locale"
        />}
      </main>
    </>
  );
}

it("PR UI evidence: contextual tones, code wrapping and RTL alerts across themes and widths", async () => {
  const variant = import.meta.env.VITE_PR_UI_EVIDENCE_VARIANT;
  const directory = import.meta.env.VITE_PR_UI_EVIDENCE_DIR;
  expect(["before", "after"]).toContain(variant);
  expect(directory).toMatch(/^\//);
  const previousTheme = localStorage.getItem("synara:theme");
  const host = document.createElement("div");
  Object.assign(host.style, { position: "fixed", inset: "0", padding: "20px", background: "var(--background)", color: "var(--foreground)", fontFamily: "var(--font-system-ui)", display: "flex", flexDirection: "column", gap: "20px" });
  document.body.append(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const screen = await render(<QueryClientProvider client={client}><TypographyContent /></QueryClientProvider>, { container: host });
  const cases: Array<Record<string, unknown>> = [];
  const screenshots: string[] = [];
  const capture = async (name: string) => {
    await document.fonts.ready;
    await page.getByRole("heading", { name: "Chat typography review", exact: true }).hover();
    await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    await page.screenshot({ path: `${directory}/${name}.png` });
    screenshots.push(name);
    await new Promise((done) => setTimeout(done, 500));
  };
  const codeMetrics = () => {
    const block = host.querySelector<HTMLElement>(".chat-markdown-codeblock")!;
    const pre = block.querySelector<HTMLElement>("pre")!;
    return { wrap: block.dataset.wrap, text: pre.textContent?.trim(), whiteSpace: getComputedStyle(pre).whiteSpace, clientWidth: pre.clientWidth, scrollWidth: pre.scrollWidth, height: pre.getBoundingClientRect().height };
  };
  try {
    for (const width of [980, 390]) {
      await page.viewport(width, 860);
      for (const theme of ["dark", "light"] as const) {
        const label = `${theme}-${width}px`;
        await page.getByRole("button", { name: `${theme === "dark" ? "Dark" : "Light"} theme`, exact: true }).click();
        await expect.poll(() => document.documentElement.classList.contains("dark")).toBe(theme === "dark");
        await expect.poll(() => getComputedStyle(document.documentElement).getPropertyValue("--color-text-accent").trim()).not.toBe("");
        await page.getByRole("button", { name: "Prose sample", exact: true }).click();
        await expect.poll(() => host.querySelector('[data-evidence-panel="prose"]') !== null).toBe(true);
        const tones = ["default", "subtle", "process"].map((tone) => {
          const element = host.querySelector<HTMLElement>(`[data-evidence-tone="${tone}"] .chat-markdown`)!;
          const style = getComputedStyle(element);
          expect(element.getBoundingClientRect().height).toBeGreaterThan(0);
          return { tone, color: style.color, fontSize: style.fontSize, lineHeight: style.lineHeight, className: element.className };
        });
        expect(tones.every((tone) => tone.fontSize === "13px" && parseFloat(tone.lineHeight) > 21)).toBe(true);
        if (variant === "after") expect(new Set(tones.map((tone) => tone.color)).size).toBe(3);
        else expect(new Set(tones.map((tone) => tone.color)).size).toBe(1);
        const heading = host.querySelector<HTMLElement>('[data-evidence-tone="default"] h2')!;
        const headingStyle = getComputedStyle(heading);
        expect(parseFloat(headingStyle.fontSize)).toBeCloseTo(13 * (variant === "after" ? 1.42 : 1.55), 2);
        const inlineCode = host.querySelector<HTMLElement>('[data-evidence-tone="default"] code')!;
        const headingMetrics = { fontSize: headingStyle.fontSize, lineHeight: headingStyle.lineHeight };
        const inlineCodeMetrics = { borderRadius: getComputedStyle(inlineCode).borderRadius, padding: getComputedStyle(inlineCode).padding };
        await capture(`${label}-prose`);
        await page.getByRole("button", { name: "Code sample", exact: true }).click();
        await expect.poll(() => host.querySelector(".chat-markdown-codeblock pre.shiki code")?.textContent?.trim()).toBe(longCommand);
        const initial = codeMetrics();
        expect(initial.wrap).toBe(variant === "after" ? "true" : "false");
        expect(initial.text).toBe(longCommand);
        if (variant === "after") expect(initial.scrollWidth).toBeLessThanOrEqual(initial.clientWidth + 1);
        else expect(initial.scrollWidth).toBeGreaterThan(initial.clientWidth + 20);
        await capture(`${label}-code-default`);
        await page.getByRole("button", { name: variant === "after" ? "Disable soft wrap" : "Enable soft wrap", exact: true }).click();
        await expect.poll(() => codeMetrics().wrap).toBe(variant === "after" ? "false" : "true");
        const toggled = codeMetrics();
        expect(toggled.text).toBe(longCommand);
        if (variant === "after") expect(toggled.scrollWidth).toBeGreaterThan(toggled.clientWidth + 20);
        else expect(toggled.scrollWidth).toBeLessThanOrEqual(toggled.clientWidth + 1);
        await capture(`${label}-code-toggled`);
        await page.getByRole("button", { name: variant === "after" ? "Enable soft wrap" : "Disable soft wrap", exact: true }).click();
        await expect.poll(() => codeMetrics().wrap).toBe(initial.wrap);
        expect(codeMetrics().text).toBe(longCommand);
        await page.getByRole("button", { name: "RTL sample", exact: true }).click();
        await expect.poll(() => host.querySelector('[data-github-alert="note"]') !== null).toBe(true);
        const alert = host.querySelector<HTMLElement>('[data-github-alert="note"]')!;
        const alertStyle = getComputedStyle(alert);
        expect(alertStyle.direction).toBe("rtl");
        if (variant === "after") {
          expect(alertStyle.borderRightWidth).toBe("3px");
          expect(alertStyle.borderLeftWidth).toBe("1px");
        } else {
          expect(alertStyle.borderLeftWidth).toBe("3px");
          expect(alertStyle.borderRightWidth).toBe("0px");
        }
        expect(host.querySelectorAll("tbody tr")).toHaveLength(2);
        const alertMetrics = { direction: alertStyle.direction, borderLeftWidth: alertStyle.borderLeftWidth, borderRightWidth: alertStyle.borderRightWidth };
        await capture(`${label}-rtl-table`);
        await page.getByRole("button", { name: "Activity sample", exact: true }).click();
        await expect.poll(() => host.querySelectorAll('[data-agent-activity-detail="true"] .chat-markdown').length).toBe(2);
        const activity = [...host.querySelectorAll<HTMLElement>('[data-agent-activity-detail="true"] .chat-markdown')].map((element) => ({ className: element.className, text: element.textContent, color: getComputedStyle(element).color }));
        if (variant === "after") {
          expect(activity[0]!.className).toContain("chat-markdown--process");
          expect(activity[1]!.className).toContain("chat-markdown--subtle");
          expect(activity[0]!.color).not.toBe(activity[1]!.color);
        } else expect(activity[0]!.color).toBe(activity[1]!.color);
        await capture(`${label}-activity`);
        cases.push({ width, theme, tones, heading: headingMetrics, inlineCode: inlineCodeMetrics, initialCode: initial, toggledCode: toggled, alert: alertMetrics, activity });
      }
    }
    console.log("PR_TYPOGRAPHY_RESULT " + JSON.stringify({ variant, cases, screenshots, boundary: "Actual ChatMarkdown, syntax highlighter, activity detail and theme. Controlled content and explicit RTL container; no native desktop or live provider run." }));
  } finally {
    await screen.unmount();
    client.clear();
    host.remove();
    if (previousTheme === null) localStorage.removeItem("synara:theme");
    else localStorage.setItem("synara:theme", previousTheme);
  }
});
