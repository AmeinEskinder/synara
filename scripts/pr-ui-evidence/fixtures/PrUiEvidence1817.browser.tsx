import "../index.css";
import { useState } from "react";
import { ProviderInstanceId, type RuntimeMode } from "@synara/contracts";
import { page } from "vitest/browser";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { REQUEST_CURRENT_APP_SNAP_EVENT } from "../appSnap.logic";
import { useTheme } from "../hooks/useTheme";
import { RuntimeUsageControls } from "./BranchToolbar";

it("PR UI evidence: actual permission selection, stable description and separate capture action", async () => {
  const variant = import.meta.env.VITE_PR_UI_EVIDENCE_VARIANT;
  const directory = import.meta.env.VITE_PR_UI_EVIDENCE_DIR;
  expect(["before", "after"]).toContain(variant);
  expect(directory).toMatch(/^\//);
  await page.viewport(760, 680);
  const changes = vi.fn();
  const captureRequests = vi.fn();
  const previousBridge = Object.getOwnPropertyDescriptor(window, "desktopBridge");
  Object.defineProperty(window, "desktopBridge", {
    configurable: true,
    value: { appSnap: { captureCurrentApp: vi.fn() } },
  });
  window.addEventListener(REQUEST_CURRENT_APP_SNAP_EVENT, captureRequests);
  const host = document.createElement("div");
  Object.assign(host.style, {
    position: "fixed",
    inset: "0",
    padding: "24px",
    background: "var(--background)",
    color: "var(--foreground)",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    fontFamily: "var(--font-system-ui)",
  });
  document.body.append(host);
  function Controls() {
    useTheme();
    const [mode, setMode] = useState<RuntimeMode>("auto");
    return (
      <>
        <header>
          <h1>Permission mode review</h1>
          <p>
            Isolated production component. Provider state and app-capture bridge are controlled.
          </p>
        </header>
        <div>
          <p data-testid="evidence-mode">Selected mode: {mode}</p>
          <RuntimeUsageControls
            provider="codex"
            providerStatus={{
              provider: "codex",
              driver: "codex",
              instanceId: ProviderInstanceId.makeUnsafe("codex"),
              status: "ready",
              available: true,
              authStatus: "authenticated",
              checkedAt: "2026-10-11T00:00:00.000Z",
              supportsAutoRuntimeMode: true,
            }}
            runtimeMode={mode}
            onRuntimeModeChange={(value) => {
              changes(value);
              setMode(value);
            }}
          />
        </div>
      </>
    );
  }
  const screen = await render(<Controls />, { container: host });
  const clearPointerHighlight = async () => {
    // A modal menu makes the outside page inert and clips its rounded corners.
    // Its visible separator is a non-item target that clears row highlighting.
    if (document.querySelector('[role="menu"]')) {
      await page.getByRole("separator").hover({ timeout: 5_000 });
    } else {
      await page.getByRole("heading", { name: "Permission mode review" }).hover({ timeout: 5_000 });
    }
  };
  const snapshot = async (name: string) => {
    await clearPointerHighlight();
    await document.fonts.ready;
    await new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done())),
    );
    await page.screenshot({ path: `${directory}/${name}.png` });
    await new Promise((done) => setTimeout(done, 600));
  };
  try {
    await page.getByRole("button").click();
    await expect
      .poll(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--color-text-accent").trim(),
      )
      .not.toBe("");
    const auto = page.getByRole("menuitemradio", { name: /Approve for me/ });
    const full = page.getByRole("menuitemradio", { name: /Full access/ });
    const ask = page.getByRole("menuitemradio", { name: /Ask for approval/ });
    await expect.element(auto).toHaveAttribute("aria-checked", "true");
    await clearPointerHighlight();
    const color = (item: typeof auto) => getComputedStyle(item.element()).color;
    expect(color(full)).not.toBe(color(ask));
    if (variant === "after") {
      expect(color(auto)).toBe(color(ask));
      expect(getComputedStyle(auto.element()).backgroundColor).not.toBe(
        getComputedStyle(full.element()).backgroundColor,
      );
    } else expect(color(auto)).not.toBe(color(ask));
    const description = () =>
      full.element().querySelector(".runtime-mode-menu-description")!.getBoundingClientRect();
    const before = description();
    await snapshot("menu-auto-760px");
    await full.click();
    await expect
      .element(page.getByTestId("evidence-mode"))
      .toHaveTextContent("Selected mode: full-access");
    expect(changes).toHaveBeenCalledExactlyOnceWith("full-access");
    if (variant === "after") await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
    else await expect.element(page.getByRole("menu")).toBeVisible();
    await snapshot("new-selection-result-760px");
    if (variant === "after") await page.getByRole("button").click();
    await expect.element(full).toHaveAttribute("aria-checked", "true");
    const selected = description();
    if (variant === "after") {
      expect(selected.x).toBe(before.x);
      expect(selected.width).toBe(before.width);
      expect(selected.height).toBe(before.height);
    } else expect(selected.width).toBeLessThan(before.width);
    await snapshot("menu-full-760px");
    await full.click();
    expect(changes).toHaveBeenCalledTimes(1);
    if (variant === "after") await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
    else await expect.element(page.getByRole("menu")).toBeVisible();
    await snapshot("selected-choice-result-760px");
    if (variant === "after") await page.getByRole("button").click();
    await page.getByRole("menuitem", { name: "Share current app", exact: true }).click();
    expect(captureRequests).toHaveBeenCalledTimes(1);
    expect(changes).toHaveBeenCalledTimes(1);
    await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
    await expect
      .element(page.getByTestId("evidence-mode"))
      .toHaveTextContent("Selected mode: full-access");
    await snapshot("share-action-result-760px");
    await page.viewport(360, 680);
    await page.getByRole("button").click();
    await expect.element(full).toHaveAttribute("aria-checked", "true");
    const narrowMenu = page.getByRole("menu").element().getBoundingClientRect();
    expect(narrowMenu.left).toBeGreaterThanOrEqual(0);
    expect(narrowMenu.right).toBeLessThanOrEqual(innerWidth);
    await snapshot("menu-full-360px");
    console.log(
      "PR_PERMISSION_MENU_RESULT " +
        JSON.stringify({
          variant,
          before: { x: before.x, width: before.width, height: before.height },
          selected: { x: selected.x, width: selected.width, height: selected.height },
          modeChanges: changes.mock.calls,
          captureRequests: captureRequests.mock.calls.length,
          narrowMenu: { left: narrowMenu.left, right: narrowMenu.right },
        }),
    );
  } finally {
    await screen.unmount();
    host.remove();
    window.removeEventListener(REQUEST_CURRENT_APP_SNAP_EVENT, captureRequests);
    if (previousBridge) Object.defineProperty(window, "desktopBridge", previousBridge);
    else Reflect.deleteProperty(window, "desktopBridge");
  }
});
