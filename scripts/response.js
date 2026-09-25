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
  state.version = 2;
  if (typeof $persistentStore !== "undefined") {
    $persistentStore.write(JSON.stringify(state), STORE_KEY);
  } else {
    $prefs.setValueForKey(JSON.stringify(state), STORE_KEY);
  }
}

function validHostname(value) {
  const host = String(value || "").toLowerCase();
  return host.endsWith(".bilivideo.com")
    && /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(host);
}

const args = parseArgs(typeof $argument === "undefined" ? "" : $argument);
const threshold = Math.min(5, Math.max(1, Number.parseInt(args.failure_threshold, 10) || 2));
const failureSeconds = Math.min(3600, Math.max(60, Number.parseInt(
  args.failure_ttl || args.blacklist_ttl, 10,
) || 600));
const successSeconds = Math.min(86400, Math.max(300, Number.parseInt(args.success_ttl, 10) || 10800));
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
      const now = Date.now();
      state.blacklist = state.blacklist || {};
      state.blacklist[host] = now + failureSeconds * 1000;
      const next = (Array.isArray(state.scores) ? state.scores : [])
        .filter((item) => item && item.ok && validHostname(item.host) && item.host !== host
          && Number(item.sampledAt) > now - successSeconds * 1000
          && !(state.blacklist[item.host] > now))
        .sort((a, b) => (Number(b.kbps) || 0) - (Number(a.kbps) || 0))[0];
      state.selectedHost = next ? next.host : null;
      if (!next) state.expiresAt = 0;
      state.lastHealthAt = 0;
      state.lastSuccessAt = 0;
      state.noWinnerUntil = 0;
      state.fullRetestAfter = now + 15000;
      state.failureCount = 0;
      const subtitle = `${host} 已暂时停用`;
      const body = next
        ? `HTTP ${status}；下一条视频请求立即改用 ${next.host}。`
        : `HTTP ${status}；下一条请求先用原始 CDN，安全延迟后再测速。`;
      if (typeof $notification !== "undefined") $notification.post("Bili CDN Auto", subtitle, body);
      else if (typeof $notify !== "undefined") $notify("Bili CDN Auto", subtitle, body);
    }
  }
  writeState(state);
}

$done({});
