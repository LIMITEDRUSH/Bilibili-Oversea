/* Bili CDN Auto - Surge response health script. SPDX-License-Identifier: MIT */
"use strict";

const STORE_KEY = "bili-cdn-auto-state-v1";

function parseArgs(raw) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return { ...raw };
  const result = {};
  for (const part of String(raw || "").split("&")) {
    const index = part.indexOf("=");
    if (index > 0) result[part.slice(0, index)] = decodeURIComponent(part.slice(index + 1));
  }
  return result;
}

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
  state.version = 1;
  if (typeof $persistentStore !== "undefined") {
    $persistentStore.write(JSON.stringify(state), STORE_KEY);
  } else {
    $prefs.setValueForKey(JSON.stringify(state), STORE_KEY);
  }
}

const args = parseArgs(typeof $argument === "undefined" ? "" : $argument);
const threshold = Math.min(5, Math.max(1, Number.parseInt(args.failure_threshold, 10) || 2));
const blacklistSeconds = Math.min(3600, Math.max(30, Number.parseInt(args.blacklist_ttl, 10) || 300));
const state = readState();
const status = Number($response.status || $response.statusCode || 0);
let host = "";
try {
  host = new URL($request.url).hostname.toLowerCase();
} catch (_) {}

if (host && host === state.selectedHost) {
  if (status === 200 || status === 206) {
    state.failureCount = 0;
    state.lastSuccessAt = Date.now();
  } else if (status === 403 || status === 404 || status === 416 || status === 429 || status >= 500) {
    const immediate = status === 403 || status === 404 || status === 416;
    state.failureCount = immediate ? threshold : (state.failureCount || 0) + 1;
    if (state.failureCount >= threshold) {
      state.blacklist = state.blacklist || {};
      state.blacklist[host] = Date.now() + blacklistSeconds * 1000;
      state.selectedHost = null;
      state.expiresAt = 0;
      state.lastHealthAt = 0;
      state.lastSuccessAt = 0;
      state.noWinnerUntil = 0;
      state.failureCount = 0;
      const subtitle = `${host} 已暂时停用`;
      const body = `HTTP ${status}；下一条视频请求会自动选择其他节点。`;
      if (typeof $notification !== "undefined") $notification.post("Bili CDN Auto", subtitle, body);
      else if (typeof $notify !== "undefined") $notify("Bili CDN Auto", subtitle, body);
    }
  }
  writeState(state);
}

$done({});
