it("PR UI evidence: actual rail selection and activation motion", async () => {
  const variant = import.meta.env.VITE_PR_UI_EVIDENCE_VARIANT;
  const directory = import.meta.env.VITE_PR_UI_EVIDENCE_DIR;
  expect(["before", "after"]).toContain(variant);
  expect(directory).toMatch(/^\//);
  const mounted = await mountChatView({
    viewport: { ...DEFAULT_VIEWPORT, width: 1280, height: 900 },
    snapshot: createSnapshotForTargetUser({
      targetMessageId: MessageId.makeUnsafe("evidence-rail-activation"),
      targetText: "Review navigation between primary sections",
    }),
  });
  try {
    const rail = page.getByRole("navigation", { name: "Primary" });
    await rail.getByRole("button", { name: "Home", exact: true }).click();
    await expect
      .element(rail.getByRole("button", { name: "Home", exact: true }))
      .toHaveAttribute("aria-current", "page");
    await document.fonts.ready;
    await page.screenshot({ path: `${directory}/rail-home.png` });
    await rail.getByRole("button", { name: "Spaces", exact: true }).click();
    await expect
      .element(rail.getByRole("button", { name: "Spaces", exact: true }))
      .toHaveAttribute("aria-current", "page");
    const railNode = document.querySelector<HTMLElement>('nav[aria-label="Primary"]');
    if (!railNode) throw new Error("Primary rail disappeared.");
    const indicator = railNode.querySelector<HTMLElement>('span[style*="translateY"]');
    if (variant === "after") {
      expect(indicator).not.toBeNull();
      expect(getComputedStyle(indicator!).transitionProperty).toContain("transform");
      const glyph = railNode.querySelector(".app-rail-icon-enter");
      expect(glyph).not.toBeNull();
      expect(getComputedStyle(glyph!).animationName).toBe("app-rail-icon-enter");
    } else {
      expect(indicator).toBeNull();
    }
    const animations = railNode
      .getAnimations({ subtree: true })
      .filter((animation) => Number.isFinite(animation.effect?.getTiming().iterations ?? 1));
    await Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)));
    if (indicator) {
      const selected = railNode.querySelector<HTMLElement>('button[aria-current="page"]');
      if (!selected) throw new Error("Selected rail item disappeared.");
      expect(
        Math.abs(indicator.getBoundingClientRect().top - selected.getBoundingClientRect().top),
      ).toBeLessThanOrEqual(1);
    }
    await page.screenshot({ path: `${directory}/rail-spaces.png` });
  } finally {
    await mounted.cleanup();
  }
});
