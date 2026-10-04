import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { diagnostics, hostLabel, popupView, speedLabel } from "../src/popup-model.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "src/popup.html"), "utf8");
const css = fs.readFileSync(path.join(root, "src/popup.css"), "utf8");

test("弹窗固定使用无渐变的亮色界面，开关不被装饰层拦截", () => {
  assert.match(html, /name="color-scheme" content="light"/);
  assert.match(css, /color-scheme: light/);
  assert.doesNotMatch(css, /gradient\(|color-scheme: dark|--mint/);
  assert.match(css, /\.power-track\s*\{[^}]*pointer-events: none/);
});

test("弹窗提供自动、重测、原始 CDN、自适应维护和教程入口", () => {
  for (const id of ["auto", "retest", "original", "results", "refresh", "actual", "applyState"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /browser-guide\.html/);
  assert.match(html, /自适应 · 15 分钟/);
  assert.doesNotMatch(html, /on(?:click|change)=/i);
});

test("暂停和非播放页不会误报优化正在工作", () => {
  const state = { phase: "active", selectedHost: "a.bilivideo.com", actualHost: "a.bilivideo.com", lastDetectedAt: 1 };
  const view = popupView({ enabled: false, mode: "auto" }, state);
  assert.equal(view.phase, "paused");
  assert.equal(view.selected, "");
  assert.equal(view.canRetest, false);
  assert.equal(popupView({ enabled: true }, state, { supported: false }).title, "打开 B 站播放页");
});

test("错误、规则就绪、已确认请求与固定模式分别展示", () => {
  const settings = { enabled: true, mode: "auto" };
  const state = { phase: "active", selectedHost: "a.bilivideo.com", actualHost: "", ruleInstalled: true };
  assert.equal(popupView(settings, state).applied, "规则已就绪");
  assert.equal(popupView(settings, { ...state, actualHost: state.selectedHost }).applied, "目标请求已确认");
  assert.equal(popupView(settings, state, { error: "后台断开" }).message, "后台断开");
  assert.equal(popupView({ ...settings, mode: "manual" }, { ...state, phase: "manual" }).title, "已固定线路");
  assert.equal(popupView({ ...settings, mode: "original" }, state).applied, "原始请求直通");
});

test("吞吐量以 Mbps 展示，未知主机名保留原文", () => {
  assert.equal(speedLabel(24500), "24.5 Mbps");
  assert.equal(hostLabel("upos-sz-mirrorcosov.bilivideo.com"), "腾讯云 · 海外");
  assert.equal(hostLabel("custom.bilivideo.com"), "custom.bilivideo.com");
});

test("复制诊断仅包含线路信息，不导出签名、播放地址或原始错误", () => {
  const output = diagnostics({ enabled: true, mode: "auto" }, {
    phase: "active", sourceUrls: ["https://video.test/?token=secret"], pageUrl: "https://bilibili.com/video/private",
    selectedHost: "cdn.bilivideo.com", actualHost: "not-a-host?token=secret",
    lastError: "signed-token-secret",
    results: [{ host: "cdn.bilivideo.com", ok: true, kbps: 1000, error: "secret" }],
  }, "2.3.0");
  assert.equal(output.selectedHost, "cdn.bilivideo.com");
  assert.equal(output.actualHost, "");
  assert.doesNotMatch(JSON.stringify(output), /secret|token|private|pageUrl|sourceUrls/);
});
