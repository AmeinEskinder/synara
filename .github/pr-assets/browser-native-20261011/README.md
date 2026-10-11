# Native browser Before / After evidence

These are actual Electron 43.4.1 native WebContentsView pages captured on an isolated Ubuntu 24.04 X11 display. The production BrowserPanel, DesktopBrowserManager, and MCP browser transport are imported unchanged from each pinned source. Page content is synthetic and served on loopback; local server discovery is empty, and no provider or OAuth account is connected. This evidence qualifies the native scenarios below, not a packaged desktop installation or a live account flow.

The PNGs use Electron desktopCapturer so native child views appear. The short `*-native-screen.webm` files use FFmpeg x11grab of the whole isolated 1280×900 display at 24fps. They are unmodified recordings, including loading/restart frames. Earlier Playwright host-only recordings omitted native child views and are not used as native visual proof.

## Exact sources and accepted runs

| PR / scenario | Before source | After source | Driver | GitHub Actions run |
| --- | --- | --- | --- | --- |
| #1790 ordinary tab retention | `907161a60bbb4b16d53feec693eafd2c7e1b66a0` | `b5f8aca51d93fd610cade6be0c119e02301726b5` | `01a06146be70ed08a1bf2e43cd51d5a530289abb` | [38150706402](https://github.com/Emanuele-web04/synara/actions/runs/38150706402) |
| #1792 parallel tool / human use | `b5f8aca51d93fd610cade6be0c119e02301726b5` | `a833303024f405cd20bda83f96204d0b9a0f39c5` | `28faacc25248d795be85a58b0ea1eb0aa632d333` | [38149870943](https://github.com/Emanuele-web04/synara/actions/runs/38149870943) |
| #1793 process restart | `a833303024f405cd20bda83f96204d0b9a0f39c5` | `b316d1d26e6c540dbb0d9a18a916413be065eb91` | `01a06146be70ed08a1bf2e43cd51d5a530289abb` | [38150706402](https://github.com/Emanuele-web04/synara/actions/runs/38150706402) |

Both variants of all three scenarios passed their source-specific assertions. All Electron launches exited normally with code 0; metadata records no errors. `provenance.json` records source/tree, lockfile, fixture overlay hashes, image hashes and the unchanged-production check. Each `*-metadata.json` records observations, native page identity, process exits, screenshot hashes, and the native screen recording hash. `artifact-manifest.json` records the downloaded Actions archive digests, verified before extraction, and the exact published files.

## What the comparisons prove

### #1790: ordinary inactive tabs retain page state

The driver creates A, B, and C using the actual browser controls; focuses native inputs by real pointer actions; types distinct drafts; and sets history and scroll state. It revisits the ordinary, unclaimed pages after the old cleanup window. Before, A/B receive new native page identities, lose their drafts/history state, and return to scroll 0. After, their native identities, draft values, history, and scroll 480 survive. The returned-A/B PNGs show those differences; metadata supplies identity/history checks that pixels alone cannot prove. The 9-second recordings show the actual native switches.

### #1792: independent human pages preserve agent affinity

The native tool operation remains gated while a human opens an ordinary page or a synthetic OAuth popup and types a draft. Before, the agent operation reports BrowserInterruptedByHuman. After, it completes on its original agent tab, and a follow-up command remains assigned there. In both comparisons the visible human draft remains unchanged. An explicitly correlated popup is still adopted in both variants.

The nearly identical human-page PNGs show preserved visible state; they do not prove background cancellation or affinity. Those claims are checked through the real MCP results, tab IDs, native WebContents IDs, and manager state in metadata. Synthetic OAuth popup behavior does not establish successful provider login.

### #1793: restore metadata after a real process restart

The driver closes the Electron process normally and launches it again using the same isolated user-data directory. Before, the workspace returns empty and opening the panel produces a fresh tab. After, the original IDs, tab order, active A tab, titles, URLs, and open state return as suspended metadata with zero native runtimes before reveal. Showing the panel loads A; selecting B loads it lazily. Form text is intentionally absent after restart: this feature persists browser metadata, not transient page content.

The Before fresh-workspace PNG and After restored-active-A/lazy-B PNGs show the resulting UI. In the short restart videos, the Before fresh tab is visible near 3.25s; After restored A appears near 5.0s and B near 5.5s. The unmodified recordings retain the blank/loading frames during process startup.

## Historical diagnostics retained

Earlier failures are not counted as passing evidence:

- [38099202935](https://github.com/Emanuele-web04/synara/actions/runs/38099202935): host startup timeout before native assertions.
- [38147430718](https://github.com/Emanuele-web04/synara/actions/runs/38147430718): observer-only startup diagnosis; native manager/window present, renderer loading.
- [38147812595](https://github.com/Emanuele-web04/synara/actions/runs/38147812595): installing the required Playwright FFmpeg resolved the startup hang; the fixture then exposed a native-input focus race.
- [38148490284](https://github.com/Emanuele-web04/synara/actions/runs/38148490284): real attached/focused input preconditions passed retention assertions; fixture server cleanup ordering still failed. Host-only images omitted native guest content.
- [38149135805](https://github.com/Emanuele-web04/synara/actions/runs/38149135805): proper native screenshots and five target passes; the parallel Before fixture double-replied after its retained timeout. A once-only response guard fixed the fixture without weakening deadlines or source assertions.

Driver fixes were isolated from feature branches and independently reviewed. Current canonical feature CI is recorded on each PR. Clean content compatibility with main `ec8c940e07582454a475250ade40147e3c89d59f` was separately proved from exact trees without mutating a branch; that content proof does not claim an integrated CI run.
