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
  const window = {
    addEventListener() {},
    postMessage() {},
    setInterval,
    setTimeout,
    clearTimeout,
  };
  const context = vm.createContext({
    AbortController,
    Array,
    chrome: {
      runtime: {
        onMessage: { addListener(listener) { messageListener = listener; } },
        sendMessage: async () => {},
      },
    },
    document: {
      addEventListener() {},
      documentElement: {},
      hidden: false,
      querySelector() { return null; },
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return new Response(new Uint8Array(2_048), { status: 206 });
    },
    location: { origin: "https://www.bilibili.com" },
    MutationObserver: class { observe() {} },
    navigator: { onLine: true },
    Object,
    performance,
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
});
