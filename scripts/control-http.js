/* Bili CDN Auto - cross-client local control endpoint. SPDX-License-Identifier: MIT */
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

const store = typeof $persistentStore !== "undefined"
  ? $persistentStore
  : {
      read: (key) => $prefs.valueForKey(key),
      write: (value, key) => $prefs.setValueForKey(value, key),
    };

function readState() {
  try {
    return JSON.parse(store.read(STORE_KEY) || "{}") || {};
  } catch (_) {
    return {};
  }
}

function validHostname(value) {
  const host = String(value || "").toLowerCase();
  return host.endsWith(".bilivideo.com") && /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(host);
}

function summary(state) {
  return {
    mode: state.forcedHost === "original" ? "original" : state.forcedHost ? "manual" : "auto",
    forcedHost: state.forcedHost || "",
    selectedHost: state.selectedHost || "",
    network: state.network || "unknown",
    expiresAt: state.expiresAt || 0,
    lastFullTestedAt: state.lastFullTestedAt || 0,
    lastVerifiedAt: state.lastVerifiedAt || 0,
    scores: Array.isArray(state.scores) ? state.scores : [],
  };
}

let url;
try {
  url = new URL($request.url);
} catch (_) {
  url = new URL("http://bili-cdn-auto.invalid/status");
}
const command = (url.pathname.split("/").filter(Boolean)[0] || "status").toLowerCase();
const state = readState();
let message = "状态已读取";

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
  message = "缓存已清除；下一条请求先正常开播，15 秒后的后续请求再测速";
} else if (command === "auto") {
  state.forcedHost = null;
  state.selectedHost = null;
  state.expiresAt = 0;
  state.noWinnerUntil = 0;
  state.lastFullTestedAt = 0;
  state.lastVerifiedAt = 0;
  state.fullRetestAfter = 0;
  state.videoKey = "";
  state.videoFirstSeenAt = 0;
  state.verifiedVideoKey = "";
  message = "已切换到自动模式；下一条请求先正常开播，安全延迟后再测速";
} else if (command === "original" || command === "off") {
  state.forcedHost = "original";
  message = "已恢复 B 站原始 CDN";
} else if (command === "set") {
  const requested = (url.searchParams.get("host") || "").toLowerCase();
  const host = ALIASES[requested] || requested;
  if (validHostname(host)) {
    state.forcedHost = host;
    message = `已固定到 ${host}`;
  } else {
    message = "host 参数无效";
  }
}

state.version = 2;
store.write(JSON.stringify(state), STORE_KEY);
const body = JSON.stringify({ ok: true, command, message, ...summary(state) }, null, 2);
const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
};

if (typeof $task !== "undefined") {
  $done({ status: "HTTP/1.1 200 OK", headers, body });
} else {
  $done({ response: { status: 200, headers, body } });
}
