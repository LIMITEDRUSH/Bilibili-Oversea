"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const STORE_KEY = "bili-cdn-auto-state-v1";

function execute(scriptName, globals) {
  const source = fs.readFileSync(path.join(__dirname, "..", "scripts", scriptName), "utf8");
  vm.runInNewContext(source, { URL, console, ...globals }, { filename: scriptName });
}

function executeAsync(scriptName, globals) {
  return new Promise((resolve, reject) => {
    try {
      execute(scriptName, { ...globals, $done: resolve });
    } catch (error) {
      reject(error);
    }
  });
}

function memoryStore(initialState) {
  const values = new Map();
  if (initialState) values.set(STORE_KEY, JSON.stringify(initialState));
  return {
    read: (key) => values.get(key) || null,
    write: (value, key) => (values.set(key, value), true),
    state: () => JSON.parse(values.get(STORE_KEY) || "{}"),
  };
}

test("response script blacklists a repeatedly failing selected CDN", () => {
  const store = memoryStore({
    selectedHost: "bad.example.com",
    expiresAt: Date.now() + 60000,
    failureCount: 1,
  });
  let completed = false;
  execute("response.js", {
    $argument: "failure_threshold=2&blacklist_ttl=300",
    $persistentStore: store,
    $request: { url: "https://bad.example.com/upgcxcode/a.m4s" },
    $response: { status: 503 },
    $notification: { post() {} },
    $done() { completed = true; },
  });
  const state = store.state();
  assert.equal(completed, true);
  assert.equal(state.selectedHost, null);
  assert.ok(state.blacklist["bad.example.com"] > Date.now());
});

test("control script retest command clears automatic state", () => {
  const store = memoryStore({
    selectedHost: "cached.example.com",
    expiresAt: Date.now() + 60000,
    blacklist: { "bad.example.com": Date.now() + 60000 },
  });
  execute("control.js", {
    $intent: { parameter: "retest" },
    $persistentStore: store,
    $notification: { post() {} },
    $done() {},
  });
  const state = store.state();
  assert.equal(state.selectedHost, null);
  assert.equal(state.expiresAt, 0);
  assert.deepEqual(Object.keys(state.blacklist), []);
});

test("network change preserves a manual override but invalidates auto selection", () => {
  const store = memoryStore({
    selectedHost: "cached.example.com",
    forcedHost: "manual.example.com",
    expiresAt: Date.now() + 60000,
  });
  execute("network-changed.js", {
    $persistentStore: store,
    $done() {},
  });
  const state = store.state();
  assert.equal(state.selectedHost, null);
  assert.equal(state.forcedHost, "manual.example.com");
});

test("request script supports Quantumult X task and prefs APIs", async () => {
  const values = new Map();
  const result = await executeAsync("request.js", {
    $request: {
      url: "https://source.bilivideo.com/upgcxcode/a.m4s?token=1",
      headers: { Host: "source.bilivideo.com", "User-Agent": "test" },
    },
    $argument: "candidates=fast.bilivideo.com&probe_bytes=4096",
    $network: {},
    $prefs: {
      valueForKey: (key) => values.get(key) || null,
      setValueForKey: (value, key) => (values.set(key, value), true),
    },
    $task: {
      fetch: async () => ({
        statusCode: 206,
        headers: {},
        bodyBytes: new Uint8Array(4096),
      }),
    },
    $notify() {},
  });
  assert.match(result.url, /^https:\/\/fast\.bilivideo\.com\//);
});

test("local control endpoint returns Quantumult X compatible response", async () => {
  const values = new Map();
  const result = await executeAsync("control-http.js", {
    $request: { url: "http://bili-cdn-auto.invalid/auto" },
    $prefs: {
      valueForKey: (key) => values.get(key) || null,
      setValueForKey: (value, key) => (values.set(key, value), true),
    },
    $task: { fetch() {} },
  });
  assert.equal(result.status, "HTTP/1.1 200 OK");
  assert.equal(JSON.parse(result.body).mode, "auto");
});
