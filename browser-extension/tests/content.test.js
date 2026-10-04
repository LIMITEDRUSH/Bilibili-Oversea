import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "src/content.js"), "utf8");

test("页面仅协调缓冲与取消，媒体测速交给独立后台请求", async () => {
  let messageListener;
  const requests = [];
  const intervals = [];
  const dataset = {};
  const sentMessages = [];
  const windowListeners = new Map();
  const connectionListeners = new Map();
  const connection = {
    type: "wifi",
    effectiveType: "4g",
    downlink: 20,
    rtt: 20,
    addEventListener(type, listener) { connectionListeners.set(type, listener); },
  };
  let resourceEntries = [];
  let hangingProbe = false;
  const brokerControllers = new Map();
  const window = {
    addEventListener(type, listener) { windowListeners.set(type, listener); },
    postMessage() {},
    setInterval(callback, delay) { intervals.push({ callback, delay }); return intervals.length; },
    setTimeout,
    clearTimeout,
  };
  const context = vm.createContext({
    AbortController,
    Array,
    chrome: {
      runtime: {
        getManifest() { return { version: "2.2.0" }; },
        onMessage: { addListener(listener) { messageListener = listener; } },
        sendMessage: async (message) => {
          sentMessages.push(message);
          if (message.type === "cancel-probe") { brokerControllers.get(message.probeId)?.abort(); return { ok: true }; }
          if (message.type !== "fetch-probe") return undefined;
          const controller = new AbortController();
          brokerControllers.set(message.probeId, controller);
          const target = new URL(message.sourceUrl);
          target.hostname = message.host;
          requests.push({ url: target.href, options: { headers: { Range: `bytes=0-${message.byteLimit-1}` }, signal: controller.signal } });
          if (hangingProbe) return new Promise(resolve => controller.signal.addEventListener("abort", () => resolve({ host: message.host, ok: false })));
          return { host: message.host, ok: true, status: 206, bytes: message.byteLimit, elapsedMs: 10, ttfbMs: 1 };
        },
      },
    },
    document: {
      addEventListener() {},
      documentElement: { dataset },
      hidden: false,
      querySelector() { return null; },
    },
    fetch: async () => { throw new Error("Content scripts must not fetch candidate media"); },
    location: { href: "https://www.bilibili.com/video/BV1", origin: "https://www.bilibili.com" },
    MutationObserver: class { observe() {} },
    navigator: { onLine: true, connection },
    Object,
    performance: {
      now: () => performance.now(),
      getEntriesByType: () => resourceEntries,
    },
    Promise,
    Response,
    Set,
    String,
    URL,
    window,
  });
  vm.runInContext(source, context);

  const response = await new Promise((resolve) => {
    const keepAlive = messageListener({
      type: "probe-candidates",
      sourceUrl: "https://origin.bilivideo.com/upgcxcode/a/video.m4s?token=1",
      hosts: ["upos-sz-mirrorcosov.bilivideo.com", "evil.test"],
      byteLimit: 1_024,
      timeoutMs: 4_500,
    }, {}, resolve);
    assert.equal(keepAlive, true);
  });

  assert.equal(response.ok, true);
  assert.equal(response.results.length, 1);
  assert.equal(response.results[0].status, 206);
  assert.equal(requests.length, 1);
  assert.equal(new URL(requests[0].url).hostname, "upos-sz-mirrorcosov.bilivideo.com");
  assert.equal(requests[0].options.headers.Range, "bytes=0-1023");
  assert.equal(Object.hasOwn(requests[0].options, "referrerPolicy"), false);
  assert.ok(intervals.some((item) => item.delay === 10_000));
  assert.equal(dataset.biliCdnAutoVersion, "2.2.0");

  const probeResource = requests[0].url;
  resourceEntries = [{ name: probeResource, startTime: 1, duration: 1, initiatorType: "fetch" }];
  intervals.find((item) => item.delay === 10_000).callback();
  // Background probes do not create page timing entries. An entry with the
  // same URL here therefore belongs to real playback and must be reported.
  assert.equal(sentMessages.some((message) => message.observed === true), true);
  resourceEntries = [...resourceEntries, {
    name: probeResource, startTime: 2, duration: 2, initiatorType: "xmlhttprequest",
  }];
  intervals.find((item) => item.delay === 10_000).callback();
  assert.equal(sentMessages.some((message) => message.observed === true), true);

  const beforeReplay = sentMessages.length;
  messageListener({ type: "rescan" }, {}, () => {});
  const replay = sentMessages.slice(beforeReplay).filter(message => message.source === "rescan-cache");
  assert.equal(replay.length, 1);
  assert.equal(replay[0].observed, true);
  assert.equal(replay[0].urls[0], probeResource);
  assert.equal(requests.length, 1); // Recovery itself downloads no media.

  connection.rtt = 80;
  connection.downlink = 5;
  connectionListeners.get("change")();
  assert.equal(sentMessages.some((message) => message.type === "network-changed"), false);
  connection.effectiveType = "3g";
  connectionListeners.get("change")();
  assert.equal(sentMessages.filter((message) => message.type === "network-changed").length, 1);
  assert.equal(typeof windowListeners.get("offline"), "function");

  hangingProbe = true;
  const pending = new Promise((resolve) => messageListener({
    type: "probe-candidates", sourceUrl: "https://origin.bilivideo.com/upgcxcode/a/video.m4s?token=1",
    hosts: ["upos-sz-mirrorcosov.bilivideo.com"], byteLimit: 1024, timeoutMs: 4500,
  }, {}, resolve));
  await new Promise((resolve) => setTimeout(resolve, 0));
  let cancelAcknowledged = false;
  messageListener({ type: "cancel-probes" }, {}, (response) => { cancelAcknowledged = response.ok; });
  const cancelled = await pending;
  assert.equal(cancelAcknowledged, true);
  assert.equal(requests.at(-1).options.signal.aborted, true);
  assert.equal(cancelled.skipped, true);
  assert.equal(cancelled.results.length, 0);

  const beforeNavigation = sentMessages.length;
  context.location.href = "https://www.bilibili.com/video/BV2";
  windowListeners.get("popstate")();
  messageListener({ type: "rescan" }, {}, () => {});
  assert.equal(sentMessages.slice(beforeNavigation).some(message => message.source === "rescan-cache"), false);
  const currentResource = "https://new.bilivideo.com/upgcxcode/b/video.m4s";
  resourceEntries.push({ name: currentResource, startTime: performance.now() + 1, duration: 1 });
  intervals.find(item => item.delay === 10_000).callback();
  const nextReports = sentMessages.slice(beforeNavigation).filter(message => message.type === "media-discovered");
  assert.equal(nextReports.length, 1);
  assert.deepEqual(Array.from(nextReports[0].urls), [currentResource]);
  assert.equal(requests.length, 2); // SPA recovery itself performs no downloads.
});

test("每两秒监测缓冲并在低于八秒且快速下降时提前恢复", () => {
  const intervals = [];
  const sentMessages = [];
  const documentListeners = new Map();
  let ahead = 13;
  const video = {
    currentTime: 60,
    duration: 600,
    paused: false,
    ended: false,
    seeking: false,
    buffered: {
      get length() { return 1; },
      start() { return 0; },
      end() { return video.currentTime + ahead; },
    },
    addEventListener() {},
  };
  const window = {
    addEventListener() {},
    postMessage() {},
    setInterval(callback, delay) { intervals.push({ callback, delay }); return intervals.length; },
    setTimeout,
    clearTimeout,
  };
  const context = vm.createContext({
    AbortController,
    Array,
    chrome: {
      runtime: {
        getManifest() { return { version: "2.2.0" }; },
        onMessage: { addListener() {} },
        sendMessage: async (message) => { sentMessages.push(message); },
      },
    },
    document: {
      addEventListener(type, listener) { documentListeners.set(type, listener); },
      documentElement: { dataset: {} },
      hidden: false,
      querySelector() { return video; },
    },
    fetch: async () => new Response(new Uint8Array(1), { status: 206 }),
    location: { href: "https://www.bilibili.com/video/BV2", origin: "https://www.bilibili.com" },
    MutationObserver: class { observe() {} },
    navigator: { onLine: true },
    Object,
    performance: { now: () => performance.now(), getEntriesByType: () => [] },
    Promise,
    Response,
    Set,
    String,
    URL,
    window,
  });
  vm.runInContext(source, context);
  documentListeners.get("DOMContentLoaded")();
  const health = intervals.find((item) => item.delay === 2_000);
  assert.ok(health);
  health.callback();
  for (const value of [7.5, 6, 4, 2.5]) {
    ahead = value;
    health.callback();
  }
  assert.equal(sentMessages.some((message) => (
    message.type === "playback-stall" && message.reason === "buffer-low"
  )), true);
});
