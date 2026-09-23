/*
 * Bili CDN Auto - Surge request script
 * SPDX-License-Identifier: MIT
 *
 * Benchmarks compatible Bilibili CDN hosts with the current signed media URL,
 * caches the winner per network, and rewrites subsequent requests.
 */

"use strict";

const STORE_KEY = "bili-cdn-auto-state-v1";
const PROBE_HEADER = "X-Bili-CDN-Auto-Probe";
const DEFAULT_CANDIDATES = [
  "upos-sz-mirroraliov.bilivideo.com",
  "upos-sz-mirrorcosov.bilivideo.com",
  "upos-sz-mirrorhwov.bilivideo.com",
];

function parseArgs(raw) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return { ...raw };
  }
  const result = {};
  for (const part of String(raw || "").split("&")) {
    if (!part) continue;
    const index = part.indexOf("=");
    const key = decodeURIComponent(index < 0 ? part : part.slice(0, index));
    const value = decodeURIComponent(index < 0 ? "" : part.slice(index + 1));
    result[key] = value;
  }
  return result;
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function validHostname(value) {
  const host = String(value || "").toLowerCase();
  return host.endsWith(".bilivideo.com") && /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(host);
}

function parseCandidates(raw) {
  const values = String(raw || "")
    .split(/[|;]/)
    .map((value) => value.trim().toLowerCase())
    .filter(validHostname);
  return [...new Set(values.length ? values : DEFAULT_CANDIDATES)].slice(0, 8);
}

function getHeader(headers, target) {
  const wanted = target.toLowerCase();
  for (const key of Object.keys(headers || {})) {
    if (key.toLowerCase() === wanted) return headers[key];
  }
  return undefined;
}

function setHeader(headers, target, value, onlyIfPresent = false) {
  const wanted = target.toLowerCase();
  let found = false;
  for (const key of Object.keys(headers || {})) {
    if (key.toLowerCase() === wanted) {
      headers[key] = value;
      found = true;
    }
  }
  if (!found && !onlyIfPresent) headers[target] = value;
}

function networkKey(network) {
  const info = network || {};
  if (info.wifi && info.wifi.ssid) return `wifi:${info.wifi.ssid}`;
  const cellular = info["cellular-data"] || {};
  if (cellular.carrier || cellular.radio) {
    return `cellular:${cellular.carrier || "unknown"}:${cellular.radio || "unknown"}`;
  }
  const v4 = info.v4 || {};
  return `network:${v4.primaryInterface || "unknown"}:${v4.primaryRouter || "unknown"}`;
}

function isMediaUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch (_) {
    return false;
  }
  if (!url.pathname.startsWith("/upgcxcode/")) return false;
  const host = url.hostname.toLowerCase();
  return (
    host.endsWith(".bilivideo.com") ||
    host.endsWith(".mcdn.bilivideo.cn") ||
    host.endsWith(".akamaized.net") ||
    url.port === "4480"
  );
}

function rewrittenUrl(input, hostname) {
  const url = new URL(input);
  url.hostname = hostname;
  url.port = "";
  return url.toString();
}

function chooseBest(results) {
  const viable = (results || []).filter((item) => item && item.ok);
  viable.sort((a, b) => {
    if (a.elapsedMs !== b.elapsedMs) return a.elapsedMs - b.elapsedMs;
    return b.bytes - a.bytes;
  });
  return viable[0] || null;
}

function loadState(store) {
  try {
    return JSON.parse(store.read(STORE_KEY) || "{}") || {};
  } catch (_) {
    return {};
  }
}

function saveState(store, state) {
  state.version = 1;
  return store.write(JSON.stringify(state), STORE_KEY);
}

function fallbackHost(args) {
  const value = String(args.fallback || "original").trim().toLowerCase();
  return validHostname(value) ? value : null;
}

function applyHost(request, host) {
  if (!host) return {};
  const headers = { ...(request.headers || {}) };
  setHeader(headers, "Host", host);
  setHeader(headers, ":authority", host, true);
  return { url: rewrittenUrl(request.url, host), headers };
}

function probeHeaders(request, bytes) {
  const source = request.headers || {};
  const result = {
    Range: `bytes=0-${bytes - 1}`,
    "Accept-Encoding": "identity",
    [PROBE_HEADER]: "1",
  };
  for (const name of ["User-Agent", "Referer", "Origin", "Accept"]) {
    const value = getHeader(source, name);
    if (value !== undefined) result[name] = value;
  }
  return result;
}

function byteLength(data) {
  if (data == null) return 0;
  if (typeof data === "string") return data.length;
  if (typeof data.byteLength === "number") return data.byteLength;
  if (typeof data.length === "number") return data.length;
  return 0;
}

function httpProbe(client, request, host, bytes, timeoutSeconds) {
  return new Promise((resolve) => {
    const started = Date.now();
    const options = {
      url: rewrittenUrl(request.url, host),
      headers: probeHeaders(request, bytes),
      timeout: timeoutSeconds,
      "binary-mode": true,
      "auto-redirect": false,
      "auto-cookie": false,
    };
    client.get(options, (error, response, data) => {
      const elapsedMs = Math.max(1, Date.now() - started);
      const status = Number(response && (response.status || response.statusCode));
      const received = byteLength(data);
      const ok = !error && (status === 200 || status === 206) && received > 0;
      resolve({
        host,
        ok,
        status: status || 0,
        bytes: received,
        elapsedMs,
        kbps: ok ? Math.round((received * 8) / elapsedMs) : 0,
        error: error ? String(error) : "",
      });
    });
  });
}

async function run(runtime) {
  const { request, argument, network, store, client, done, notify, log } = runtime;
  if (!request || !isMediaUrl(request.url)) return done({});
  if (getHeader(request.headers || {}, PROBE_HEADER) === "1") return done({});

  const args = parseArgs(argument);
  const candidates = parseCandidates(args.candidates);
  const ttlMs = clampInteger(args.cache_ttl, 3600, 60, 86400) * 1000;
  const healthTtlMs = clampInteger(args.health_ttl, 60, 30, 3600) * 1000;
  const probeBytes = clampInteger(args.probe_bytes, 65536, 4096, 262144);
  const probeTimeout = clampInteger(args.probe_timeout, 3, 1, 8);
  const blacklistMs = clampInteger(args.blacklist_ttl, 300, 30, 3600) * 1000;
  const now = Date.now();
  const currentNetwork = networkKey(network);
  const state = loadState(store);

  state.blacklist = state.blacklist || {};
  for (const [host, until] of Object.entries(state.blacklist)) {
    if (!Number.isFinite(until) || until <= now) delete state.blacklist[host];
  }

  if (state.network !== currentNetwork) {
    state.network = currentNetwork;
    state.selectedHost = null;
    state.expiresAt = 0;
    state.noWinnerUntil = 0;
    state.lockUntil = 0;
    state.scores = [];
  }

  if (state.forcedHost === "original") {
    saveState(store, state);
    return done({});
  }
  if (validHostname(state.forcedHost)) {
    saveState(store, state);
    return done(applyHost(request, state.forcedHost));
  }

  const hasCachedHost =
    validHostname(state.selectedHost) &&
    state.expiresAt > now &&
    !(state.blacklist[state.selectedHost] > now);
  if (hasCachedHost) {
    const lastKnownGood = Math.max(state.lastHealthAt || 0, state.lastSuccessAt || 0);
    if (lastKnownGood + healthTtlMs > now || state.lockUntil > now) {
      saveState(store, state);
      return done(applyHost(request, state.selectedHost));
    }

    state.lockUntil = now + (probeTimeout + 2) * 1000;
    saveState(store, state);
    const health = await httpProbe(client, request, state.selectedHost, probeBytes, probeTimeout);
    state.lockUntil = 0;
    if (health.ok) {
      state.lastHealthAt = Date.now();
      saveState(store, state);
      return done(applyHost(request, state.selectedHost));
    }

    state.blacklist[state.selectedHost] = Date.now() + blacklistMs;
    state.selectedHost = null;
    state.expiresAt = 0;
    state.lastHealthAt = 0;
    state.lastSuccessAt = 0;
  }

  const fallback = fallbackHost(args);
  if (state.noWinnerUntil > now || state.lockUntil > now) {
    saveState(store, state);
    return done(applyHost(request, fallback));
  }

  const available = candidates.filter((host) => !(state.blacklist[host] > now));
  if (!available.length) {
    state.blacklist = {};
    available.push(...candidates);
  }

  state.lockUntil = now + (probeTimeout + 2) * 1000;
  saveState(store, state);

  let results;
  try {
    results = await Promise.all(
      available.map((host) => httpProbe(client, request, host, probeBytes, probeTimeout)),
    );
  } catch (error) {
    results = [];
    log(`probe failed: ${String(error)}`);
  }

  const winner = chooseBest(results);
  state.lockUntil = 0;
  state.lastProbeAt = Date.now();
  state.lastOriginalHost = new URL(request.url).hostname;
  state.scores = results.map(({ host, ok, status, bytes, elapsedMs, kbps }) => ({
    host,
    ok,
    status,
    bytes,
    elapsedMs,
    kbps,
  }));

  if (!winner) {
    state.selectedHost = null;
    state.expiresAt = 0;
    state.noWinnerUntil = Date.now() + 120000;
    saveState(store, state);
    if (!state.lastNoWinnerNoticeAt || Date.now() - state.lastNoWinnerNoticeAt > 3600000) {
      state.lastNoWinnerNoticeAt = Date.now();
      saveState(store, state);
      notify("Bili CDN Auto", "测速没有可用节点", "暂时沿用原始 CDN，2 分钟后再试。");
    }
    return done(applyHost(request, fallback));
  }

  state.selectedHost = winner.host;
  state.expiresAt = Date.now() + ttlMs;
  state.lastHealthAt = Date.now();
  state.lastSuccessAt = 0;
  state.noWinnerUntil = 0;
  state.failureCount = 0;
  state.blacklist[winner.host] = 0;
  state.blacklistTtl = blacklistMs;
  saveState(store, state);
  log(`selected ${winner.host}, ${winner.elapsedMs} ms, ${winner.kbps} kbps`);
  return done(applyHost(request, winner.host));
}

function runtimeAdapter() {
  const store = typeof $persistentStore !== "undefined"
    ? $persistentStore
    : {
        read: (key) => (typeof $prefs !== "undefined" ? $prefs.valueForKey(key) : null),
        write: (value, key) => (typeof $prefs !== "undefined" ? $prefs.setValueForKey(value, key) : false),
      };
  const client = typeof $httpClient !== "undefined"
    ? $httpClient
    : {
        get: (options, callback) => {
          if (typeof $task === "undefined") {
            callback("No supported HTTP client", null, null);
            return;
          }
          $task.fetch({ ...options, method: "GET" }).then(
            (response) => callback(
              null,
              { status: response.statusCode, headers: response.headers },
              response.bodyBytes || response.body,
            ),
            (error) => callback(String(error), null, null),
          );
        },
      };
  return {
    request: typeof $request === "undefined" ? null : $request,
    argument: typeof $argument === "undefined" ? "" : $argument,
    network: typeof $network === "undefined" ? {} : $network,
    store,
    client,
    done: $done,
    notify: (title, subtitle, body) => {
      if (typeof $notification !== "undefined") $notification.post(title, subtitle, body);
      else if (typeof $notify !== "undefined") $notify(title, subtitle, body);
    },
    log: (message) => console.log(`[Bili CDN Auto] ${message}`),
  };
}

if (typeof $request !== "undefined") {
  run(runtimeAdapter()).catch((error) => {
    console.log(`[Bili CDN Auto] fatal: ${String(error)}`);
    $done({});
  });
}

if (typeof module !== "undefined") {
  module.exports = {
    STORE_KEY,
    applyHost,
    chooseBest,
    isMediaUrl,
    networkKey,
    parseArgs,
    parseCandidates,
    rewrittenUrl,
    run,
    validHostname,
  };
}
