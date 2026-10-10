# Isolated PR UI evidence

This branch captures real Chromium screenshots from explicit application revisions. It does not modify a feature branch, enable merging, or change the canonical CI workflow. The only workflow permission is `contents: read`; checkout credentials are not persisted and no secrets are passed to application code.

`targets.json` binds each Before/After capture to a full source SHA and reviewed fixture. Both variants use the same scenario and viewport. The browser is real; fixtures simulate only external data boundaries. These screenshots establish the rendered state for that scenario, not live-provider, native desktop, or full-suite qualification.

Standalone fixtures import production components and styles. Full-app snippets are inserted into a disposable copy of the source revision's `ChatView.browser.tsx` outer describe, preserving that revision's actual application/router/MSW setup. The isolated Vitest configuration selects only tests named `PR UI evidence`. Existing canonical tests and assertions are not edited on their branches.

Each artifact includes screenshots and `provenance.json`: source commit/tree, driver commit, fixture and overlaid-test hashes, timestamps, and PNG hashes. The verification step refuses unexpected tracked application changes or missing/invalid screenshots. Review the downloaded PNGs before embedding them in PRs. Source-labelled evidence images can then be committed under `.github/pr-ui-evidence/` on this evidence branch without retriggering capture.

Add a target pair and fixture to extend the runner. Source IDs must be immutable 40-character commit hashes. This is a bounded review utility, not a production application feature.
