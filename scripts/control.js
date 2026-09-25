/* Bili CDN Auto - manual/Shortcuts control and panel. SPDX-License-Identifier: MIT */
"use strict";

const STORE_KEY = "bili-cdn-auto-state-v1";
const ALIASES = {
  ali: "upos-sz-mirrorali.bilivideo.com",
  cos: "upos-sz-mirrorcos.bilivideo.com",
  hw: "upos-sz-mirrorhw.bilivideo.com",
  aliov: "upos-sz-mirroraliov.bilivideo.com",
  cosov: "upos-sz-mirrorcosov.bilivideo.com",
  hwov: "upos-sz-mirrorhwov.bilivideo.com",
};

function readState() {
  try {
    const value = typeof $persistentStore !== "undefined"
      ? $persistentStore.read(STORE_KEY)
      : $prefs.valueForKey(STORE_KEY);
    return JSON.parse(value || "{}") || {};
  } catch (_) {
    return {};
  }
}

function writeState(state) {
  state.version = 2;
  if (typeof $persistentStore !== "undefined") {
    $persistentStore.write(JSON.stringify(state), STORE_KEY);
  } else {
    $prefs.setValueForKey(JSON.stringify(state), STORE_KEY);
  }
}

function validHostname(value) {
  const host = String(value || "").toLowerCase();
  return host.endsWith(".bilivideo.com") && /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(host);
}

function remaining(expiresAt) {
  if (!expiresAt || expiresAt <= Date.now()) return "已过期";
  const minutes = Math.ceil((expiresAt - Date.now()) / 60000);
  return `${minutes} 分钟`;
}

function statusText(state) {
  const mode = state.forcedHost === "original"
    ? "原始 CDN"
    : state.forcedHost
      ? `固定：${state.forcedHost}`
      : "自动";
  const selected = state.selectedHost || "尚未选择";
  const scores = (state.scores || [])
    .filter((item) => item.ok)
    .sort((a, b) => a.elapsedMs - b.elapsedMs)
    .slice(0, 3)
    .map((item) => `${item.host}: ${item.elapsedMs}ms / ${item.kbps}kbps`)
    .join("\n");
  return [
    `模式：${mode}`,
    `当前：${selected}`,
    `网络：${state.network || "未知"}`,
    `完整缓存：${remaining(state.expiresAt)}`,
    `轻量复核：${state.lastVerifiedAt ? new Date(state.lastVerifiedAt).toLocaleTimeString() : "尚未"}`,
    scores ? `最近测速：\n${scores}` : "最近测速：无",
  ].join("\n");
}

const state = readState();
const isPanel = typeof $input !== "undefined" && $input && $input.purpose === "panel";
if (isPanel) {
  $done({
    title: "Bili CDN Auto",
    content: statusText(state),
    icon: "bolt.horizontal.circle.fill",
    "icon-color": "#00A1D6",
  });
} else {
  const raw = typeof $intent !== "undefined" && $intent && $intent.parameter != null
    ? String($intent.parameter)
    : typeof $argument === "string" && $argument
      ? $argument
      : "status";
  const command = raw.trim().toLowerCase() || "status";
  let subtitle = "状态";
  let body = statusText(state);

  if (command === "retest") {
    state.selectedHost = null;
    state.expiresAt = 0;
    state.noWinnerUntil = 0;
    state.lockUntil = 0;
    state.scores = [];
    state.blacklist = {};
    state.lastHealthAt = 0;
    state.lastSuccessAt = 0;
    state.lastFullTestedAt = 0;
    state.lastVerifiedAt = 0;
    state.fullRetestAfter = 0;
    state.videoKey = "";
    state.videoFirstSeenAt = 0;
    state.verifiedVideoKey = "";
    subtitle = "已清除测速缓存";
    body = "下一条请求先正常开播，15 秒后的后续请求再测试候选 CDN。";
  } else if (command === "auto") {
    state.forcedHost = null;
    state.selectedHost = null;
    state.expiresAt = 0;
    state.noWinnerUntil = 0;
    state.lastHealthAt = 0;
    state.lastSuccessAt = 0;
    state.lastFullTestedAt = 0;
    state.lastVerifiedAt = 0;
    state.fullRetestAfter = 0;
    state.videoKey = "";
    state.videoFirstSeenAt = 0;
    state.verifiedVideoKey = "";
    subtitle = "已切换到自动模式";
    body = "下一条请求先正常开播，安全延迟后再自动测速。";
  } else if (command === "original" || command === "off") {
    state.forcedHost = "original";
    subtitle = "已使用原始 CDN";
    body = "模块仍启用，但不再改写视频 CDN。";
  } else if (ALIASES[command] || validHostname(command)) {
    state.forcedHost = ALIASES[command] || command;
    subtitle = "已固定 CDN";
    body = state.forcedHost;
  } else if (command !== "status") {
    subtitle = "无法识别的命令";
    body = "可用：status、retest、auto、original、ali、cos、hw、aliov、cosov、hwov。";
  }

  writeState(state);
  if (typeof $notification !== "undefined") $notification.post("Bili CDN Auto", subtitle, body);
  else if (typeof $notify !== "undefined") $notify("Bili CDN Auto", subtitle, body);
  $done();
}
