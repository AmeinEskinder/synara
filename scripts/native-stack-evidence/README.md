# Native browser stack qualification

This push-only utility pins six application commits in `targets.json`. It exercises
the unchanged production `DesktopBrowserManager`, `BrowserPanel`, `BrowserUsePipeServer`
and existing MCP browser harness. The host shell, empty local-server discovery and
loopback web pages are fixtures. No provider account, signing or release publication
is involved. Every job has a 20-minute bound; capture has a 10-minute bound and each
native scenario has its own finite deadline.

| Pair                | Required observation                                                                                                                                                                                                                                                                                                             |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1790 ordinary tabs | Preserve native guest identity, in-memory nonce, visible draft, real scroll and history across A/B/C switching; inspect existing runtimes without claiming them for automation. The six-second observation does not qualify the ten-minute idle timer or every protected-budget exception.                                       |
| #1792 parallel use  | An actual MCP `browser_run` pauses at a loopback gate while a human opens and types in another native tab. The after source must keep human visibility/input, agent affinity, and an agent-only follow-up mutation. Both ordinary and synthetic OAuth cases run. A genuine correlated target-blank popup must still be adopted.  |
| #1793 restart       | Gracefully exit one actual Electron process and relaunch another with the same isolated profile/state path. Check committed metadata/order/active selection before reveal, zero live runtimes or automation claims, active-only lazy load, and fresh form content. The preceding source is expected to create a fresh workspace. |

Before variants assert the documented baseline limitation rather than treating a
failed after assertion as successful evidence. Setup, page errors, missing tool
transport and unrelated runtime errors remain failures. Every native method crosses
the actual desktop boundary; read-only inspection never changes manager state or
injects a fake runtime/window-open event.

The utility reuses the established Electron/Vite launch, exact host URL/marker/window
selection, production panel and MCP harness. New loopback content provides the
per-document nonce and deferred network gate required by these three contracts.
Its explicit white page background makes real native captures readable on both
sources; production host and panel styling is unchanged.

Artifacts retain driver/source/tree/lockfile and overlay hashes, Electron versions,
actual process exits, assertions and observations, state-file hash/content (synthetic
data only), PNG hashes, videos and error metadata. `verify` rejects any tracked
application modification, changed fixture, missing capture or recorded error.
Successful execution is native acceptance within this fixture boundary; screenshots
require independent visual review before they are embedded in a PR and do not claim
full-app navigation or external provider authentication.
