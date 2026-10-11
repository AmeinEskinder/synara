it("PR UI evidence: recorded rail transition and real reduced-motion preference", async () => {
  const variant = import.meta.env.VITE_PR_UI_EVIDENCE_VARIANT;
  const directory = import.meta.env.VITE_PR_UI_EVIDENCE_DIR;
  const motion = import.meta.env.VITE_PR_UI_MOTION_MODE;
  expect(["before", "after"]).toContain(variant);
  expect(["no-preference", "reduce"]).toContain(motion);
  expect(directory).toMatch(/^\//);
  expect(matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(motion === "reduce");
  const mounted = await mountChatView({
    viewport: { ...DEFAULT_VIEWPORT, width: 1280, height: 900 },
    snapshot: createSnapshotForTargetUser({
      targetMessageId: MessageId.makeUnsafe("evidence-rail-activation"),
      targetText: "Review navigation between primary sections",
    }),
  });
  let sampling = false;
  try {
    const rail = page.getByRole("navigation", { name: "Primary" });
    const home = rail.getByRole("button", { name: "Home", exact: true });
    const spaces = rail.getByRole("button", { name: "Spaces", exact: true });
    await home.click();
    await expect.element(home).toHaveAttribute("aria-current", "page");
    await document.fonts.ready;
    const railNode = document.querySelector<HTMLElement>('nav[aria-label="Primary"]');
    if (!railNode) throw new Error("Primary rail disappeared.");
    const indicator = railNode.querySelector<HTMLElement>('span[style*="translateY"]');
    const settle = async () => {
      await Promise.all(
        railNode
          .getAnimations({ subtree: true })
          .filter((animation) => Number.isFinite(animation.effect?.getTiming().iterations ?? 1))
          .map((animation) => animation.finished),
      );
      await new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      );
    };
    await settle();
    if (variant === "after") {
      expect(indicator).not.toBeNull();
      if (motion === "reduce") expect(getComputedStyle(indicator!).transitionProperty).toBe("none");
      else expect(getComputedStyle(indicator!).transitionProperty).toContain("transform");
      const glyph = railNode.querySelector(".app-rail-icon-enter");
      expect(glyph).not.toBeNull();
      expect(getComputedStyle(glyph!).animationName).toBe(
        motion === "reduce" ? "none" : "app-rail-icon-enter",
      );
    } else {
      expect(indicator).toBeNull();
    }
    await page.screenshot({ path: `${directory}/rail-${motion}-home.png` });
    await new Promise((done) => setTimeout(done, 700));
    const frames: Array<{ t: number; top: number | null; scale: number; selected: string | null }> =
      [];
    const started = performance.now();
    const frame = () => {
      const glyph = railNode.querySelector(".app-rail-icon-enter");
      const transform = glyph ? getComputedStyle(glyph).transform : "none";
      frames.push({
        t: performance.now() - started,
        top: indicator?.getBoundingClientRect().top ?? null,
        scale: transform === "none" ? 1 : new DOMMatrixReadOnly(transform).a,
        selected:
          railNode.querySelector('button[aria-current="page"]')?.getAttribute("aria-label") ?? null,
      });
      if (sampling) requestAnimationFrame(frame);
    };
    sampling = true;
    frame();
    await spaces.click();
    await expect.element(spaces).toHaveAttribute("aria-current", "page");
    await settle();
    await new Promise((done) => setTimeout(done, 700));
    sampling = false;
    const selected = railNode.querySelector<HTMLElement>('button[aria-current="page"]');
    if (!selected) throw new Error("Selected rail item disappeared.");
    if (indicator) {
      expect(
        Math.abs(indicator.getBoundingClientRect().top - selected.getBoundingClientRect().top),
      ).toBeLessThanOrEqual(1);
      const start = frames[0].top!;
      const end = indicator.getBoundingClientRect().top;
      expect(Math.abs(end - start)).toBeGreaterThan(5);
      const intermediate = frames.filter(
        ({ top }) =>
          top !== null && top > Math.min(start, end) + 0.5 && top < Math.max(start, end) - 0.5,
      );
      if (motion === "reduce") {
        expect(intermediate).toHaveLength(0);
        expect(frames.every(({ scale }) => Math.abs(scale - 1) < 0.001)).toBe(true);
      } else {
        expect(intermediate.length).toBeGreaterThan(0);
        expect(frames.some(({ scale }) => Math.abs(scale - 1) > 0.02)).toBe(true);
      }
    }
    console.log("PR_RAIL_MOTION_RESULT " + JSON.stringify({ variant, motion, frames }));
    await page.screenshot({ path: `${directory}/rail-${motion}-spaces.png` });
    // Repeat visible actions for a short review recording; time and styles are unchanged.
    for (const button of [home, spaces, home]) {
      await button.click();
      await expect.element(button).toHaveAttribute("aria-current", "page");
      await settle();
      await new Promise((done) => setTimeout(done, 700));
    }
  } finally {
    sampling = false;
    await mounted.cleanup();
  }
});
