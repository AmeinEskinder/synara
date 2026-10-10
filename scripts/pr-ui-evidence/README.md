# Isolated PR UI evidence

This branch captures real Chromium and Electron screenshots from explicit application revisions. It does not modify a feature branch, enable merging, or change the canonical CI workflow. The only workflow permission is `contents: read`; checkout credentials are not persisted and no secrets are passed to application code.

`targets.json` binds each Before/After capture to a full source SHA and reviewed fixture. Both variants use the same scenario and viewport. The browser is real; fixtures simulate only external data boundaries. These screenshots establish the rendered state for that scenario. Web captures do not establish native desktop behavior, and neither capture mode qualifies live providers or the full test suite.

Standalone fixtures import production components and styles. Full-app snippets are inserted into a disposable copy of the source revision's `ChatView.browser.tsx` outer describe, preserving that revision's actual application/router/MSW setup. The isolated Vitest configuration selects only tests named `PR UI evidence`. Existing canonical tests and assertions are not edited on their branches.

Native fixtures mount production `FloatingBrowserPanel` and `BrowserPanel` with the actual `DesktopBrowserManager` in an isolated Electron host. They use a temporary profile and a loopback page, capture native window pixels, and exercise the production floating-to-sidebar controls. The fixture host enables Node integration only for its scoped test IPC; guest preferences use the production isolation helper. This is a component/native integration scenario, not a complete desktop application session. Metadata records the exact source, fixture boundary, errors, screenshots, and recording.

Some changes preserve the same rendered appearance. The sidebar-row optimization and same-ID draft promotion scenarios may match on both revisions; their screenshots must not be presented as evidence of a visual or performance difference. Rail endpoint screenshots show the actual selection states; animation assertions and recordings establish motion separately.

Each artifact includes screenshots and `provenance.json`: source commit/tree, driver commit, fixture and overlaid-test hashes, timestamps, and PNG hashes. The verification step refuses unexpected tracked application changes or missing/invalid screenshots. Review the downloaded PNGs before embedding them in PRs. Source-labelled evidence images can then be committed under `.github/pr-ui-evidence/` on this evidence branch without retriggering capture.

Add a target pair and fixture to extend the runner. Source IDs must be immutable 40-character commit hashes. This is a bounded review utility, not a production application feature.
