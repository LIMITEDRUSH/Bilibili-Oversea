import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "src/content.js"), "utf8");

test("媒体测速在页面内容上下文中保留正常 Referer 策略", async () => {
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
        sendMessage: async (message) => { sentMessages.push(message); },
      },
    },
    document: {
      addEventListener() {},
      documentElement: { dataset },
      hidden: false,
      querySelector() { return null; },
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return new Response(new Uint8Array(2_048), { status: 206 });
    },
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
  assert.equal(sentMessages.some((message) => message.observed === true), false);
  resourceEntries = [...resourceEntries, {
    name: probeResource, startTime: 2, duration: 2, initiatorType: "xmlhttprequest",
  }];
  intervals.find((item) => item.delay === 10_000).callback();
  assert.equal(sentMessages.some((message) => message.observed === true), true);

  connection.rtt = 80;
  connection.downlink = 5;
  connectionListeners.get("change")();
  assert.equal(sentMessages.some((message) => message.type === "network-changed"), false);
  connection.effectiveType = "3g";
  connectionListeners.get("change")();
  assert.equal(sentMessages.filter((message) => message.type === "network-changed").length, 1);
  assert.equal(typeof windowListeners.get("offline"), "function");
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
