# PR #1788: Before vs After rail interaction evidence

The two source pins are Before `907161a60bbb4b16d53feec693eafd2c7e1b66a0` and After `bbc9f2e1b07ceb827977923ad83b8f981357ff5e`. The driver is `21194e577b58212cb2b501b7f5aff00226c84947`; [run 38149209640](https://github.com/Emanuele-web04/synara/actions/runs/38149209640) passed both source jobs and both browser preference profiles. No production source was changed by the capture.

The captures render the production ChatView route, rail and CSS with its existing controlled server fixture. They show synthetic conversation content and do not claim a connected provider session or a native desktop launch. Real pointer clicks select Home and Spaces. Separate Playwright contexts set the real `prefers-reduced-motion` preference to `no-preference` and `reduce`.

After ordinary motion, 59 sampled animation frames include eight distinct intermediate indicator positions between top 54 and 138; the icon scale moves from 0.92 through its spring overshoot (maximum observed 1.07963) and settles at 1. With reduced motion, 50 frames show only the two endpoint positions and every icon scale is 1. Before has no shared moving indicator and every observed icon scale is 1. The same endpoint, selected-state and preference assertions run against both source pins.

## Screenshots and short videos

Each `before/` and `after/` directory contains `rail-no-preference-home.png`, `rail-no-preference-spaces.png`, `rail-reduce-home.png` and `rail-reduce-spaces.png`, plus a separate interaction video for each preference. The stationary screenshots preserve the final selected state; the short videos demonstrate the timing difference. PNGs are the original 1024×720 capture bytes. The 1280×900 recorder frames retain the original browser padding.

The four MP4 clips retain the final 9.5 seconds of their original Playwright WebM recordings. They were encoded with H.264, without cropping, annotations, speed changes or application edits. Exact original video hashes, durations, trim starts and clip hashes are in `review-clips.json`. The complete original recordings, test logs, and provenance remain in the source-labelled Actions artifacts.

| Source | Artifact | ZIP SHA-256 |
| --- | --- | --- |
| Before | [11706226959](https://github.com/Emanuele-web04/synara/actions/runs/38149209640/artifacts/11706226959) | `ac4524bcae137d28548401f99d6157a65df862d44bd693c9f517161dcd2eaba9` |
| After | [11706232945](https://github.com/Emanuele-web04/synara/actions/runs/38149209640/artifacts/11706232945) | `6e0c6e7beefe1dfe285de7f967f2cc94c195e4b67e5ea0b6550ef2bf339be123` |

ZIP digests, every original PNG/WebM digest and each exact source/driver pin were independently checked after download. Each `provenance.json` preserves the fixture overlay hashes, completed state, source tree, captured image and original-video hashes, and frame observations.
