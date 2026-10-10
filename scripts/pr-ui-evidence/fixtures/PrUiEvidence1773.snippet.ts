it("PR UI evidence: diff layout in the actual Settings route", async () => {
  const variant = import.meta.env.VITE_PR_UI_EVIDENCE_VARIANT;
  const directory = import.meta.env.VITE_PR_UI_EVIDENCE_DIR;
  expect(["before", "after"]).toContain(variant);
  expect(directory).toMatch(/^\//);
  localStorage.setItem("synara:diff-render-mode:v1", JSON.stringify("stacked"));
  const mounted = await mountChatView({
    viewport: { ...DEFAULT_VIEWPORT, width: 1280, height: 900 },
    snapshot: createSnapshotForTargetUser({
      targetMessageId: MessageId.makeUnsafe("evidence-diff-default"),
      targetText: "Review the default diff layout",
    }),
  });
  try {
    await mounted.router.navigate({ to: "/settings", search: { section: "behavior" } });
    await expect.element(page.getByRole("heading", { name: "Review", exact: true })).toBeVisible();
    const section = [...document.querySelectorAll("h2")]
      .find((heading) => heading.textContent === "Review")
      ?.closest("section");
    if (!section) throw new Error("Review settings did not mount.");
    section.scrollIntoView({ block: "center" });
    await waitForLayout();
    await expect
      .element(page.getByText("Open pull requests and issues", { exact: true }))
      .toBeVisible();
    if (variant === "after") {
      const choices = page.getByRole("radiogroup", { name: "Diff layout", exact: true });
      await expect
        .element(choices.getByRole("radio", { name: "Stacked", exact: true }))
        .toHaveAttribute("aria-checked", "true");
    } else {
      await expect
        .element(page.getByRole("radiogroup", { name: "Diff layout", exact: true }))
        .not.toBeInTheDocument();
    }
    await document.fonts.ready;
    await page.screenshot({ path: `${directory}/review-settings.png` });
    if (variant === "after") {
      await page.getByRole("button", { name: "Reset diff layout to default", exact: true }).click();
      await expect
        .element(
          page
            .getByRole("radiogroup", { name: "Diff layout" })
            .getByRole("radio", { name: "Split", exact: true }),
        )
        .toHaveAttribute("aria-checked", "true");
      expect(localStorage.getItem("synara:diff-render-mode:v1")).toBe(JSON.stringify("split"));
      await page.screenshot({ path: `${directory}/review-settings-reset.png` });
    }
  } finally {
    await mounted.cleanup();
  }
});
