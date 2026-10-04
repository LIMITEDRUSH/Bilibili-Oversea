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
    window, document: { addEventListener() {} }, XMLHttpRequest: FakeXHR, URL, WeakSet, Set, Object, Array, String,
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

test("桥接保留 DASH 音视频类别，并报告实际 fetch/XHR 响应地址", async () => {
  const video="https://upos-hz-mirrorakam.akamaized.net/upgcxcode/hd/v.m4s";
  const audio="https://audio.bilivideo.com/upgcxcode/hd/a.m4s";
  const actual="https://target.bilivideo.com/upgcxcode/hd/v.m4s";
  const messages=[];
  class XHR { addEventListener(name,handler){this[name]=handler;} }
  XHR.prototype.open=function(){};
  XHR.prototype.setRequestHeader=function(name,value){this.header=[name,value];};
  const window={__playinfo__:{data:{dash:{video:[{baseUrl:video}],audio:[{base_url:audio}]}}},
    fetch:async()=>({url:actual}),history:{pushState(){},replaceState(){}},postMessage:m=>messages.push(m),addEventListener(){}};
  vm.runInContext(source,vm.createContext({window,document:{addEventListener(){}},XMLHttpRequest:XHR,URL,Headers,WeakSet,Set,Map,Object,Array,String,
    location:{origin:"https://www.bilibili.com"},queueMicrotask:fn=>fn()}));
  assert.deepEqual(JSON.parse(JSON.stringify(messages[0].tracks)),[{url:video,kind:"video"},{url:audio,kind:"audio"}]);
  await window.fetch(video,{headers:{Range:"bytes=123456-385599"}});
  assert.equal(messages.at(-1).type,"media-observed");
  assert.equal(messages.at(-1).urls[0],actual);
  assert.equal(messages.at(-1).originals[0].originalUrl,video);
  assert.equal(messages.at(-1).originals[0].startByte,123456);
  const xhr=new XHR();xhr.open("GET",video);xhr.setRequestHeader("Range","bytes=543210-805353");xhr.responseURL=actual;xhr.load();
  assert.equal(messages.at(-1).urls[0],actual);
  assert.equal(messages.at(-1).originals[0].startByte,543210);
  assert.deepEqual(xhr.header,["Range","bytes=543210-805353"]);
});

test("晚于 document-start 才赋值的 SSR 也在 XHR send 前识别音视频，不等下载完成", () => {
  const messages = [], nativeCalls = [];
  class XHR { addEventListener(name, handler) { this[name] = handler; } }
  XHR.prototype.open = function() { nativeCalls.push("open"); };
  XHR.prototype.send = function(value) { nativeCalls.push(value); return "native-result"; };
  XHR.prototype.setRequestHeader = function() {};
  const window = { history: {}, postMessage: m => messages.push(m), addEventListener() {} };
  vm.runInContext(source, vm.createContext({ window, document: { addEventListener() {} }, XMLHttpRequest: XHR,
    URL, location: { href: "https://www.bilibili.com/video/BV1", origin: "https://www.bilibili.com" }, queueMicrotask: fn => fn() }));
  const video = "https://video.bilivideo.com/upgcxcode/hd/high.m4s";
  window.__playinfo__ = { data: { dash: { video: [{ baseUrl: video }] } } };
  const xhr = new XHR(); xhr.open("GET", video); xhr.setRequestHeader("Range", "bytes=7000000-8000000");
  assert.equal(xhr.send("body"), "native-result");
  assert.deepEqual(nativeCalls, ["open", "body"]);
  const request = messages.find(m => m.type === "media-requested");
  assert.equal(request.tracks[0].kind, "video");
  assert.equal(request.originals[0].startByte, 7000000);
  assert.equal(messages.some(m => m.type === "media-observed"), false);
});
