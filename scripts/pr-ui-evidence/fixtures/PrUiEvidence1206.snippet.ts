it("PR UI evidence: Ctrl+Enter sends the first queued message from an empty composer", async () => {
  const variant = import.meta.env.VITE_PR_UI_EVIDENCE_VARIANT;
  const directory = import.meta.env.VITE_PR_UI_EVIDENCE_DIR;
  expect(["before", "after"]).toContain(variant);
  expect(directory).toMatch(/^\//);
  localStorage.setItem("synara:app-settings:v1", JSON.stringify({ followUpBehavior: "steer" }));
  const restoreNativeApi = installDeterministicSendNativeApi();
  const diagnosticApi = readNativeApi();
  expect(diagnosticApi).toBeDefined();
  const diagnosticStartedAt = performance.now();
  const targetMessageId = MessageId.makeUnsafe("evidence-queued-shortcut");
  const diagnosticStates: unknown[] = [];
  const diagnosticThreadEvents: unknown[] = [];
  const diagnosticShellEvents: unknown[] = [];
  let diagnosticStateSignature = "";
  let diagnosticDropped = 0;
  const recordDiagnostic = (records: unknown[], value: unknown) => {
    if (records.length < 48) records.push(value);
    else diagnosticDropped += 1;
  };
  const recordDiagnosticState = () => {
    const state = useStore.getState();
    const value = {
      shellSequence: state.shellSnapshotSequence,
      threadPresent: state.threadIds?.includes(THREAD_ID) ?? false,
      messageCount: state.messageIdsByThreadId?.[THREAD_ID]?.length ?? 0,
      targetPresent: state.messageIdsByThreadId?.[THREAD_ID]?.includes(targetMessageId) ?? false,
      detailSync: state.threadDetailSyncById?.[THREAD_ID] ?? null,
      appliedSequence: state.threadDetailAppliedSequenceById?.[THREAD_ID] ?? null,
      sessionStatus: state.threadSessionById?.[THREAD_ID]?.status ?? null,
    };
    const signature = JSON.stringify(value);
    if (signature === diagnosticStateSignature) return;
    diagnosticStateSignature = signature;
    recordDiagnostic(diagnosticStates, {
      elapsedMs: performance.now() - diagnosticStartedAt,
      ...value,
    });
  };
  recordDiagnosticState();
  const stopDiagnosticState = useStore.subscribe(recordDiagnosticState);
  const stopDiagnosticThread = diagnosticApi!.orchestration.onThreadEvent((item) => {
    recordDiagnostic(diagnosticThreadEvents, {
      elapsedMs: performance.now() - diagnosticStartedAt,
      kind: item.kind,
      ...(item.kind === "snapshot"
        ? {
            threadId: item.snapshot.thread.id,
            sequence: item.snapshot.snapshotSequence,
            messageCount: item.snapshot.thread.messages.length,
            targetPresent: item.snapshot.thread.messages.some(
              (message) => message.id === targetMessageId,
            ),
          }
        : {}),
    });
  });
  const stopDiagnosticShell = diagnosticApi!.orchestration.onShellEvent((item) => {
    recordDiagnostic(diagnosticShellEvents, {
      elapsedMs: performance.now() - diagnosticStartedAt,
      kind: item.kind,
      ...(item.kind === "snapshot"
        ? { sequence: item.snapshot.snapshotSequence, threadCount: item.snapshot.threads.length }
        : {}),
    });
  });
  // Observation only: keep the original mount guard, fixture responses, and
  // shortcut assertions intact. A passing observed run cannot explain the
  // earlier unobserved hydration failure by itself.
  let mounted: MountedChatView | undefined;
  let captureStage = "preparing";
  try {
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
    captureStage = "mounting";
    mounted = await mountChatView({
      viewport: { ...DEFAULT_VIEWPORT, width: 1280, height: 900 },
      snapshot: createSnapshotForTargetUser({
        targetMessageId,
        targetText: "The current turn is running; two follow-ups are waiting.",
        sessionStatus: "running",
      }),
    });
    captureStage = "hydrated";
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
    captureStage = "captured";
  } finally {
    recordDiagnosticState();
    stopDiagnosticState();
    stopDiagnosticThread();
    stopDiagnosticShell();
    const requestCounts: Record<string, number> = {};
    const threadRequests: unknown[] = [];
    for (const request of wsRequests) {
      requestCounts[request._tag] = (requestCounts[request._tag] ?? 0) + 1;
      if (request._tag.startsWith("orchestration.") && "threadId" in request) {
        recordDiagnostic(threadRequests, {
          tag: request._tag,
          threadId: request.threadId,
          afterSequence: request.afterSequence ?? null,
          fromSequenceExclusive: request.fromSequenceExclusive ?? null,
          batchReplay: request.batchReplay ?? null,
          messageWindow: request.messageWindow ?? null,
        });
      }
    }
    console.log(
      "SYNARA_QUEUED_SHORTCUT_HYDRATION " +
        JSON.stringify({
          variant,
          captureStage,
          expectedSequence: fixture.snapshot.snapshotSequence,
          expectedMessageCount:
            fixture.snapshot.threads.find((thread) => thread.id === THREAD_ID)?.messages.length ??
            0,
          requestCounts,
          threadRequests,
          states: diagnosticStates,
          threadEvents: diagnosticThreadEvents,
          shellEvents: diagnosticShellEvents,
          droppedRecords: diagnosticDropped,
        }),
    );
    try {
      await mounted?.cleanup();
    } finally {
      restoreNativeApi();
    }
  }
});
