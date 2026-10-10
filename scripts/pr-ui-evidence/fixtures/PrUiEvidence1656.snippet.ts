it("PR UI evidence: active-workspace files in the actual sidebar search", async () => {
  const variant = import.meta.env.VITE_PR_UI_EVIDENCE_VARIANT;
  const directory = import.meta.env.VITE_PR_UI_EVIDENCE_DIR;
  expect(["before", "after"]).toContain(variant);
  expect(directory).toMatch(/^\//);
  const workspace = "/repo/worktrees/review-auth";
  const initial = createSnapshotForTargetUser({
    targetMessageId: MessageId.makeUnsafe("evidence-auth-review"),
    targetText: "Review authentication",
  });
  const snapshot = {
    ...initial,
    threads: initial.threads.map((thread) =>
      thread.id === THREAD_ID
        ? { ...thread, title: "Review authentication", worktreePath: workspace }
        : thread,
    ),
  };
  const mounted = await mountChatView({
    viewport: { ...DEFAULT_VIEWPORT, width: 1280, height: 900 },
    snapshot,
  });
  const descriptor = Object.getOwnPropertyDescriptor(window, "nativeApi");
  try {
    const api = readNativeApi();
    if (!api) throw new Error("Expected the real browser fixture API.");
    const searchEntries = vi.fn(async () => ({
      entries: [
        { path: "src/auth/session.ts", kind: "file" as const },
        { path: "src/auth/session.test.ts", kind: "file" as const },
      ],
      truncated: false,
    }));
    Object.defineProperty(window, "nativeApi", {
      configurable: true,
      value: {
        ...api,
        projects: { ...api.projects, searchEntries },
        orchestration: { ...api.orchestration, searchThreads: async () => ({ matches: [] }) },
      },
    });
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByPlaceholder("Search chats or run a command").fill("session");
    if (variant === "after") {
      await expect.element(page.getByRole("option", { name: /session\.ts/ })).toBeVisible();
      expect(searchEntries).toHaveBeenCalledWith({
        cwd: workspace,
        query: "session",
        limit: 30,
        kind: "file",
      });
    } else {
      await expect.element(page.getByRole("status")).toHaveTextContent("No results");
      await expect
        .element(page.getByRole("option", { name: /session\.ts/ }))
        .not.toBeInTheDocument();
    }
    await document.fonts.ready;
    await page.screenshot({ path: `${directory}/active-workspace-search.png` });
  } finally {
    if (descriptor) Object.defineProperty(window, "nativeApi", descriptor);
    else Reflect.deleteProperty(window, "nativeApi");
    await mounted.cleanup();
  }
});
