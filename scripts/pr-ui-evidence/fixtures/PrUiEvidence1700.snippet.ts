it("PR UI evidence: the same Escape action from the actual Settings page", async () => {
  const variant = import.meta.env.VITE_PR_UI_EVIDENCE_VARIANT;
  const directory = import.meta.env.VITE_PR_UI_EVIDENCE_DIR;
  expect(["before", "after"]).toContain(variant);
  expect(directory).toMatch(/^\//);
  const mounted = await mountChatView({
    viewport: { ...DEFAULT_VIEWPORT, width: 1280, height: 900 },
    snapshot: createSnapshotForTargetUser({
      targetMessageId: MessageId.makeUnsafe("evidence-settings-escape"),
      targetText: "Return Home from Settings",
    }),
  });
  try {
    const rail = page.getByRole("navigation", { name: "Primary" });
    await rail.getByRole("button", { name: "Settings", exact: true }).click();
    await expect.poll(() => mounted.router.state.location.pathname).toBe("/settings");
    await expect
      .element(rail.getByRole("button", { name: "Settings", exact: true }))
      .toHaveAttribute("aria-current", "page");
    await document.fonts.ready;
    await page.screenshot({ path: `${directory}/settings-before-key.png` });
    await userEvent.keyboard("{Escape}");
    if (variant === "after") {
      await expect.poll(() => mounted.router.state.location.pathname).not.toBe("/settings");
      await expect
        .element(rail.getByRole("button", { name: "Home", exact: true }))
        .toHaveAttribute("aria-current", "page");
    } else {
      await waitForLayout();
      expect(mounted.router.state.location.pathname).toBe("/settings");
      await expect
        .element(rail.getByRole("button", { name: "Settings", exact: true }))
        .toHaveAttribute("aria-current", "page");
    }
    await page.screenshot({ path: `${directory}/settings-after-key.png` });
  } finally {
    await mounted.cleanup();
  }
});
