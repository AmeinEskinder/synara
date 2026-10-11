it("PR UI evidence: retention choices and accepted cache opt-out", async () => {
  const variant = import.meta.env.VITE_PR_UI_EVIDENCE_VARIANT;
  const directory = import.meta.env.VITE_PR_UI_EVIDENCE_DIR;
  expect(["before", "after"]).toContain(variant);
  expect(directory).toMatch(/^\//);
  localStorage.setItem("synara:server-settings-migrated:v1", "1");
  const mounted = await mountChatView({
    viewport: { ...DEFAULT_VIEWPORT, width: 1280, height: 900 },
    snapshot: createSnapshotForTargetUser({
      targetMessageId: MessageId.makeUnsafe("retention-settings-evidence"),
      targetText: "Review retention and cache settings",
    }),
  });
  const previousNativeApi = window.nativeApi;
  const api = readNativeApi();
  if (!api) throw new Error("Expected the existing controlled browser API fixture.");
  let savedSettings = createBrowserTestServerSettings(NOW_ISO);
  const updateSettings = vi.fn(async (patch: Record<string, unknown>) => {
    savedSettings = { ...savedSettings, ...patch };
    return savedSettings;
  });
  window.nativeApi = { ...api, server: { ...api.server, updateSettings } };
  const snapshot = async (name: string) => {
    await document.fonts.ready;
    await waitForLayout();
    await page.screenshot({ path: `${directory}/${name}.png` });
    await new Promise((done) => setTimeout(done, 700));
  };
  const revealSection = async (name: string) => {
    const heading = page.getByRole("heading", { name, exact: true });
    await expect.element(heading).toBeVisible();
    heading.element().scrollIntoView({ block: "start", behavior: "instant" });
    await waitForLayout();
  };
  try {
    await mounted.router.navigate({ to: "/settings", search: { section: "behavior" } });
    await revealSection("Conversation");
    const retention = page.getByRole("radiogroup", { name: "Archive idle threads", exact: true });
    if (variant === "after") {
      await expect
        .element(retention.getByRole("radio", { name: "7 days", exact: true }))
        .toHaveAttribute("aria-checked", "true");
    } else await expect.element(retention).not.toBeInTheDocument();
    await snapshot("conversation-default");
    if (variant === "after") {
      await retention.getByRole("radio", { name: "Never", exact: true }).click();
      await expect.poll(() => savedSettings.threadAutoArchive).toBe("never");
      await expect
        .element(retention.getByRole("radio", { name: "Never", exact: true }))
        .toHaveAttribute("aria-checked", "true");
      await snapshot("conversation-never");
    }
    await revealSection("Safety confirmations");
    const cache = page.getByRole("switch", {
      name: "Confirm expired Claude cache resume",
      exact: true,
    });
    if (variant === "after") await expect.element(cache).toHaveAttribute("aria-checked", "true");
    else await expect.element(cache).not.toBeInTheDocument();
    await snapshot("safety-default");
    if (variant === "after") {
      await cache.click();
      await expect.poll(() => savedSettings.confirmClaudeCacheResume).toBe(false);
      await expect.element(cache).toHaveAttribute("aria-checked", "false");
      await snapshot("safety-cache-off");
    }
  } finally {
    await mounted.cleanup();
    if (previousNativeApi) window.nativeApi = previousNativeApi;
    else delete window.nativeApi;
  }

  const { ComposerClaudeCacheReviewPanel } = await import("./chat/ComposerClaudeCacheReviewPanel");
  let accept!: () => void;
  const accepted = new Promise<void>((resolve) => {
    accept = resolve;
  });
  const onRespond = vi.fn(() => accepted);
  const onStopAsking = vi.fn(async () => undefined);
  const review = {
    reviewId: "review-retention-evidence",
    messageId: MessageId.makeUnsafe("cache-message-evidence"),
    sourceEventSequence: 1,
    assessment: {
      observedAt: NOW_ISO,
      state: "likely-expired",
      source: "session-start",
      contextTokens: 887_036,
    },
    status: "pending",
    createdAt: NOW_ISO,
  } as const;
  const host = document.createElement("div");
  Object.assign(host.style, {
    position: "fixed",
    inset: "0",
    padding: "24px",
    background: "var(--background)",
    color: "var(--foreground)",
  });
  document.body.append(host);
  const screen = await render(
    <div className="mx-auto flex h-full max-w-2xl flex-col justify-between gap-4">
      <header>
        <h1>Expired cache review</h1>
        <p>
          Production component with a synthetic assessment and controlled response acknowledgement.
        </p>
      </header>
      <ComposerClaudeCacheReviewPanel
        review={review}
        compactDisabledReason={null}
        onRespond={onRespond}
        onStopAsking={onStopAsking}
      />
    </div>,
    { container: host },
  );
  try {
    const optOut = page.getByRole("button", { name: /^Don't ask again/ });
    if (variant === "after") await expect.element(optOut).toBeVisible();
    else await expect.element(optOut).not.toBeInTheDocument();
    await snapshot("cache-review-options");
    if (variant === "after") {
      await optOut.click();
      expect(onRespond).toHaveBeenCalledExactlyOnceWith(review, "continue");
      expect(onStopAsking).not.toHaveBeenCalled();
      await expect.element(optOut).toBeDisabled();
      await snapshot("cache-review-awaiting-acceptance");
      accept();
      await expect.poll(() => onStopAsking.mock.calls.length).toBe(1);
      await expect.element(optOut).toBeDisabled();
    }
    console.log(
      "PR_UI_INTERACTION_RESULT " +
        JSON.stringify({
          variant,
          pr: 1713,
          settingsUpdates: updateSettings.mock.calls,
          optOutRequests: onRespond.mock.calls.length,
          preferenceSavedAfterAcceptance: onStopAsking.mock.calls.length,
          boundary:
            "Actual settings route and cache component with controlled settings RPC and response acknowledgement; no retention sweep or live Claude session claim.",
        }),
    );
  } finally {
    accept();
    await screen.unmount();
    host.remove();
  }
});
