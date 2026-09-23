import assert from "node:assert/strict";
import test from "node:test";
import {
  isBiliMediaHost, isBiliVideoHost, isMediaUrl, makeRedirectRule, rankResults, replaceMediaHost,
  resultFromTiming, sanitizeSettings, uniqueHosts,
} from "../src/engine.js";

const media = "https://upos-sz-mirroraliov.bilivideo.com/upgcxcode/12/34/video.m4s?deadline=9&token=abc";

test("只接受 bilivideo.com 的合法子域名", () => {
  assert.equal(isBiliVideoHost("upos-a.bilivideo.com"), true);
  assert.equal(isBiliVideoHost("bilivideo.com"), false);
  assert.equal(isBiliVideoHost("bilivideo.com.evil.test"), false);
  assert.equal(isBiliVideoHost("bad_.bilivideo.com"), false);
});

test("媒体源额外接受 B 站 mcdn 域名", () => {
  assert.equal(isBiliMediaHost("xy1.mcdn.bilivideo.cn"), true);
  assert.equal(isMediaUrl("https://xy1.mcdn.bilivideo.cn/upgcxcode/a.m4s?token=1"), true);
});

test("媒体识别要求合法域名和 upgcxcode 路径", () => {
  assert.equal(isMediaUrl(media), true);
  assert.equal(isMediaUrl("https://www.bilibili.com/video/BV1"), false);
  assert.equal(isMediaUrl("javascript:alert(1)"), false);
});

test("替换 CDN 只改变主机并保留签名", () => {
  const changed = new URL(replaceMediaHost(media, "upos-sz-mirrorcosov.bilivideo.com"));
  assert.equal(changed.hostname, "upos-sz-mirrorcosov.bilivideo.com");
  assert.equal(changed.pathname, "/upgcxcode/12/34/video.m4s");
  assert.equal(changed.search, "?deadline=9&token=abc");
});

test("候选列表会校验、去重和封顶", () => {
  assert.deepEqual(uniqueHosts([
    "UPOS-A.BILIVIDEO.COM", "upos-a.bilivideo.com", "evil.test", "upos-b.bilivideo.com",
  ], 2), ["upos-a.bilivideo.com", "upos-b.bilivideo.com"]);
});

test("测速结果按吞吐量和首包排序", () => {
  const ranked = rankResults([
    { host: "a.bilivideo.com", ok: true, kbps: 800, ttfbMs: 90 },
    { host: "b.bilivideo.com", ok: true, kbps: 900, ttfbMs: 120 },
    { host: "c.bilivideo.com", ok: false, kbps: 9999, ttfbMs: 1 },
  ]);
  assert.deepEqual(ranked.map((item) => item.host), ["b.bilivideo.com", "a.bilivideo.com"]);
});

test("测速统计限制错误文本并计算 kbps", () => {
  const result = resultFromTiming({ host: "a.bilivideo.com", ok: true, bytes: 1000, elapsedMs: 10, ttfbMs: 2 });
  assert.equal(result.kbps, 800);
  assert.equal(result.ok, true);
});

test("会话规则锁定标签页、发起域和源 CDN", () => {
  const rule = makeRedirectRule({
    id: 100, tabId: 7,
    sourceHosts: ["a.bilivideo.com", "xy1.mcdn.bilivideo.cn", "b.bilivideo.com"],
    targetHost: "b.bilivideo.com",
  });
  assert.deepEqual(rule.condition.tabIds, [7]);
  assert.deepEqual(rule.condition.initiatorDomains, ["bilibili.com"]);
  assert.deepEqual(rule.condition.requestDomains, ["a.bilivideo.com", "xy1.mcdn.bilivideo.cn"]);
  assert.equal(rule.action.redirect.transform.host, "b.bilivideo.com");
});

test("设置只保留受支持的模式和刷新间隔", () => {
  assert.deepEqual(sanitizeSettings({ mode: "bad", refreshMinutes: 999, disabledHosts: ["a.bilivideo.com"] }), {
    enabled: true, mode: "auto", manualHost: "", disabledHosts: ["a.bilivideo.com"], refreshMinutes: 30,
  });
});
