it("PR UI evidence: follow-up draft remains visible throughout promotion", async () => {
  const directory = import.meta.env.VITE_PR_UI_EVIDENCE_DIR;
  expect(directory).toMatch(/^\//);
  const restoreNativeApi = installDeterministicSendNativeApi();
  useComposerDraftStore.getState().setProjectDraftThreadId(PROJECT_ID, THREAD_ID);
  const mounted = await mountChatView({
    viewport: { ...DEFAULT_VIEWPORT, width: 1280, height: 900 },
    snapshot: createDraftOnlySnapshot(),
  });

  try {
    const prompt = "Keep the first message on screen";
    const draftCreatedAt = useComposerDraftStore.getState().getDraftThread(THREAD_ID)?.createdAt;
    expect(draftCreatedAt).toBeDefined();
    useComposerDraftStore.getState().setPrompt(THREAD_ID, prompt);
    const sendButton = await waitForSendButton();
    expect(sendButton.disabled).toBe(false);
    sendButton.click();
    const startCommand = await vi.waitFor(() => {
      const command = wsRequests
        .map(readDispatchedCommand)
        .find((candidate) => candidate?.type === "thread.turn.start");
      expect(command).toBeDefined();
      return command!;
    });
    const createCommand = wsRequests
      .map(readDispatchedCommand)
      .find((command) => command?.type === "thread.create");
    expect(createCommand?.createdAt).toBe(startCommand.createdAt);
    expect(createCommand?.createdAt).not.toBe(draftCreatedAt);
    const message = startCommand.message as { messageId: MessageId; text: string };
    const messageSelector = `[data-message-id="${message.messageId}"][data-message-role="user"]`;
    const expectTranscript = async () => {
      await waitForLayout();
      expect(document.querySelectorAll(messageSelector)).toHaveLength(1);
      expect(document.querySelector(messageSelector)?.textContent).toContain(prompt);
      expect(document.querySelector('[data-empty-landing-composer-block="true"]')).toBeNull();
      expect(mounted.router.state.location.pathname).toBe(`/${THREAD_ID}`);
    };
    await expectTranscript();

    const followUp = "Follow-up written while the first send is pending";
    await userEvent.click(await waitForComposerEditor());
    await userEvent.type(await waitForComposerEditor(), followUp);
    const expectFollowUpDraft = async () => {
      await vi.waitFor(async () => {
        expect(useComposerDraftStore.getState().draftsByThreadId[THREAD_ID]?.prompt).toBe(followUp);
        expect((await waitForComposerEditor()).textContent).toContain(followUp);
      });
    };
    await expectFollowUpDraft();
    await document.fonts.ready;
    await page.screenshot({ path: `${directory}/follow-up-awaiting-promotion.png` });

    const createdSnapshot = addThreadToSnapshot(fixture.snapshot, THREAD_ID);
    const createdThread = { ...createdSnapshot.threads[0]!, session: null };
    fixture.snapshot = { ...createdSnapshot, threads: [createdThread] };
    useStore.getState().syncServerShellSnapshot(createShellSnapshotFromReadModel(fixture.snapshot));
    await expectTranscript();
    useStore.getState().syncServerThreadDetailHotPath(createdThread);
    await expectTranscript();

    const startedThread = {
      ...createdThread,
      messages: [
        {
          ...createUserMessage({ id: message.messageId, text: message.text, offsetSeconds: 1 }),
          createdAt: startCommand.createdAt as string,
          updatedAt: startCommand.createdAt as string,
        },
      ],
    };
    fixture.snapshot = {
      ...fixture.snapshot,
      snapshotSequence: fixture.snapshot.snapshotSequence + 1,
      threads: [startedThread],
    };
    useStore.getState().syncServerThreadDetailHotPath(startedThread);
    useComposerDraftStore.getState().finalizePromotedDraftThread(THREAD_ID);
    await expectTranscript();
    await expectFollowUpDraft();

    // A creation snapshot can finish after the first message echo.
    useStore.getState().syncServerThreadDetailHotPath(createdThread);
    await expectTranscript();
    await expectFollowUpDraft();
    await page.screenshot({ path: `${directory}/follow-up-after-promotion.png` });
  } finally {
    await mounted.cleanup();
    restoreNativeApi();
  }
});
