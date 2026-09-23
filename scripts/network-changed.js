/* Bili CDN Auto - invalidate auto selection after a network change. SPDX-License-Identifier: MIT */
"use strict";

const STORE_KEY = "bili-cdn-auto-state-v1";
let state = {};
const store = typeof $persistentStore !== "undefined"
  ? $persistentStore
  : {
      read: (key) => $prefs.valueForKey(key),
      write: (value, key) => $prefs.setValueForKey(value, key),
    };
try {
  state = JSON.parse(store.read(STORE_KEY) || "{}") || {};
} catch (_) {}

state.selectedHost = null;
state.expiresAt = 0;
state.noWinnerUntil = 0;
state.lockUntil = 0;
state.scores = [];
state.network = null;
state.lastHealthAt = 0;
state.lastSuccessAt = 0;
state.version = 1;
store.write(JSON.stringify(state), STORE_KEY);
console.log("[Bili CDN Auto] network changed; automatic selection invalidated");
$done();
