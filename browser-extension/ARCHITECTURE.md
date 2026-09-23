# Browser extension architecture

Version 2.0 is an independent Manifest V3 implementation maintained in this repository.

1. `page-bridge.js` observes Bilibili play-url JSON in the page main world without modifying it.
2. `content.js` validates the bridge boundary, watches the video element and reports discovery or stalls.
3. `worker.js` keeps signed URLs in memory, benchmarks validated candidates and owns session rules.
4. `engine.js` contains pure URL, settings, ranking and declarative-rule functions covered by tests.
5. `popup.*` is the complete user interface and talks to the worker through typed messages.

No runtime code is downloaded. Closing a tab removes its state and rule; terminating the browser clears session rules.
