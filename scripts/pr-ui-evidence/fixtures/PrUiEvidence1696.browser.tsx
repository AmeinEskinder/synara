// FILE: SidebarActivityView.browser.tsx
// Purpose: Browser regressions for Activity paging, stateful actions, scope fallback, and live PR data.
// Layer: Sidebar Activity UI test

import "../index.css";

import { ProjectId, ThreadId, type OrchestrationThreadPullRequest } from "@synara/contracts";
import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { page } from "vitest/browser";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import type { Project, SidebarThreadSummary } from "../types";
import { resolveThreadStatusPill, type ThreadStatusPill } from "./Sidebar.logic";
import { SidebarActivityView } from "./SidebarActivityView";
import type { ActivityScopeSelection } from "./SidebarActivityView.logic";

const projectFavicon = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="8" fill="red"/></svg>',
)}`;

vi.mock("~/lib/wsHttpUrl", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/wsHttpUrl")>()),
  resolveWsHttpUrl: () => projectFavicon,
}));

const PROJECT_A = ProjectId.makeUnsafe("activity-project-a");
const PROJECT_B = ProjectId.makeUnsafe("activity-project-b");

function makeProject(id: ProjectId, name: string): Project {
  return {
    id,
    kind: "project",
    name,
    remoteName: name,
    folderName: name,
    localName: null,
    cwd: `/tmp/${id}`,
    defaultModelSelection: null,
    expanded: true,
    scripts: [],
  };
}

function makeThread(
  index: number,
  overrides: Partial<SidebarThreadSummary> = {},
): SidebarThreadSummary {
  const completedAt = `2026-08-02T10:${String(index % 60).padStart(2, "0")}:00.000Z`;
  return {
    id: ThreadId.makeUnsafe(`activity-thread-${index}`),
    projectId: PROJECT_A,
    title: `Activity thread ${index}`,
    modelSelection: { provider: "codex", model: "gpt-5" },
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    session: null,
    createdAt: "2026-08-02T09:00:00.000Z",
    updatedAt: completedAt,
    latestTurn: {
      turnId: `activity-turn-${index}`,
      state: "completed",
      requestedAt: completedAt,
      startedAt: completedAt,
      completedAt,
      assistantMessageId: null,
    } as SidebarThreadSummary["latestTurn"],
    lastVisitedAt: "2026-08-02T12:00:00.000Z",
    latestUserMessageAt: null,
    latestHumanMessageAt: completedAt,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    hasLiveTailWork: false,
    pendingBackgroundWorkCount: 0,
    ...overrides,
  };
}

function renderActivity(input: {
  threads: readonly SidebarThreadSummary[];
  projects?: readonly Project[];
  activeThreadId?: ThreadId | null;
  pinnedThreadIdSet?: ReadonlySet<ThreadId>;
  settledOverrideByThreadId?: ReadonlyMap<ThreadId, boolean>;
  prByThreadId?: ReadonlyMap<ThreadId, OrchestrationThreadPullRequest | null>;
  onVisibleThreadIdsChange?: (threadIds: readonly ThreadId[]) => void;
  onOpenThread?: (threadId: ThreadId) => void;
  onSetThreadSettled?: (threadId: ThreadId, settled: boolean) => void;
  onReturnSnoozedThread?: (threadId: ThreadId) => void;
  onMarkThreadRead?: (threadId: ThreadId, completedAt?: string) => void;
  onRenameThread?: (threadId: ThreadId) => void;
  onThreadRenamePointerUp?: (event: ReactPointerEvent<HTMLElement>, threadId: ThreadId) => void;
  onThreadContextMenu?: (threadId: ThreadId, position: { x: number; y: number }) => void;
  onProjectContextMenu?: (projectId: ProjectId, position: { x: number; y: number }) => void;
  resolveThreadStatus?: (thread: SidebarThreadSummary) => ThreadStatusPill | null;
  threadsHydrated?: boolean;
  /** Controlled scope (the sidebar's role); omitted, the harness keeps it in local state. */
  scope?: {
    selection: ActivityScopeSelection;
    onChange: (selection: ActivityScopeSelection) => void;
  };
}) {
  return <ActivityHarness {...input} />;
}

function ActivityHarness(input: Parameters<typeof renderActivity>[0]) {
  const projects = input.projects ?? [makeProject(PROJECT_A, "Project A")];
  const [localScope, setLocalScope] = useState<ActivityScopeSelection>(null);
  return (
    <SidebarActivityView
      threads={input.threads}
      projectById={new Map(projects.map((project) => [project.id, project]))}
      activeThreadId={input.activeThreadId ?? null}
      pinnedThreadIdSet={input.pinnedThreadIdSet ?? new Set()}
      settledOverrideByThreadId={input.settledOverrideByThreadId ?? new Map()}
      threadsHydrated={input.threadsHydrated ?? true}
      scopeSelection={input.scope ? input.scope.selection : localScope}
      onScopeSelectionChange={input.scope ? input.scope.onChange : setLocalScope}
      prByThreadId={input.prByThreadId ?? new Map()}
      threadJumpLabelByThreadId={new Map()}
      onVisibleThreadIdsChange={input.onVisibleThreadIdsChange ?? (() => {})}
      resolveThreadStatus={input.resolveThreadStatus ?? (() => null)}
      onOpenThread={input.onOpenThread ?? (() => {})}
      onOpenThreadPullRequest={() => {}}
      onSetThreadSettled={input.onSetThreadSettled ?? (() => {})}
      onReturnSnoozedThread={input.onReturnSnoozedThread ?? (() => {})}
      onToggleThreadPinned={() => {}}
      onArchiveThread={() => {}}
      onMarkThreadRead={input.onMarkThreadRead ?? (() => {})}
      onRenameThread={input.onRenameThread ?? (() => {})}
      onThreadRenamePointerUp={input.onThreadRenamePointerUp ?? (() => {})}
      onThreadContextMenu={input.onThreadContextMenu ?? (() => {})}
      onProjectContextMenu={input.onProjectContextMenu ?? (() => {})}
      renderThreadHoverCard={() => null}
      onCreateChat={() => {}}
      onAddProject={() => {}}
    />
  );
}

it("PR UI evidence: Working activity uses the actual status and disclosure components", async () => {
  const directory = import.meta.env.VITE_PR_UI_EVIDENCE_DIR;
  const variant = import.meta.env.VITE_PR_UI_EVIDENCE_VARIANT;
  expect(directory).toMatch(/^\//);
  expect(["before", "after"]).toContain(variant);
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-08-02T12:00:00.000Z"));
  await page.viewport(1000, 760);
  const idle = makeThread(700, { title: "Review the release notes" });
  const busy = makeThread(701, { title: "Run the integration checks", hasLiveTailWork: true });
  const pending = makeThread(702, { title: "Prepare the changelog", hasLiveTailWork: true });
  const resolveStatus = (thread: SidebarThreadSummary) =>
    resolveThreadStatusPill({
      thread,
      hasPendingApprovals: thread.hasPendingApprovals,
      hasPendingUserInput: thread.hasPendingUserInput,
    });
  expect(resolveStatus(busy)?.label).toBe("Working");
  const host = document.createElement("div");
  Object.assign(host.style, {
    width: "380px",
    minHeight: "550px",
    padding: "12px",
    margin: "32px",
    background: "var(--background)",
  });
  document.body.append(host);
  const input = { threads: [idle, busy, pending], resolveThreadStatus: resolveStatus };
  const screen = await render(renderActivity(input), { container: host });
  try {
    await expect.element(screen.getByText(idle.title, { exact: true })).toBeVisible();
    const working = page.getByRole("button", { name: "Working", exact: true });
    if (variant === "after") {
      await expect.element(working).toHaveAttribute("aria-expanded", "false");
      await expect.element(screen.getByText(busy.title, { exact: true })).not.toBeInTheDocument();
    } else {
      await expect.element(working).not.toBeInTheDocument();
      await expect.element(screen.getByText(busy.title, { exact: true })).toBeVisible();
    }
    await document.fonts.ready;
    await page.screenshot({ path: `${directory}/activity-default.png`, element: host });
    if (variant === "after") {
      await working.click();
      await expect.element(working).toHaveAttribute("aria-expanded", "true");
      await expect.element(screen.getByText(busy.title, { exact: true })).toBeVisible();
      await page.screenshot({ path: `${directory}/activity-expanded.png`, element: host });
    }
  } finally {
    await screen.unmount();
    host.remove();
    vi.restoreAllMocks();
  }
});
