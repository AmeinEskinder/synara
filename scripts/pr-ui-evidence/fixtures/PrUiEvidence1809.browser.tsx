import "../index.css";

import {
  ThreadId,
  TurnId,
  type DesktopBridge,
  type DesktopQuitConfirmationRequest,
  type NativeApi,
} from "@synara/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { page } from "vitest/browser";
import { afterEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { useStore } from "~/store";
import { useTheme } from "~/hooks/useTheme";

import { RunningChatsQuitCoordinator } from "./RunningChatsQuitCoordinator";

function ThemedQuitCoordinator() {
  useTheme();
  return <RunningChatsQuitCoordinator />;
}

vi.mock("~/lib/wsHttpUrl", async (original) => ({
  ...(await original<typeof import("../lib/wsHttpUrl")>()),
  resolveWsHttpUrl: () => "",
}));

const originalBridge = window.desktopBridge;
const originalNativeApi = window.nativeApi;
const originalState = useStore.getState();
const appSettingsStorageKey = "synara:app-settings:v1";
const originalAppSettings = localStorage.getItem(appSettingsStorageKey);

afterEach(() => {
  if (originalBridge) window.desktopBridge = originalBridge;
  else delete window.desktopBridge;
  if (originalNativeApi) window.nativeApi = originalNativeApi;
  else delete window.nativeApi;
  useStore.setState(originalState, true);
  if (originalAppSettings === null) localStorage.removeItem(appSettingsStorageKey);
  else localStorage.setItem(appSettingsStorageKey, originalAppSettings);
});

it.each([false, true])(
  "PR UI evidence: pending quit acknowledgement (resume=%s)",
  async (resumeAfterRestart) => {
    const variant = import.meta.env.VITE_PR_UI_EVIDENCE_VARIANT;
    const directory = import.meta.env.VITE_PR_UI_EVIDENCE_DIR;
    expect(["before", "after"]).toContain(variant);
    expect(directory).toMatch(/^\//);
    await page.viewport(760, 680);
    const host = document.createElement("div");
    Object.assign(host.style, {
      position: "fixed",
      inset: "0",
      padding: "24px",
      background: "var(--background)",
      color: "var(--foreground)",
    });
    const heading = document.createElement("h1");
    heading.textContent = "Quit admission review";
    const boundary = document.createElement("p");
    boundary.textContent =
      "Production quit coordinator with a controlled native API acknowledgement. Native process cleanup is verified separately.";
    host.append(heading, boundary);
    document.body.append(host);
    const container = document.createElement("div");
    host.append(container);
    const capture = async (phase: string) => {
      await document.fonts.ready;
      await new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      );
      await page.screenshot({
        path: `${directory}/quit-resume-${resumeAfterRestart}-${phase}.png`,
      });
      await new Promise((done) => setTimeout(done, 700));
    };
    let request: ((payload: DesktopQuitConfirmationRequest) => void) | undefined;
    const reply = vi.fn();
    let acknowledge!: () => void;
    const acknowledgement = new Promise<void>((resolve) => {
      acknowledge = resolve;
    });
    const prepareQuitResume = vi.fn(() => acknowledgement);
    const dispatchCommand = vi.fn();
    window.desktopBridge = {
      onQuitConfirmationRequest: (listener) => {
        request = listener;
        return () => {
          request = undefined;
        };
      },
      replyQuitConfirmation: reply,
      setTheme: vi.fn().mockResolvedValue(undefined),
    } as Pick<
      DesktopBridge,
      "onQuitConfirmationRequest" | "replyQuitConfirmation" | "setTheme"
    > as DesktopBridge;
    window.nativeApi = {
      orchestration: { prepareQuitResume, dispatchCommand },
    } as unknown as NativeApi;
    const threadId = ThreadId.makeUnsafe("pending-quit-thread");
    useStore.setState({
      sidebarThreadSummaryById: {},
      threadShellById: {},
      threadSessionById: {
        [threadId]: {
          status: "running",
          provider: "codex",
          runtimeMode: "full-access",
          activeTurnId: TurnId.makeUnsafe("pending-quit-turn"),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          orchestrationStatus: "running",
        },
      },
    });
    localStorage.setItem(
      appSettingsStorageKey,
      JSON.stringify({ resumeChatsAfterQuit: resumeAfterRestart }),
    );

    const queryClient = new QueryClient({
      defaultOptions: { queries: { enabled: false, retry: false } },
    });
    const screen = await render(
      <QueryClientProvider client={queryClient}>
        <ThemedQuitCoordinator />
      </QueryClientProvider>,
      { container },
    );
    try {
      request?.({ requestId: "pending-quit", presentation: "in-app" });
      await expect.element(page.getByRole("alertdialog")).toBeVisible();
      await expect
        .poll(() =>
          getComputedStyle(document.documentElement).getPropertyValue("--color-text-accent").trim(),
        )
        .not.toBe("");
      expect(reply).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: "pending-quit", phase: "ready", runningCount: 1 }),
      );
      await capture("initial");
      const quit = page.getByRole("button", { name: "Quit", exact: true });
      await quit.click();
      await expect.poll(() => prepareQuitResume.mock.calls.length).toBe(1);
      expect(prepareQuitResume).toHaveBeenCalledWith(
        expect.objectContaining({ threadIds: [threadId], resumeAfterRestart }),
      );
      if (variant === "after" || resumeAfterRestart) {
        await expect.element(page.getByRole("alertdialog")).toBeVisible();
        await expect.element(quit).toBeDisabled();
        await expect.element(page.getByRole("button", { name: /^Cancel/ })).toBeDisabled();
        await expect.element(page.getByRole("checkbox")).toBeDisabled();
      } else {
        await expect.element(page.getByRole("alertdialog")).not.toBeInTheDocument();
      }
      await capture("pending");
      expect(reply).not.toHaveBeenCalledWith(
        expect.objectContaining({ phase: "decision", allow: true }),
      );

      acknowledge();
      await expect
        .poll(() => reply.mock.calls)
        .toContainEqual([{ requestId: "pending-quit", phase: "decision", allow: true }]);
      await expect.element(page.getByRole("alertdialog")).not.toBeInTheDocument();
      expect(prepareQuitResume).toHaveBeenCalledTimes(1);
      expect(dispatchCommand).not.toHaveBeenCalled();
      await capture("acknowledged");
      console.log(
        "PR_UI_INTERACTION_RESULT " +
          JSON.stringify({
            variant,
            pr: 1809,
            resumeAfterRestart,
            prepareCalls: prepareQuitResume.mock.calls,
            replies: reply.mock.calls,
            boundary:
              "Actual quit coordinator UI with controlled acknowledgement. No native process cleanup or provider termination claim.",
          }),
      );
    } finally {
      acknowledge();
      await screen.unmount();
      queryClient.clear();
      host.remove();
    }
  },
);
