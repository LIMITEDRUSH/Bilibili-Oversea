import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { clockLabel, playbackView } from "../src/playback-view.js";

const source = fs.readFileSync(new URL("../src/content.js", import.meta.url), "utf8");
function setup() {
  let receive, heading = "当前视频标题", videos = [];
  const messages = [], timers = [], videoEvents = new WeakMap();
  let listenerCount = 0;
  const location = { href: "https://www.bilibili.com/video/BV1", origin: "https://www.bilibili.com" };
  const makeVideo = (main = true) => {
    const video = { paused: false, ended: false, seeking: false, readyState: 4,
      currentTime: 30, duration: 180, videoWidth: 1920, videoHeight: 1080,
      currentSrc: "blob:private-source", buffered: { length: 1, start: () => 0, end: () => video.currentTime + 15 },
      closest: () => main ? {} : null, getBoundingClientRect: () => ({ width: 640, height: 360 }),
      addEventListener(name, fn) { listenerCount++; const events = videoEvents.get(video) || new Map(); events.set(name, fn); videoEvents.set(video, events); },
    };
    return video;
  };
  const context = vm.createContext({
    window: { addEventListener() {}, postMessage() {}, setInterval(fn, delay) { timers.push(delay); return 1; }, setTimeout, clearTimeout },
    document: { hidden: false, title: "页面标题_哔哩哔哩_bilibili", documentElement: { dataset: {} },
      addEventListener() {}, querySelectorAll: () => videos,
      querySelector: () => ({ textContent: heading, getAttribute: () => heading }) },
    chrome: { runtime: { getManifest: () => ({ version: "2.3.3" }), sendMessage: async m => messages.push(m), onMessage: { addListener: fn => receive = fn } } },
    location, navigator: { onLine: true }, MutationObserver: class { observe() {} },
    performance: { getEntriesByType: () => [] }, AbortController, URL, Map, Set, WeakMap, Date,
  });
  vm.runInContext(source, context);
  const sample = () => { let reply; const keep = receive({ type: "get-playback-info" }, {}, value => reply = value); assert.equal(keep, false); return reply.playback; };
  return { sample, makeVideo, messages, timers, location, listenerCount: () => listenerCount, setVideos: v => videos = v, setHeading: v => heading = v,
    event: (video, name) => videoEvents.get(video).get(name)() };
}

test("弹窗只读采集真实视频，不发送选路消息或新增常驻计时器", () => {
  const api = setup();
  const video = api.makeVideo(); api.setVideos([video]);
  assert.equal(api.sample().status, "loading");
  video.currentTime++;
  const info = api.sample();
  assert.equal(info.status, "playing");
  assert.equal(info.width, 1920); assert.equal(info.height, 1080);
  assert.equal(info.bufferedAhead, 15); assert.equal(info.title, "当前视频标题");
  assert.equal(info.currentTime, 31); assert.equal(info.duration, 180);
  assert.equal(api.messages.length, 0);
  assert.deepEqual(api.timers, [10000]);
  assert.doesNotMatch(JSON.stringify(info), /blob:|https:|token|currentSrc/);
});

test("真实暂停、缓冲、播放、跳转、结束和错误独立更新", () => {
  const api = setup(), video = api.makeVideo(); api.setVideos([video]); api.sample();
  api.event(video, "playing"); assert.equal(api.sample().status, "playing");
  api.event(video, "waiting"); assert.equal(api.sample().status, "buffering");
  video.currentTime++; assert.equal(api.sample().status, "playing");
  video.paused = true; assert.equal(api.sample().status, "paused");
  video.paused = false; video.seeking = true; assert.equal(api.sample().status, "seeking");
  video.seeking = false; video.ended = true; assert.equal(api.sample().status, "ended");
  video.ended = false; video.error = { code: 2 }; assert.equal(api.sample().status, "error");
});

test("预览视频不能抢占主播放器；没有视频不保留旧进度", () => {
  const api = setup(), preview = api.makeVideo(false), main = api.makeVideo(true);
  preview.videoWidth = 320; api.setVideos([preview, main]);
  assert.equal(api.sample().width, 1920);
  api.setVideos([]); const empty = api.sample();
  assert.equal(empty.status, "empty"); assert.equal(empty.hasVideo, false);
  assert.equal(Object.hasOwn(empty, "currentTime"), false);
});

test("同一个 MSE 播放器换视频期间清除旧标题和进度，元数据就绪后恢复", () => {
  const api = setup(), video = api.makeVideo(); api.setVideos([video]); api.sample();
  api.location.href = "https://www.bilibili.com/video/BV2";
  const navigating = api.sample();
  assert.equal(navigating.status, "loading"); assert.equal(navigating.hasVideo, false);
  assert.equal(navigating.title, "正在加载视频"); assert.equal(navigating.currentTime, undefined);
  api.setHeading("新的标题"); video.currentTime = 0; api.event(video, "loadedmetadata");
  assert.equal(api.sample().title, "新的标题");
  api.event(video, "playing"); assert.equal(api.sample().status, "playing");
});

test("关闭弹窗后发生的导航也不会在重开时卡在旧状态或累加事件监听器", () => {
  const api = setup(), video = api.makeVideo(); api.setVideos([video]); api.sample();
  for (let i = 2; i < 10; i++) {
    api.location.href = `https://www.bilibili.com/video/BV${i}`;
    api.setHeading(`视频${i}`); api.event(video, "loadedmetadata"); api.event(video, "playing");
    assert.equal(api.sample().status, "playing"); assert.equal(api.sample().title, `视频${i}`);
  }
  assert.equal(api.listenerCount(), 11);
});

test("缺失、过期和非播放页的数据不点亮正在播放", () => {
  const info = { sampledAt: 10000, status: "playing", hasVideo: true, title: "标题", width: 1920, height: 1080, currentTime: 61, duration: 180, bufferedAhead: 12.24 };
  const view = playbackView(info, { now: 10001 });
  assert.equal(view.title, "正在播放"); assert.equal(view.resolution, "1920 × 1080");
  assert.equal(view.buffer, "12.2 秒"); assert.equal(view.progress, "01:01 / 03:00");
  assert.equal(playbackView(info, { now: 16000 }).phase, "unknown");
  assert.equal(playbackView(info, { now: 10001, supported: false }).phase, "unsupported");
  assert.equal(playbackView(null).phase, "unknown");
  assert.equal(playbackView({ ...info, status: "paused" }, { now: 10001 }).title, "已暂停");
});

test("没有当前帧分辨率不猜画质，标题是纯文本，未知时长不冒充零秒", () => {
  const view = playbackView({ sampledAt: 100, hasVideo: true, status: "playing", title: "<img onerror=bad>\u0000", width: 0, height: 0, currentTime: 0, duration: null, bufferedAhead: 0 }, { now: 101 });
  assert.equal(view.resolution, "—"); assert.equal(view.videoTitle, "<img onerror=bad>");
  assert.equal(view.progress, "00:00 / --:--"); assert.equal(view.buffer, "0.0 秒");
  assert.equal(clockLabel(3661), "1:01:01"); assert.equal(clockLabel(Infinity), "--:--");
});
