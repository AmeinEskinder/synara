it("PR UI evidence: two configured automations and three unresolved runs", async () => {
  const variant = import.meta.env.VITE_PR_UI_EVIDENCE_VARIANT;
  const directory = import.meta.env.VITE_PR_UI_EVIDENCE_DIR;
  expect(["before", "after"]).toContain(variant);
  expect(directory).toMatch(/^\//);
  const { AutomationRunId } = await import("@synara/contracts");
  const { automationQueryKey } = await import("../routes/-automations.shared");
  const definitions = ["Review build logs", "Prepare release notes"].map((name, index) => ({
    ...createAutomationDefinitionFromCreateRequest({
      _tag: WS_METHODS.automationCreate,
      projectId: PROJECT_ID,
      name,
      prompt: name,
      schedule: { type: "interval", everySeconds: 3_600 },
      modelSelection: { provider: "codex", model: "gpt-5" },
    }),
    id: AutomationId.makeUnsafe(`evidence-automation-${index}`),
  }));
  const runs: import("@synara/contracts").AutomationRun[] = Array.from(
    { length: 3 },
    (_, index) => ({
      id: AutomationRunId.makeUnsafe(`evidence-run-${index}`),
      automationId: definitions[index % definitions.length]!.id,
      projectId: PROJECT_ID,
      threadId: THREAD_ID,
      turnId: null,
      trigger: { type: "scheduled" },
      status: "failed",
      scheduledFor: NOW_ISO,
      claimedBy: null,
      claimedAt: null,
      leaseExpiresAt: null,
      startedAt: NOW_ISO,
      finishedAt: NOW_ISO,
      threadCreateCommandId: null,
      turnStartCommandId: null,
      messageId: null,
      error: "Synthetic fixture: build review needs attention",
      result: null,
      permissionSnapshot: {
        provider: "codex",
        modelSelection: { provider: "codex", model: "gpt-5" },
        runtimeMode: "approval-required",
        interactionMode: "default",
        worktreeMode: "auto",
        allowedCapabilities: ["send-turn"],
        createdAt: NOW_ISO,
      },
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
    }),
  );
  const data = { definitions, runs };
  const mounted = await mountChatView({
    viewport: { ...DEFAULT_VIEWPORT, width: 1280, height: 900 },
    snapshot: createSnapshotForTargetUser({
      targetMessageId: MessageId.makeUnsafe("evidence-automation-count"),
      targetText: "Review the configured automations",
    }),
  });
  const descriptor = Object.getOwnPropertyDescriptor(window, "nativeApi");
  try {
    const api = readNativeApi();
    if (!api) throw new Error("Expected the real browser fixture API.");
    Object.defineProperty(window, "nativeApi", {
      configurable: true,
      value: { ...api, automation: { ...api.automation, list: async () => data } },
    });
    await mounted.router.options.context.queryClient.cancelQueries({
      queryKey: automationQueryKey,
    });
    mounted.router.options.context.queryClient.setQueryData(automationQueryKey, data);
    await mounted.router.navigate({ to: "/automations" });
    await expect.element(page.getByText("Review build logs", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Prepare release notes", { exact: true })).toBeVisible();
    const label =
      variant === "after"
        ? "Automations · 2 automations"
        : "Automations · 3 automations need attention";
    const button = page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: label, exact: true });
    await expect.element(button).toHaveAttribute("aria-current", "page");
    await button.hover();
    await expect.element(page.getByRole("tooltip")).toHaveTextContent(label);
    await document.fonts.ready;
    await page.screenshot({ path: `${directory}/automation-count.png` });
  } finally {
    if (descriptor) Object.defineProperty(window, "nativeApi", descriptor);
    else Reflect.deleteProperty(window, "nativeApi");
    await mounted.cleanup();
  }
});
