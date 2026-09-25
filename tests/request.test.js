"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  applyHost,
  chooseBest,
  isMediaUrl,
  mediaKey,
  networkKey,
  parseArgs,
  parseCandidates,
  policyFromArgs,
  rewrittenUrl,
  run,
} = require("../scripts/request.js");

test("parses module arguments and candidates", () => {
  assert.deepEqual(parseArgs("cache_ttl=60&fallback=original"), {
    cache_ttl: "60",
    fallback: "original",
  });
  assert.deepEqual(parseCandidates("a.bilivideo.com|evil.example.com|b.bilivideo.com|a.bilivideo.com"), [
    "a.bilivideo.com",
    "b.bilivideo.com",
  ]);
});

test("recognizes only supported media paths", () => {
  assert.equal(isMediaUrl("https://upos-sz-mirroraliov.bilivideo.com/upgcxcode/a.m4s?x=1"), true);
  assert.equal(isMediaUrl("https://a.mcdn.bilivideo.cn:4483/upgcxcode/a.m4s"), true);
  assert.equal(isMediaUrl("https://api.bilibili.com/x/player/playurl"), false);
});

test("derives one video key for audio and video tracks of the same cid", () => {
  assert.equal(
    mediaKey("https://a.bilivideo.com/upgcxcode/12/34/5678/5678-1-100023.m4s?x=1"),
    "/upgcxcode/12/34/5678",
  );
  assert.equal(
    mediaKey("https://b.bilivideo.com/upgcxcode/12/34/5678/5678-1-30280.m4s?x=2"),
    "/upgcxcode/12/34/5678",
  );
});

test("adaptive mobile defaults prioritize uninterrupted playback", () => {
  const policy = policyFromArgs({});
  assert.equal(policy.successTtlMs, 3 * 60 * 60 * 1000);
  assert.equal(policy.failureTtlMs, 10 * 60 * 1000);
  assert.equal(policy.verifyIntervalMs, 15 * 60 * 1000);
  assert.equal(policy.verifyDelayMs, 15 * 1000);
  assert.equal(policy.quickProbeBytes, 128 * 1024);
  assert.equal(policy.verifyProbeBytes, 128 * 1024);
});

test("rewrites hostname while preserving signed path and query", () => {
  const input = "https://old.bilivideo.com:4483/upgcxcode/a.m4s?deadline=1&token=x";
  const output = rewrittenUrl(input, "new.bilivideo.com");
  assert.equal(output, "https://new.bilivideo.com/upgcxcode/a.m4s?deadline=1&token=x");
  const changed = applyHost({ url: input, headers: { Host: "old.bilivideo.com", Range: "bytes=1-2" } }, "new.bilivideo.com");
  assert.equal(changed.headers.Host, "new.bilivideo.com");
  assert.equal(changed.headers.Range, "bytes=1-2");
});

test("chooses the fastest successful candidate", () => {
  const winner = chooseBest([
    { host: "slow.bilivideo.com", ok: true, elapsedMs: 300, bytes: 65536 },
    { host: "bad.bilivideo.com", ok: false, elapsedMs: 10, bytes: 0 },
    { host: "fast.bilivideo.com", ok: true, elapsedMs: 120, bytes: 65536 },
  ]);
  assert.equal(winner.host, "fast.bilivideo.com");
});

test("builds stable network keys", () => {
  assert.equal(networkKey({ wifi: { ssid: "Home" } }), "wifi:Home");
  assert.equal(
    networkKey({ "cellular-data": { carrier: "Carrier", radio: "5G" } }),
    "cellular:Carrier:5G",
  );
});

test("safe delayed full benchmark runs once then reuses the winner", async () => {
  const memory = new Map();
  const now = Date.now();
  memory.set("bili-cdn-auto-state-v1", JSON.stringify({
    network: "wifi:Home",
    videoKey: "/upgcxcode/a.m4s",
    videoFirstSeenAt: now - 20000,
    fullRetestAfter: now - 1,
    blacklist: {},
    scores: [],
  }));
  const store = {
    read: (key) => memory.get(key) || null,
    write: (value, key) => (memory.set(key, value), true),
  };
  let probes = 0;
  const client = {
    get(options, callback) {
      probes += 1;
      const finish = () => callback(null, { status: 206 }, new Uint8Array(4096));
      if (options.url.includes("fast.bilivideo.com")) finish();
      else setTimeout(finish, 20);
    },
  };
  const request = {
    url: "https://source.bilivideo.com/upgcxcode/a.m4s?token=1",
    headers: { Host: "source.bilivideo.com", "User-Agent": "test" },
  };
  const doneValues = [];
  const runtime = {
    request,
    argument: "candidates=slow.bilivideo.com|fast.bilivideo.com&probe_bytes=4096",
    network: { wifi: { ssid: "Home" } },
    store,
    client,
    done: (value) => doneValues.push(value),
    notify: () => {},
    log: () => {},
  };

  await run(runtime);
  await run(runtime);
  assert.equal(probes, 2);
  assert.match(doneValues[0].url, /^https:\/\/fast\.bilivideo\.com\//);
  assert.match(doneValues[1].url, /^https:\/\/fast\.bilivideo\.com\//);
});

test("a new video never waits for probing and immediately uses a cached winner", async () => {
  const memory = new Map();
  const now = Date.now();
  memory.set("bili-cdn-auto-state-v1", JSON.stringify({
    network: "wifi:Home",
    selectedHost: "fast.bilivideo.com",
    expiresAt: now + 60000,
    videoKey: "/upgcxcode/old/old/old",
    scores: [
      { host: "fast.bilivideo.com", ok: true, bytes: 131072, elapsedMs: 20, kbps: 52429, sampledAt: now },
      { host: "backup.bilivideo.com", ok: true, bytes: 131072, elapsedMs: 30, kbps: 34953, sampledAt: now },
    ],
    blacklist: {},
  }));
  let probes = 0;
  let completed;
  await run({
    request: {
      url: "https://source.bilivideo.com/upgcxcode/12/34/5678/5678-1-100023.m4s?token=1",
      headers: {},
    },
    argument: "candidates=fast.bilivideo.com|backup.bilivideo.com",
    network: { wifi: { ssid: "Home" } },
    store: {
      read: (key) => memory.get(key) || null,
      write: (value, key) => (memory.set(key, value), true),
    },
    client: { get() { probes += 1; } },
    done: (value) => { completed = value; },
    notify() {},
    log() {},
  });
  assert.equal(probes, 0);
  assert.match(completed.url, /^https:\/\/fast\.bilivideo\.com\//);
  const state = JSON.parse(memory.get("bili-cdn-auto-state-v1"));
  assert.equal(state.videoKey, "/upgcxcode/12/34/5678");
  assert.equal(state.verifiedVideoKey, "");
});

test("the first uncached video request passes through without probing", async () => {
  const memory = new Map();
  let probes = 0;
  let completed;
  await run({
    request: {
      url: "https://source.bilivideo.com/upgcxcode/12/34/9999/9999-1-100023.m4s?token=1",
      headers: {},
    },
    argument: "candidates=fast.bilivideo.com|backup.bilivideo.com",
    network: { wifi: { ssid: "Home" } },
    store: {
      read: (key) => memory.get(key) || null,
      write: (value, key) => (memory.set(key, value), true),
    },
    client: { get() { probes += 1; } },
    done: (value) => { completed = value; },
    notify() {},
    log() {},
  });
  assert.equal(probes, 0);
  assert.deepEqual(completed, {});
  const state = JSON.parse(memory.get("bili-cdn-auto-state-v1"));
  assert.ok(state.fullRetestAfter > Date.now());
});

test("after the safe delay only current and best backup receive 128 KiB probes", async () => {
  const memory = new Map();
  const now = Date.now();
  memory.set("bili-cdn-auto-state-v1", JSON.stringify({
    network: "wifi:Home",
    selectedHost: "fast.bilivideo.com",
    expiresAt: now + 60000,
    videoKey: "/upgcxcode/12/34/5678",
    verifiedVideoKey: "",
    videoFirstSeenAt: now - 16000,
    lastVerifiedAt: now - 60000,
    blacklist: {},
    scores: [
      { host: "fast.bilivideo.com", ok: true, bytes: 131072, elapsedMs: 20, kbps: 52429, sampledAt: now },
      { host: "backup.bilivideo.com", ok: true, bytes: 131072, elapsedMs: 30, kbps: 34953, sampledAt: now },
      { host: "third.bilivideo.com", ok: true, bytes: 131072, elapsedMs: 40, kbps: 26214, sampledAt: now },
    ],
  }));
  const ranges = [];
  await run({
    request: {
      url: "https://source.bilivideo.com/upgcxcode/12/34/5678/5678-1-100023.m4s?token=1",
      headers: {},
    },
    argument: "candidates=fast.bilivideo.com|backup.bilivideo.com|third.bilivideo.com",
    network: { wifi: { ssid: "Home" } },
    store: {
      read: (key) => memory.get(key) || null,
      write: (value, key) => (memory.set(key, value), true),
    },
    client: {
      get(options, callback) {
        ranges.push(options.headers.Range);
        callback(null, { status: 206 }, new Uint8Array(128 * 1024));
      },
    },
    done() {},
    notify() {},
    log() {},
  });
  assert.deepEqual(ranges, ["bytes=0-131071", "bytes=0-131071"]);
  const state = JSON.parse(memory.get("bili-cdn-auto-state-v1"));
  assert.equal(state.verifiedVideoKey, state.videoKey);
  assert.equal(state.scores.filter((item) => item.stage === "verify").length, 2);
});

test("concurrent media requests bypass an in-flight verification", async () => {
  const memory = new Map();
  const now = Date.now();
  memory.set("bili-cdn-auto-state-v1", JSON.stringify({
    network: "wifi:Home",
    selectedHost: "current.bilivideo.com",
    expiresAt: now + 60000,
    videoKey: "/upgcxcode/12/34/5678",
    verifiedVideoKey: "",
    videoFirstSeenAt: now - 16000,
    blacklist: {},
    scores: [
      { host: "current.bilivideo.com", ok: true, kbps: 1000, sampledAt: now },
      { host: "backup.bilivideo.com", ok: true, kbps: 900, sampledAt: now },
    ],
  }));
  const callbacks = [];
  const store = {
    read: (key) => memory.get(key) || null,
    write: (value, key) => (memory.set(key, value), true),
  };
  const first = run({
    request: { url: "https://source.bilivideo.com/upgcxcode/12/34/5678/video.m4s", headers: {} },
    argument: "candidates=current.bilivideo.com|backup.bilivideo.com",
    network: { wifi: { ssid: "Home" } },
    store,
    client: { get(options, callback) { callbacks.push(callback); } },
    done() {}, notify() {}, log() {},
  });
  assert.equal(callbacks.length, 2);
  let secondResult;
  await run({
    request: { url: "https://source.bilivideo.com/upgcxcode/12/34/5678/audio.m4s", headers: {} },
    argument: "candidates=current.bilivideo.com|backup.bilivideo.com",
    network: { wifi: { ssid: "Home" } },
    store,
    client: { get() { assert.fail("the concurrent request must not start more probes"); } },
    done(value) { secondResult = value; }, notify() {}, log() {},
  });
  assert.match(secondResult.url, /^https:\/\/current\.bilivideo\.com\//);
  callbacks.forEach((callback) => callback(null, { status: 206 }, new Uint8Array(128 * 1024)));
  await first;
});

test("a real network change also passes the first request through without probing", async () => {
  const memory = new Map();
  memory.set("bili-cdn-auto-state-v1", JSON.stringify({
    network: "wifi:Old",
    selectedHost: "fast.bilivideo.com",
    expiresAt: Date.now() + 60000,
    videoKey: "/upgcxcode/old/old/old",
    blacklist: {},
    scores: [],
  }));
  let probes = 0;
  let completed;
  await run({
    request: { url: "https://source.bilivideo.com/upgcxcode/12/34/7777/a.m4s", headers: {} },
    argument: "candidates=fast.bilivideo.com|backup.bilivideo.com",
    network: { wifi: { ssid: "New" } },
    store: {
      read: (key) => memory.get(key) || null,
      write: (value, key) => (memory.set(key, value), true),
    },
    client: { get() { probes += 1; } },
    done: (value) => { completed = value; },
    notify() {},
    log() {},
  });
  assert.equal(probes, 0);
  assert.deepEqual(completed, {});
  const state = JSON.parse(memory.get("bili-cdn-auto-state-v1"));
  assert.equal(state.network, "wifi:New");
  assert.equal(state.selectedHost, null);
});

test("light verification switches when the backup is at least twenty percent faster", async () => {
  const memory = new Map();
  const now = Date.now();
  memory.set("bili-cdn-auto-state-v1", JSON.stringify({
    network: "wifi:Home",
    selectedHost: "current.bilivideo.com",
    expiresAt: now + 60000,
    videoKey: "/upgcxcode/12/34/8888",
    verifiedVideoKey: "",
    videoFirstSeenAt: now - 16000,
    blacklist: {},
    scores: [
      { host: "current.bilivideo.com", ok: true, kbps: 1000, sampledAt: now },
      { host: "backup.bilivideo.com", ok: true, kbps: 900, sampledAt: now },
    ],
  }));
  let completed;
  await run({
    request: { url: "https://source.bilivideo.com/upgcxcode/12/34/8888/a.m4s", headers: {} },
    argument: "candidates=current.bilivideo.com|backup.bilivideo.com&switch_gain=120",
    network: { wifi: { ssid: "Home" } },
    store: {
      read: (key) => memory.get(key) || null,
      write: (value, key) => (memory.set(key, value), true),
    },
    client: {
      get(options, callback) {
        const delay = options.url.includes("current") ? 24 : 8;
        setTimeout(() => callback(null, { status: 206 }, new Uint8Array(128 * 1024)), delay);
      },
    },
    done: (value) => { completed = value; },
    notify() {},
    log() {},
  });
  assert.match(completed.url, /^https:\/\/backup\.bilivideo\.com\//);
  const state = JSON.parse(memory.get("bili-cdn-auto-state-v1"));
  assert.equal(state.selectedHost, "backup.bilivideo.com");
  assert.ok(state.fullRetestAfter > Date.now());
});
