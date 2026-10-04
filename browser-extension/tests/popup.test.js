import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { diagnostics, hostLabel, popupRows, popupView, speedLabel } from "../src/popup-model.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "src/popup.html"), "utf8");
const css = fs.readFileSync(path.join(root, "src/popup.css"), "utf8");

test("弹窗固定使用无渐变的亮色界面，开关不被装饰层拦截", () => {
  assert.match(html, /name="color-scheme" content="light"/);
  assert.match(css, /color-scheme: light/);
  assert.doesNotMatch(css, /gradient\(|color-scheme: dark|--mint/);
  assert.match(css, /\.power-track\s*\{[^}]*pointer-events: none/);
});

test("扩展弹窗提供确定的根宽度，不用 vw 或百分比上限参与自动尺寸循环", () => {
  assert.match(css, /:root\s*\{[^}]*width: 400px;[^}]*min-width: 400px;/);
  assert.match(css, /body\s*\{[^}]*width: 400px;[^}]*min-width: 400px;/);
  assert.doesNotMatch(css, /max-width:\s*(?:100vw|100%)/);
});

test("撤销失败时即使总开关已关闭也不显示成功暂停或原始直通", () => {
  const view = popupView({ enabled: false, mode: "original" }, { phase: "error", ruleInstalled: true, lastError: "无法撤销线路规则" });
  assert.equal(view.phase, "error");
  assert.equal(view.title, "规则更新未完成");
  assert.equal(view.applied, "规则仍可能生效");
});

test("弹窗突出真实播放信息，删除常驻解释，所有外跳进入个人站", () => {
  for (const id of ["auto", "retest", "original", "results", "actual", "applyState", "playbackStatus", "videoTitle", "resolution", "buffer", "progress"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  const links = [...html.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map(match => match[1]);
  assert.equal(links.length, 1);
  assert.ok(links.every(link => link.startsWith("https://limitedrush.online/")));
  assert.doesNotMatch(html, /自适应 · 15 分钟|PLAYBACK ROUTER|推荐|route-signal|maintenance|modeDescription/);
  assert.doesNotMatch(html, /on(?:click|change)=/i);
});

test("呼吸灯只依赖真实播放状态，并支持减少动态效果", () => {
  assert.match(css, /\[data-playback="playing"\] \.dot[^}]*animation: breathe/);
  assert.doesNotMatch(css, /\.dot\.active|\.dot\.manual/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(html, /id="message"[^>]*hidden/);
  assert.match(css, /\[hidden\][^}]*display: none !important/);
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

test("Akamai 直通准确显示工作边界，不伪报优化或开放无效重测",()=>{
  const view=popupView({enabled:true,mode:"auto"},{phase:"original",passthroughReason:"baseline-akamai",lastDetectedAt:1});
  assert.equal(view.title,"使用原始 CDN");assert.equal(view.applied,"原始请求直通");
  assert.equal(view.canRetest,false);assert.match(view.message,/2\.2\.0.*不跨 CDN/);
  const popup=fs.readFileSync(path.join(root,"src/popup.js"),"utf8");
  assert.match(popup,/const signature = JSON\.stringify\(\[results, state\?\.selectedHost, state\?\.passthroughReason/);
});

test("吞吐量以 Mbps 展示，未知主机名保留原文", () => {
  assert.equal(speedLabel(24500), "24.5 Mbps");
  assert.equal(hostLabel("upos-sz-mirrorcosov.bilivideo.com"), "腾讯云 · 海外");
  assert.equal(hostLabel("custom.bilivideo.com"), "custom.bilivideo.com");
});

test("已排除节点在重测或后台重启后仍有恢复入口，不伪造测速数据", () => {
  const rows = popupRows({ disabledHosts: ["upos-sz-mirrorcosov.bilivideo.com"] }, null);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].untested, true);
  assert.equal(rows[0].ok, false);
  const ranked = popupRows({ disabledHosts: [rows[0].host] }, { results: [
    { host: rows[0].host, ok: true, kbps: 100 }, { host: "other.bilivideo.com", ok: true, kbps: 50 },
  ] });
  assert.equal(ranked[0].host, "other.bilivideo.com");
  assert.equal(ranked.find(item => item.host === rows[0].host).kbps, 100);
  assert.equal(ranked.at(-1).host, rows[0].host);
});

test("重测和没有结果时保留真实候选，发现但未测的节点也可见", () => {
  for (const phase of ["waiting", "testing", "active", "error"]) {
    const rows = popupRows({ disabledHosts: [] }, { phase, lastDetectedAt: 1, originalHost: "original.bilivideo.com", results: [] },
      { candidateHosts: ["new-backup.bilivideo.com", "evil.example", "new-backup.bilivideo.com"] });
    assert.equal(rows.length, 5);
    assert.ok(rows.every(item => item.untested && !item.ok && item.kbps === 0));
    assert.equal(rows.find(item => item.host === "new-backup.bilivideo.com").observed, true);
    assert.ok(!rows.some(item => item.host === "evil.example"));
  }
});

test("Akamai 清空测量结果后仍保留预置目录，但不伪造可用速度", () => {
  const rows = popupRows({ disabledHosts: [] }, { phase: "original", passthroughReason: "baseline-akamai", lastDetectedAt: 1, originalHost: "upos-hz-mirrorakam.akamaized.net", results: [] });
  assert.equal(rows.length, 3);
  assert.ok(rows.every(item => item.preset && item.untested && !item.ok));
});

test("运行代码从不自动打开弹窗或注入播放页面板", () => {
  const runtimeFiles = fs.readdirSync(path.join(root, "src")).filter(file => file.endsWith(".js"));
  for (const file of runtimeFiles) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, "src", file), "utf8"), /action\.openPopup|window\.open\(|tabs\.create\(|notifications\.create/);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(root, "src/content.js"), "utf8"), /document\.createElement|appendChild/);
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
