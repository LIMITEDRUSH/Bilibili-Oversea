# Browser extension architecture

Version 2.0 is an independent Manifest V3 implementation maintained in this repository.

1. `page-bridge.js` observes Bilibili play-url JSON and `window.__playinfo__` in the page main world without modifying them. It also reports History API navigation.
2. `content.js` validates the bridge boundary, observes resource timing, performs a zero-download 10-second fallback rescan, watches playback health, and performs bounded candidate probes in the Bilibili page context so the CDN receives the normal playback referrer.
3. `worker.js` keeps signed URLs in memory, runs a 128 KB quick stage followed by a 1 MB sustained stage for up to three finalists, validates and ranks results, and owns session rules.
4. `engine.js` contains pure URL, settings, ranking and declarative-rule functions covered by tests.
5. `popup.*` is the complete user interface and talks to the worker through typed messages.

No runtime code is downloaded. Closing a tab removes its state and rule; terminating the browser clears session rules.

The 10-second loop never benchmarks by itself. It only discovers media and sends an activity heartbeat. A full benchmark runs on first discovery, configured result expiry, network change, a confirmed playback stall, or an explicit user action. User-initiated and stall switches ask the content script to move playback back by 150 ms so the player creates a request that can use the new rule; an already-running request cannot be migrated.

For local troubleshooting, the content script exposes only the extension version, phase, selected host, most recently observed host, and rule-installed flag as `data-bili-cdn-auto-*` attributes on the page root. It never exposes a signed media URL or query string.
