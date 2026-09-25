import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "src/page-bridge.js"), "utf8");

test("页面桥接只发出 bilivideo 媒体地址", () => {
  const messages = [];
  class FakeXHR {}
  FakeXHR.prototype.open = function open() {};
  const window = {
    __playinfo__: { data: { dash: { video: [{ baseUrl: "https://a.bilivideo.com/upgcxcode/a.m4s?token=1" }] } } },
    fetch: async () => ({ clone: () => ({ json: async () => ({}) }) }),
    history: { pushState() {}, replaceState() {} },
    postMessage: (value) => messages.push(value),
    addEventListener() {},
  };
  vm.runInContext(source, vm.createContext({
    window, XMLHttpRequest: FakeXHR, URL, WeakSet, Set, Object, Array, String,
    location: { href: "https://www.bilibili.com/video/BV1", origin: "https://www.bilibili.com" },
    queueMicrotask: (callback) => callback(),
  }));
  assert.equal(messages.length, 1);
  assert.deepEqual([...messages[0].urls], ["https://a.bilivideo.com/upgcxcode/a.m4s?token=1"]);
  window.history.pushState({}, "", "/video/BV2");
  assert.ok(messages.some((message) => message.type === "page-changed"));
  assert.equal(source.includes("eval("), false);
  assert.equal(source.includes("chrome."), false);
});
