import "../index.css";

import { MessageId } from "@synara/contracts";
import { useState } from "react";
import { page } from "vitest/browser";
import { expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { useTheme } from "../hooks/useTheme";
import { MessagesTimeline } from "./chat/MessagesTimeline";

const createdAt = "2026-10-11T12:00:00.000Z";
const timelineEntries = [
  {
    id: "entry-status-review",
    kind: "message" as const,
    createdAt,
    message: {
      id: MessageId.makeUnsafe("status-review"),
      role: "user" as const,
      text: "Inspect the current build and explain the next step.",
      createdAt,
      streaming: false,
    },
  },
];

function StatusTimeline() {
  const { resolvedTheme, setTheme } = useTheme();
  const [label, setLabel] = useState<"Thinking" | "Checking message delivery…">("Thinking");
  const [fontSize, setFontSize] = useState(13);
  return (
    <>
      <header className="space-y-2">
        <h1 className="text-lg font-medium">Working status review</h1>
        <p className="text-sm text-muted-foreground">
          Production timeline and theme, with a controlled conversation and status.
        </p>
        <nav aria-label="Evidence controls" className="flex flex-wrap gap-2 text-sm">
          <button className="rounded border px-2 py-1" onClick={() => setTheme("dark")}>
            Dark theme
          </button>
          <button className="rounded border px-2 py-1" onClick={() => setTheme("light")}>
            Light theme
          </button>
          <button className="rounded border px-2 py-1" onClick={() => setFontSize(13)}>
            Chat size 13
          </button>
          <button className="rounded border px-2 py-1" onClick={() => setFontSize(18)}>
            Chat size 18
          </button>
          <button className="rounded border px-2 py-1" onClick={() => setLabel("Thinking")}>
            Thinking status
          </button>
          <button
            className="rounded border px-2 py-1"
            onClick={() => setLabel("Checking message delivery…")}
          >
            Delivery status
          </button>
        </nav>
      </header>
      <section className="min-h-0 flex-1 rounded-lg border p-5" aria-label="Production transcript">
        <MessagesTimeline
          hasMessages
          isWorking
          workingLabel={label}
          activeTurnInProgress
          activeTurnStartedAt={createdAt}
          timelineEntries={timelineEntries}
          turnDiffSummaryByAssistantMessageId={new Map()}
          nowIso="2026-10-11T12:00:02.000Z"
          expandedWorkGroups={{}}
          onToggleWorkGroup={() => {}}
          onOpenTurnDiff={() => {}}
          revertTurnCountByUserMessageId={new Map()}
          onRevertUserMessage={() => {}}
          isRevertingCheckpoint={false}
          onImageExpand={() => {}}
          markdownCwd={undefined}
          resolvedTheme={resolvedTheme}
          chatFontSizePx={fontSize}
          timestampFormat="locale"
          workspaceRoot={undefined}
        />
      </section>
    </>
  );
}

it("PR UI evidence: working mark, semantic icon, type scale and actual motion preference", async () => {
  const variant = import.meta.env.VITE_PR_UI_EVIDENCE_VARIANT;
  const directory = import.meta.env.VITE_PR_UI_EVIDENCE_DIR;
  const motion = import.meta.env.VITE_PR_UI_MOTION_MODE;
  expect(["before", "after"]).toContain(variant);
  expect(["no-preference", "reduce"]).toContain(motion);
  expect(directory).toMatch(/^\//);
  expect(matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(motion === "reduce");
  await page.viewport(800, 560);
  const host = document.createElement("div");
  Object.assign(host.style, {
    position: "fixed",
    inset: "0",
    padding: "24px",
    background: "var(--background)",
    color: "var(--foreground)",
    fontFamily: "var(--font-system-ui)",
    display: "flex",
    flexDirection: "column",
    gap: "24px",
  });
  document.body.append(host);
  const previousTheme = localStorage.getItem("synara:theme");
  const screen = await render(<StatusTimeline />, { container: host });
  const row = () => host.querySelector<HTMLElement>('[data-timeline-row-kind="working"]')!;
  const indicator = () => row().querySelector<HTMLElement>(".shimmer-group")!;
  const frames: Array<Record<string, unknown>> = [];
  const stills: Array<Record<string, unknown>> = [];
  const snapshot = async (phase: string) => {
    await document.fonts.ready;
    await new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done())),
    );
    await page.getByRole("heading", { name: "Working status review" }).hover();
    const bounds = indicator().getBoundingClientRect();
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);
    expect(bounds.bottom).toBeLessThanOrEqual(window.innerHeight);
    const svg = indicator().querySelector<SVGSVGElement>("svg")!;
    const mark = indicator().querySelector<HTMLElement>('[data-synara-working-loader="true"]');
    const style = getComputedStyle(indicator());
    stills.push({
      phase,
      text: indicator().textContent,
      theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
      fontSize: style.fontSize,
      color: style.color,
      textFillColor: style.webkitTextFillColor,
      maskImage: style.maskImage,
      svgViewBox: svg.getAttribute("viewBox"),
      svgWidth: svg.getBoundingClientRect().width,
      svgHeight: svg.getBoundingClientRect().height,
      svgTransform: getComputedStyle(svg).transform,
      markPresent: mark !== null,
      paths: [...svg.querySelectorAll("path")].map((path) => path.getAttribute("d")),
    });
    await page.screenshot({ path: `${directory}/${motion}-${phase}.png` });
    await new Promise((done) => setTimeout(done, 600));
  };
  try {
    await page.getByRole("button", { name: "Dark theme", exact: true }).click();
    await expect.poll(() => document.documentElement.classList.contains("dark")).toBe(true);
    await expect
      .poll(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--color-text-accent").trim(),
      )
      .not.toBe("");
    await expect.poll(() => row()?.textContent).toBe("Thinking");
    expect(indicator().querySelector('[data-synara-working-loader="true"]') !== null).toBe(
      variant === "after",
    );
    const svg = indicator().querySelector<SVGSVGElement>("svg")!;
    if (variant === "after") {
      expect(svg.getAttribute("viewBox")).toBe("0 0 470 504");
      expect(svg.querySelectorAll('path[fill="currentColor"]').length).toBeGreaterThan(0);
      expect(indicator().querySelector("img")).toBeNull();
      expect(getComputedStyle(svg).transform).toBe("none");
      expect(svg.getAnimations()).toHaveLength(0);
    }
    await expect.poll(() => getComputedStyle(indicator()).fontSize).toBe("13px");
    await snapshot("dark-thinking-13px");
    for (let index = 0; index < 20; index += 1) {
      const style = getComputedStyle(indicator());
      frames.push({
        time: performance.now(),
        maskPosition: style.maskPosition,
        maskImage: style.maskImage,
        animationName: style.animationName,
        textFillColor: style.webkitTextFillColor,
        color: style.color,
        opacity: style.opacity,
        transform: getComputedStyle(svg).transform,
      });
      await new Promise((done) => setTimeout(done, 110));
    }
    expect(
      frames.every((frame) => frame.textFillColor === frame.color && frame.opacity === "1"),
    ).toBe(true);
    if (motion === "reduce") {
      expect(
        frames.every((frame) => frame.maskImage === "none" && frame.animationName === "none"),
      ).toBe(true);
      expect(indicator().getAnimations()).toHaveLength(0);
    } else {
      expect(getComputedStyle(indicator()).maskImage).toContain("linear-gradient");
      expect(new Set(frames.map((frame) => frame.maskPosition)).size).toBeGreaterThan(2);
      const animation = indicator().getAnimations()[0]!;
      expect(animation.startTime).toBe(0);
      expect(animation.effect?.getTiming().duration).toBe(2000);
      expect(getComputedStyle(indicator()).animationTimingFunction).toBe("steps(40)");
    }
    await page.getByRole("button", { name: "Chat size 18", exact: true }).click();
    await expect.poll(() => getComputedStyle(indicator()).fontSize).toBe("18px");
    if (variant === "after") {
      const scaledMark = indicator().querySelector<SVGSVGElement>("svg")!;
      expect(scaledMark.getBoundingClientRect().width / 18).toBeCloseTo(1.08, 2);
      expect(scaledMark.getBoundingClientRect().height / 18).toBeCloseTo(1.08, 2);
    }
    await snapshot("dark-thinking-18px");
    await page.getByRole("button", { name: "Delivery status", exact: true }).click();
    await expect.poll(() => row()?.textContent).toBe("Checking message delivery…");
    expect(indicator().querySelector('[data-synara-working-loader="true"]')).toBeNull();
    expect(indicator().querySelector('svg[data-slot="hugeicon"]')).not.toBeNull();
    await snapshot("dark-delivery-18px");
    await page.getByRole("button", { name: "Thinking status", exact: true }).click();
    await page.getByRole("button", { name: "Chat size 13", exact: true }).click();
    await page.getByRole("button", { name: "Light theme", exact: true }).click();
    await expect.poll(() => document.documentElement.classList.contains("dark")).toBe(false);
    await expect.poll(() => row()?.textContent).toBe("Thinking");
    await snapshot("light-thinking-13px");
    expect(host.querySelector('[data-turn-header="live"]')?.textContent).toBe("Working 2s");
    console.log(
      "PR_STATUS_MOTION_RESULT " +
        JSON.stringify({
          variant,
          motion,
          frames,
          stills,
          boundary:
            "Production MessagesTimeline, actual LegendList, SVG and theme; controlled conversation/status props. No live provider run.",
        }),
    );
  } finally {
    await screen.unmount();
    host.remove();
    if (previousTheme === null) localStorage.removeItem("synara:theme");
    else localStorage.setItem("synara:theme", previousTheme);
  }
});
