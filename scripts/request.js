/* Bili CDN Auto - adaptive mobile request script. SPDX-License-Identifier: MIT */
"use strict";

const STORE_KEY = "bili-cdn-auto-state-v1";
const PROBE_HEADER = "X-Bili-CDN-Auto-Probe";
const DEFAULT_CANDIDATES = [
  "upos-sz-mirroraliov.bilivideo.com",
  "upos-sz-mirrorcosov.bilivideo.com",
  "upos-sz-mirrorhwov.bilivideo.com",
];
const DEFAULT_POLICY = Object.freeze({
  successTtlSeconds: 10800,
  failureTtlSeconds: 600,
  verifyIntervalSeconds: 900,
  verifyDelaySeconds: 15,
  quickProbeBytes: 128 * 1024,
  verifyProbeBytes: 128 * 1024,
  quickProbeTimeoutSeconds: 4,
  switchGainPercent: 120,
});

function parseArgs(raw) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return { ...raw };
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

function firstArgument(args, names, fallback) {
  for (const name of names) {
    if (args[name] !== undefined && args[name] !== "") return args[name];
  }
  return fallback;
}

function policyFromArgs(args) {
  return {
    successTtlMs: clampInteger(firstArgument(args, ["success_ttl", "cache_ttl"], 10800), 10800, 300, 86400) * 1000,
    failureTtlMs: clampInteger(firstArgument(args, ["failure_ttl", "blacklist_ttl"], 600), 600, 60, 3600) * 1000,
    verifyIntervalMs: clampInteger(args.verify_interval, 900, 300, 3600) * 1000,
    verifyDelayMs: clampInteger(args.verify_delay, 15, 10, 30) * 1000,
    quickProbeBytes: clampInteger(firstArgument(args, ["quick_probe_bytes", "probe_bytes"], 128 * 1024), 128 * 1024, 16 * 1024, 256 * 1024),
    verifyProbeBytes: clampInteger(args.verify_probe_bytes, 128 * 1024, 128 * 1024, 256 * 1024),
    quickProbeTimeoutSeconds: clampInteger(firstArgument(args, ["quick_probe_timeout", "probe_timeout"], 4), 4, 2, 8),
    switchGainRatio: clampInteger(args.switch_gain, 120, 100, 300) / 100,
  };
}

function validHostname(value) {
  const host = String(value || "").toLowerCase();
  return host.endsWith(".bilivideo.com")
    && /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(host);
}

function parseCandidates(raw) {
  const values = String(raw || "").split(/[|;]/)
    .map((value) => value.trim().toLowerCase()).filter(validHostname);
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
  try { url = new URL(input); } catch (_) { return false; }
  if (!url.pathname.startsWith("/upgcxcode/")) return false;
  const host = url.hostname.toLowerCase();
  return host.endsWith(".bilivideo.com") || host.endsWith(".mcdn.bilivideo.cn")
    || host.endsWith(".akamaized.net") || url.port === "4480";
}

function mediaKey(input) {
  try {
    const url = new URL(input);
    const match = url.pathname.match(/^\/upgcxcode\/([^/]+)\/([^/]+)\/([^/]+)(?:\/|$)/i);
    return match ? `/upgcxcode/${match[1]}/${match[2]}/${match[3]}` : url.pathname;
  } catch (_) { return ""; }
}

function rewrittenUrl(input, hostname) {
  const url = new URL(input);
  url.hostname = hostname;
  url.port = "";
  return url.toString();
}

function resultRate(item) {
  if (Number(item && item.kbps) > 0) return Number(item.kbps);
  return (Math.max(0, Number(item && item.bytes) || 0) * 8)
    / Math.max(1, Number(item && item.elapsedMs) || 0);
}

function rankResults(results) {
  return [...(results || [])].filter((item) => item && item.ok && validHostname(item.host))
    .sort((a, b) => resultRate(b) - resultRate(a) || (a.elapsedMs || 0) - (b.elapsedMs || 0));
}

function chooseBest(results) { return rankResults(results)[0] || null; }

function loadState(store) {
  try { return JSON.parse(store.read(STORE_KEY) || "{}") || {}; } catch (_) { return {}; }
}

function saveState(store, state) {
  state.version = 2;
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
  const result = { Range: `bytes=0-${bytes - 1}`, "Accept-Encoding": "identity", [PROBE_HEADER]: "1" };
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

function httpProbe(client, request, host, bytes, timeoutSeconds, stage) {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish({
      host, ok: false, status: 0, bytes: 0, elapsedMs: Math.max(1, Date.now() - started),
      kbps: 0, error: "timeout", stage,
    }), timeoutSeconds * 1000);
    client.get({
      url: rewrittenUrl(request.url, host), headers: probeHeaders(request, bytes),
      "binary-mode": true, "auto-redirect": false, "auto-cookie": false,
    }, (error, response, data) => {
      const elapsedMs = Math.max(1, Date.now() - started);
      const status = Number(response && (response.status || response.statusCode));
      const received = Math.min(bytes, byteLength(data));
      const ok = !error && (status === 200 || status === 206) && received > 0;
      finish({
        host, ok, status: status || 0, bytes: received, elapsedMs,
        kbps: ok ? Math.round((received * 8) / elapsedMs) : 0,
        error: error ? String(error) : "", stage,
      });
    });
  });
}

function stampResults(results, sampledAt = Date.now()) {
  return (results || []).map((item) => ({ ...item, sampledAt }));
}

function mergeResults(previous, updates) {
  const merged = new Map((previous || []).filter((item) => validHostname(item && item.host))
    .map((item) => [item.host, item]));
  for (const item of updates || []) merged.set(item.host, item);
  return [...merged.values()];
}

function freshResults(results, now, policy) {
  return (results || []).filter((item) => {
    const sampledAt = Number(item && item.sampledAt) || 0;
    const ttl = item && item.ok ? policy.successTtlMs : policy.failureTtlMs;
    return validHostname(item && item.host) && sampledAt > 0 && sampledAt <= now + 60000
      && now - sampledAt < ttl;
  });
}

function nextBackup(state, candidates, now, policy) {
  return rankResults(freshResults(state.scores, now, policy)).find((item) => (
    item.host !== state.selectedHost && candidates.includes(item.host)
    && !(state.blacklist[item.host] > now)
  )) || null;
}

function resetAutomaticState(state) {
  Object.assign(state, {
    selectedHost: null, expiresAt: 0, noWinnerUntil: 0, lockUntil: 0, scores: [],
    lastFullTestedAt: 0, lastVerifiedAt: 0, fullRetestAfter: 0, verifiedVideoKey: "",
    videoKey: "", videoFirstSeenAt: 0,
  });
}

async function fullBenchmark({ state, request, client, candidates, policy, notify, log, now, store }) {
  const available = candidates.filter((host) => !(state.blacklist[host] > now));
  if (!available.length) {
    state.blacklist = {};
    available.push(...candidates);
  }
  state.lockUntil = now + (policy.quickProbeTimeoutSeconds + 2) * 1000;
  saveState(store, state);
  const quick = stampResults(await Promise.all(available.map((host) => httpProbe(
    client, request, host, policy.quickProbeBytes, policy.quickProbeTimeoutSeconds, "quick",
  ))));
  const quickRanked = rankResults(quick);
  if (!quickRanked.length) {
    const failedAt = Date.now();
    state.scores = mergeResults(freshResults(state.scores, failedAt, policy), quick);
    Object.assign(state, {
      lastFullTestedAt: failedAt, lastVerifiedAt: failedAt, lockUntil: 0,
      fullRetestAfter: 0, noWinnerUntil: failedAt + policy.failureTtlMs,
    });
    if (!validHostname(state.selectedHost) || state.blacklist[state.selectedHost] > failedAt) {
      state.selectedHost = null;
      state.expiresAt = 0;
    }
    if (!state.lastNoWinnerNoticeAt || failedAt - state.lastNoWinnerNoticeAt > 3600000) {
      state.lastNoWinnerNoticeAt = failedAt;
      notify("Bili CDN Auto", "测速没有可用节点", "暂时沿用原始 CDN，10 分钟后再试。");
    }
    return state.selectedHost;
  }
  const completedAt = Date.now();
  const completed = quick.map((item) => ({ ...item, sampledAt: completedAt }));
  const winner = chooseBest(completed);
  Object.assign(state, {
    selectedHost: winner.host, scores: completed, expiresAt: completedAt + policy.successTtlMs,
    lastFullTestedAt: completedAt, lastVerifiedAt: completedAt,
    verifiedVideoKey: state.videoKey || "", fullRetestAfter: 0,
    noWinnerUntil: 0, lockUntil: 0, failureCount: 0,
  });
  state.blacklist[winner.host] = 0;
  log(`selected ${winner.host}, ${winner.elapsedMs} ms, ${winner.kbps} kbps`);
  return winner.host;
}

async function lightVerify({ state, request, client, candidates, policy, now, store }) {
  const backup = nextBackup(state, candidates, now, policy);
  if (!backup) return { needsFull: true, selectedHost: state.selectedHost };
  const previousHost = state.selectedHost;
  state.lockUntil = now + (policy.quickProbeTimeoutSeconds + 2) * 1000;
  saveState(store, state);
  const results = stampResults(await Promise.all([previousHost, backup.host].map((host) => httpProbe(
    client, request, host, policy.verifyProbeBytes, policy.quickProbeTimeoutSeconds, "verify",
  ))));
  const verifiedAt = Date.now();
  state.scores = mergeResults(freshResults(state.scores, verifiedAt, policy), results);
  state.lastVerifiedAt = verifiedAt;
  state.verifiedVideoKey = state.videoKey || "";
  state.lockUntil = 0;
  const byHost = new Map(results.map((item) => [item.host, item]));
  const current = byHost.get(previousHost);
  const alternative = byHost.get(backup.host);
  const shouldSwitch = alternative && alternative.ok
    && (!current || !current.ok || resultRate(alternative) >= resultRate(current) * policy.switchGainRatio);
  if (!current || !current.ok) state.blacklist[previousHost] = verifiedAt + policy.failureTtlMs;
  if (shouldSwitch) state.selectedHost = alternative.host;
  if (!current || !current.ok || shouldSwitch) state.fullRetestAfter = verifiedAt + policy.verifyDelayMs;
  if ((!current || !current.ok) && !shouldSwitch) {
    state.selectedHost = null;
    return { needsFull: true, selectedHost: null };
  }
  return { needsFull: false, selectedHost: state.selectedHost };
}

async function run(runtime) {
  const { request, argument, network, store, client, done, notify, log } = runtime;
  if (!request || !isMediaUrl(request.url)) return done({});
  if (getHeader(request.headers || {}, PROBE_HEADER) === "1") return done({});
  const args = parseArgs(argument);
  const policy = policyFromArgs(args);
  const candidates = parseCandidates(args.candidates);
  const fallback = fallbackHost(args);
  const now = Date.now();
  const currentNetwork = networkKey(network);
  const state = loadState(store);
  state.blacklist = state.blacklist || {};
  state.scores = freshResults(state.scores, now, policy);
  for (const [host, until] of Object.entries(state.blacklist)) {
    if (!Number.isFinite(until) || until <= now) delete state.blacklist[host];
  }
  if (state.network !== currentNetwork) {
    state.network = currentNetwork;
    resetAutomaticState(state);
  }
  const nextVideoKey = mediaKey(request.url);
  const newVideo = Boolean(nextVideoKey && nextVideoKey !== state.videoKey);
  if (newVideo) {
    state.videoKey = nextVideoKey;
    state.videoFirstSeenAt = now;
    state.verifiedVideoKey = "";
    if (state.expiresAt <= now && validHostname(state.selectedHost)) {
      state.fullRetestAfter = now + policy.verifyDelayMs;
    }
  }
  if (state.forcedHost === "original") {
    saveState(store, state);
    return done({});
  }
  if (validHostname(state.forcedHost)) {
    saveState(store, state);
    return done(applyHost(request, state.forcedHost));
  }
  const selectedUsable = validHostname(state.selectedHost) && !(state.blacklist[state.selectedHost] > now);
  if (newVideo && !selectedUsable) {
    state.fullRetestAfter = now + policy.verifyDelayMs;
    saveState(store, state);
    return done(applyHost(request, fallback));
  }
  if (selectedUsable) {
    if (newVideo || state.lockUntil > now) {
      saveState(store, state);
      return done(applyHost(request, state.selectedHost));
    }
    const safeDelayReached = now - (Number(state.videoFirstSeenAt) || now) >= policy.verifyDelayMs;
    const needsNewVideoVerify = safeDelayReached && state.videoKey && state.verifiedVideoKey !== state.videoKey;
    const periodicVerifyDue = safeDelayReached
      && (!state.lastVerifiedAt || now - state.lastVerifiedAt >= policy.verifyIntervalMs);
    const fullRetestDue = safeDelayReached && (state.expiresAt <= now
      || (state.fullRetestAfter > 0 && state.fullRetestAfter <= now));
    if (!fullRetestDue && (needsNewVideoVerify || periodicVerifyDue)) {
      const verification = await lightVerify({ state, request, client, candidates, policy, now, store });
      if (!verification.needsFull) {
        saveState(store, state);
        return done(applyHost(request, verification.selectedHost));
      }
    } else if (!fullRetestDue) {
      saveState(store, state);
      return done(applyHost(request, state.selectedHost));
    }
  }
  if (state.noWinnerUntil > now || state.lockUntil > now) {
    saveState(store, state);
    return done(applyHost(request, selectedUsable ? state.selectedHost : fallback));
  }
  if (state.fullRetestAfter > now
    || (state.videoKey && now - (Number(state.videoFirstSeenAt) || now) < policy.verifyDelayMs)) {
    saveState(store, state);
    return done(applyHost(request, fallback));
  }
  const winnerHost = await fullBenchmark({
    state, request, client, candidates, policy, notify, log, now, store,
  });
  saveState(store, state);
  return done(applyHost(request, winnerHost || fallback));
}

function runtimeAdapter() {
  const store = typeof $persistentStore !== "undefined" ? $persistentStore : {
    read: (key) => (typeof $prefs !== "undefined" ? $prefs.valueForKey(key) : null),
    write: (value, key) => (typeof $prefs !== "undefined" ? $prefs.setValueForKey(value, key) : false),
  };
  const client = typeof $httpClient !== "undefined" ? $httpClient : {
    get: (options, callback) => {
      if (typeof $task === "undefined") return callback("No supported HTTP client", null, null);
      $task.fetch({
        url: options.url, method: "GET", headers: options.headers,
        opts: { redirection: false, "auto-cookie": false },
      }).then(
        (response) => callback(null, { status: response.statusCode, headers: response.headers }, response.bodyBytes || response.body),
        (error) => callback(String(error && (error.error || error)), null, null),
      );
    },
  };
  return {
    request: typeof $request === "undefined" ? null : $request,
    argument: typeof $argument === "undefined"
      ? (typeof $environment !== "undefined" && $environment.variables ? $environment.variables : "")
      : $argument,
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
    DEFAULT_POLICY, STORE_KEY, applyHost, chooseBest, freshResults, isMediaUrl, mediaKey,
    networkKey, parseArgs, parseCandidates, policyFromArgs, rankResults, rewrittenUrl, run,
    validHostname,
  };
}
