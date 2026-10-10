it("PR UI evidence: Ctrl+Enter sends the first queued message from an empty composer", async () => {
  const variant = import.meta.env.VITE_PR_UI_EVIDENCE_VARIANT;
  const directory = import.meta.env.VITE_PR_UI_EVIDENCE_DIR;
  expect(["before", "after"]).toContain(variant);
  expect(directory).toMatch(/^\//);
  localStorage.setItem("synara:app-settings:v1", JSON.stringify({ followUpBehavior: "steer" }));
  const restoreNativeApi = installDeterministicSendNativeApi();
  for (const [id, prompt] of [
    ["first", "Review the focused repair"],
    ["second", "Keep the remaining work queued"],
  ] as const) {
    useComposerDraftStore.getState().enqueueQueuedTurn(THREAD_ID, {
      id,
      kind: "chat",
      createdAt: NOW_ISO,
      previewText: prompt,
      prompt,
      images: [],
      files: [],
      assistantSelections: [],
      browserAnnotations: [],
      terminalContexts: [],
      fileComments: [],
      pastedTexts: [],
      pullRequestContexts: [],
      skills: [],
      mentions: [],
      selectedProvider: "codex",
      selectedModel: "gpt-5",
      selectedPromptEffort: null,
      modelSelection: { provider: "codex", model: "gpt-5" },
      runtimeMode: "full-access",
      interactionMode: "default",
      envMode: "local",
    });
  }
  const mounted = await mountChatView({
    viewport: { ...DEFAULT_VIEWPORT, width: 1280, height: 900 },
    snapshot: createSnapshotForTargetUser({
      targetMessageId: MessageId.makeUnsafe("evidence-queued-shortcut"),
      targetText: "The current turn is running; two follow-ups are waiting.",
      sessionStatus: "running",
    }),
  });
  try {
    const editor = await waitForComposerEditor();
    await vi.waitFor(() => {
      expect(editor.textContent?.trim()).toBe("");
      expect(document.querySelectorAll('[data-testid="queued-follow-up-row"]')).toHaveLength(2);
    });
    await expect
      .element(page.getByText("Review the focused repair", { exact: true }))
      .toBeVisible();
    await expect
      .element(page.getByText("Keep the remaining work queued", { exact: true }))
      .toBeVisible();
    await userEvent.click(editor);
    await document.fonts.ready;
    await waitForLayout();
    await page.screenshot({ path: `${directory}/queue-before-shortcut.png` });

    // Send a real keyboard chord to the production Lexical composer. The same
    // Steer preference and queue are present on both immutable source checkouts.
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    await waitForLayout();
    await vi.waitFor(() => {
      const commands = wsRequests
        .map(readDispatchedCommand)
        .filter((command) => command?.type === "thread.turn.start");
      const queue = useComposerDraftStore.getState().draftsByThreadId[THREAD_ID]?.queuedTurns ?? [];
      if (variant === "after") {
        expect(commands).toHaveLength(1);
        expect(commands[0]).toMatchObject({
          dispatchMode: "steer",
          message: { text: "Review the focused repair" },
        });
        expect(queue.map((turn) => turn.id)).toEqual(["second"]);
        expect(document.querySelectorAll('[data-testid="queued-follow-up-row"]')).toHaveLength(1);
      } else {
        expect(commands).toHaveLength(0);
        expect(queue.map((turn) => turn.id)).toEqual(["first", "second"]);
        expect(document.querySelectorAll('[data-testid="queued-follow-up-row"]')).toHaveLength(2);
      }
    });
    await expect
      .element(page.getByText("Keep the remaining work queued", { exact: true }))
      .toBeVisible();
    await waitForLayout();
    await page.screenshot({ path: `${directory}/queue-after-shortcut.png` });

    await mounted.router.navigate({ to: "/settings", search: { section: "behavior" } });
    const description =
      variant === "after"
        ? "Choose whether messages sent during an active turn wait in the queue or steer the current run. For a new message, Ctrl/Cmd+Enter uses the opposite behavior once. With an empty composer and queued messages, it always steers the first queued message."
        : "Choose whether messages sent during an active turn wait in the queue or steer the current run. Ctrl/Cmd+Enter uses the opposite behavior for one message.";
    await expect.element(page.getByText(description, { exact: true })).toBeVisible();
    await expect
      .element(
        page
          .getByRole("radiogroup", { name: "Follow-up behavior", exact: true })
          .getByRole("radio", { name: "Steer", exact: true }),
      )
      .toHaveAttribute("aria-checked", "true");
    await waitForLayout();
    await page.screenshot({ path: `${directory}/follow-up-shortcut-settings.png` });
  } finally {
    await mounted.cleanup();
    restoreNativeApi();
  }
});
