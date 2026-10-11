# Source-pinned UI Before / After review evidence

These captures render actual production components and CSS in Chromium with controlled test data. They are not generated mockups. Each pair imports the application at the exact source below, keeps production files unchanged, and records fixture overlays, images, video hashes, and observed interactions in `provenance.json`. Actions archives were verified against their recorded SHA-256 before extraction. Screenshots show the light theme supplied by the production theme hook. Native/provider effects remain separate evidence boundaries.

## #1713 — retention and expired-cache settings

- Before: `907161a60bbb4b16d53feec693eafd2c7e1b66a0` (tree `dd18cd280d50366d57ceb6d300c2528ed7796e63`).
- After: `4112a2f6e9f7eaf100dd874f5be4ff0469a9ce40` (tree `ddde93c61dc0ddbe309d95fc774b95c581f3d9c4`).
- Independently reviewed driver: `7462a34507a281d094da4c81a5bccc6932545a0c`.
- [Run 38151354117](https://github.com/Emanuele-web04/synara/actions/runs/38151354117): both settings capture jobs passed. The separate #1809 negative-control job intentionally remains failed; the whole run is not described as green.

The actual Settings route shows the new Archive idle threads choice, default 7 days, and an actual pointer selection of Never produces the expected server-settings patch. The actual Expired Claude cache confirmation switch starts enabled; clicking it sends `confirmClaudeCacheResume: false`. Before has neither control. The actual cache-review panel adds Don't ask again. While its controlled response acknowledgement is pending, the action is disabled, one continuation has been submitted and the preference has not yet been saved; only accepted continuation permits that preference write.

Files under `pr1713/before` and `pr1713/after` include all screenshots and short interaction MP4s. `pr1713/review-clips.json` specifies the raw recording hashes and exact trims. The MP4s only remove browser setup time and encode to H264; they preserve the full recorded frame, ordinary speed, and source interactions. The original raw recordings remain in the Actions artifacts. This component/route evidence does not execute a retention sweep, persist a real settings file, or use a live Claude session; those backend contracts are covered separately by source review and tests.

## #1817 / original #1801 — permission menu

- Before: `09bba9fa4cb1f109d6fe0763f59311317817f5db` (tree `0ca0c49a51c2345ca0685476f3c70a88ffdedc11`).
- After: `8e165a40165ddeb3c6384deca97a967eb569d380` (tree `a3566f92415667868750c7dbbd389eee3fdae45b`).
- Reviewed driver lineage: `96844cce03ed762bb8194172de3bbd3a8fdc501e`, following `18fe14f36a5579224b0f2bd12b3f03c6ed37804b`.
- [Run 38152150739](https://github.com/Emanuele-web04/synara/actions/runs/38152150739): both captures passed.

The actual permission component uses the production theme hook with controlled provider state and an app-capture bridge. Real menu clicks verify that choosing a new mode or the selected mode closes the menu only in After. Selecting the same mode does not call the mode-change callback again. The checked background is independent of the Full access accent; the current choice remains clear. The Full access description retains its horizontal position, width and height when the check moves; Before loses 20px of width. Both narrow 360px captures keep the menu within the viewport. Share current app emits its separate event once, closes the menu, and leaves the permission mode unchanged.

All six screenshots and the unmodified short browser recording for each variant are included. This is a component interaction capture, not a live provider or native screen-capture result. The source labels intentionally remain the captured commits even if a later main merge incorporates their code.

Historical fixture failures remain in Actions: [38150132837](https://github.com/Emanuele-web04/synara/actions/runs/38150132837) attempted a pointer target made inert by the modal menu; [38150606473](https://github.com/Emanuele-web04/synara/actions/runs/38150606473) hit a clipped rounded corner; [38151094934](https://github.com/Emanuele-web04/synara/actions/runs/38151094934) exposed missing theme projection in Before; [38151635906](https://github.com/Emanuele-web04/synara/actions/runs/38151635906) exposed the missing controlled setTheme adapter. The final fixture uses a real visible separator pointer target, invokes production useTheme, and supplies its required asynchronous bridge adapter. No production assertions were removed or recolored to obtain the result.

## #1809 — keep Quit dialog pending until acknowledgement

- Before: `22bcafdc965ce7e4ef253b2cd5bd05dc5671cc05` (tree `8bb6019499c3d9cf29b0022fdcb2406419a4d2d9`).
- After: `869e40c4bf989f936fca4c59c32dac0ab4bcb27b` (tree `0ec9f4933b058438fc120f68b0668f3118744a97`).
- Independently reviewed capture driver: `af8e6f56f558abfb920d0db0124fe2c2559d3da9`, first parent `7462a34507a281d094da4c81a5bccc6932545a0c`.
- [Final themed capture run 38152588503](https://github.com/Emanuele-web04/synara/actions/runs/38152588503): both captures passed.

The production quit coordinator, dialog and bounded admission helper run with one controlled native-API acknowledgement. With Resume chat automatically unchecked, Before clears the dialog immediately after Quit; After retains it with Quit, Cancel and the checkbox disabled. With Resume checked, both retain the pending dialog. Neither variant sends allow=true before acknowledgement; each sends one matching prepare request and one allow decision after acknowledgement, without the legacy dispatch path. Initial, pending and acknowledged screenshots for both choices, plus unmodified short recordings, are included. The visible white fixture backdrop is intentional and labelled. No native process cleanup or provider termination follows from these pixels.

### Unchanged regression negative control

[Run 38151354117, job 114505754372](https://github.com/Emanuele-web04/synara/actions/runs/38151354117/job/114505754372) runs the exact three-test published regression fixture on Before source `22bcafdc...`. One test fails: the unchecked-resume case cannot find the disabled Quit button because the dialog has vanished. The other two pass. Actual Vitest exit 1, log exit 0, the failed provenance, complete test output and exact test source are included under `pr1809/control`. The source fixture is unchanged blob `3fd5ad4361c400db8d0e08647e70d8a12acb343d`, SHA-256 `ada04ac36a21653fa23cd590a6822b9c984d6bd1385a85944cc8e22d33924ea0`.

The four positive captures in that earlier run passed, but its standalone quit fixture had not initialized the production theme. Those diagnostic screenshots are retained in their original artifacts. The final run adds only production theme setup and selects the two positive source variants; it does not rewrite the earlier failing control into a pass. The repaired feature's canonical CI remains a separate exact-head record on #1809.
