import {
  ADAPTIVE_POLICY,
  DEFAULT_CANDIDATES,
  DEFAULT_SETTINGS,
  isBiliVideoHost,
  isMediaUrl,
  makeRedirectRule,
  publicTabState,
  rankResults,
  resultFromTiming,
  sanitizeBenchmarkCache,
  sanitizeSettings,
  shouldSwitchAfterVerification,
  uniqueHosts,
} from "./engine.js";

const SETTINGS_KEY = "biliCdnAutoSettingsV2";
const BENCHMARK_CACHE_KEY = "biliCdnAutoBenchmarkV3";
const QUICK_PROBE_BYTES = 128 * 1024;
const QUICK_PROBE_TIMEOUT_MS = 4_500;
const SUSTAINED_PROBE_BYTES = 1024 * 1024;
const SUSTAINED_PROBE_TIMEOUT_MS = 9_000;
const SUSTAINED_FINALISTS = 3;
const tabStates = new Map();

const ruleId = (tabId) => 1_000_000 + tabId;

function newTabState() {
  return {
    phase: "waiting",
    sourceUrls: [],
    originalHost: "",
    observedHosts: new Set(),
    selectedHost: "",
    actualHost: "",
    ruleInstalled: false,
    discoverySource: "",
    lastDetectedAt: 0,
    pageUrl: "",
    videoKey: "",
    verifiedVideoKey: "",
    results: [],
    lastTestedAt: 0,
    lastVerifiedAt: 0,
    lastError: "",
    failedHosts: new Set(),
    runId: 0,
    testing: null,
  };
}

function stateFor(tabId) {
  if (!tabStates.has(tabId)) tabStates.set(tabId, newTabState());
  return tabStates.get(tabId);
}

async function readSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return sanitizeSettings(stored[SETTINGS_KEY] || DEFAULT_SETTINGS);
}

async function writeSettings(settings) {
  const safe = sanitizeSettings(settings);
  await chrome.storage.local.set({ [SETTINGS_KEY]: safe });
  return safe;
}

async function readBenchmarkCache() {
  const stored = await chrome.storage.local.get(BENCHMARK_CACHE_KEY);
  return sanitizeBenchmarkCache(stored[BENCHMARK_CACHE_KEY]);
}

async function writeBenchmarkCache(value) {
  const safe = sanitizeBenchmarkCache(value);
  await chrome.storage.local.set({ [BENCHMARK_CACHE_KEY]: safe });
  return safe;
}

function mergeResults(previous, updates) {
  const merged = new Map((previous || []).map((item) => [item.host, item]));
  for (const item of updates || []) merged.set(item.host, item);
  return [...merged.values()];
}

function stampResults(results, sampledAt = Date.now()) {
  return (results || []).map((item) => ({ ...item, sampledAt }));
}

async function persistStateCache(state, winnerHost = state.selectedHost) {
  return writeBenchmarkCache({
    winnerHost,
    results: state.results,
    lastFullTestedAt: state.lastTestedAt,
    lastVerifiedAt: state.lastVerifiedAt,
  });
}

async function setBadge(tabId, phase) {
  const badges = {
    testing: ["…", "#f59e0b"], verifying: ["·", "#f59e0b"], active: ["A", "#00a1d6"],
    manual: ["M", "#fb7299"], original: ["—", "#64748b"], error: ["!", "#dc2626"],
    waiting: ["", "#64748b"],
  };
  const [text, color] = badges[phase] || badges.waiting;
  await Promise.all([
    chrome.action.setBadgeText({ tabId, text }).catch(() => {}),
    chrome.action.setBadgeBackgroundColor({ tabId, color }).catch(() => {}),
  ]);
}

async function publish(tabId) {
  const state = publicTabState(tabStates.get(tabId));
  chrome.runtime.sendMessage({ type: "state-updated", tabId, state }).catch(() => {});
  chrome.tabs.sendMessage(tabId, { type: "state-update", state }).catch(() => {});
}

async function clearRule(tabId) {
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId(tabId)] }).catch(() => {});
  if (tabStates.has(tabId)) tabStates.get(tabId).ruleInstalled = false;
}

async function applyTarget(tabId, targetHost, phase = "active") {
  const state = stateFor(tabId);
  const rule = makeRedirectRule({
    id: ruleId(tabId), tabId, sourceHosts: [...state.observedHosts], targetHost,
  });
  const update = { removeRuleIds: [ruleId(tabId)] };
  if (rule) update.addRules = [rule];
  await chrome.declarativeNetRequest.updateSessionRules(update);
  state.selectedHost = targetHost;
  state.ruleInstalled = Boolean(rule);
  state.phase = phase;
  await setBadge(tabId, phase);
  await publish(tabId);
}

async function probeCandidates(tabId, sourceUrl, candidates, {
  byteLimit = QUICK_PROBE_BYTES,
  timeoutMs = QUICK_PROBE_TIMEOUT_MS,
  stage = "quick",
  waitForBufferSeconds = 0,
  waitTimeoutMs = 0,
} = {}) {
  let response;
  try {
    response = await chrome.tabs.sendMessage(tabId, {
      type: "probe-candidates",
      sourceUrl,
      hosts: candidates,
      byteLimit,
      timeoutMs,
      waitForBufferSeconds,
      waitTimeoutMs,
    });
  } catch (error) {
    response = { ok: false, error: String(error?.message || error), results: [] };
  }
  const rawResults = Array.isArray(response?.results) ? response.results : [];
  const byHost = new Map(rawResults
    .filter((item) => candidates.includes(String(item?.host || "").toLowerCase()))
    .map((item) => [String(item.host).toLowerCase(), item]));
  return candidates.map((host) => {
    const item = byHost.get(host);
    return resultFromTiming({
      host,
      ok: item?.ok === true,
      status: Number(item?.status) || 0,
      bytes: Math.min(byteLimit, Math.max(0, Number(item?.bytes) || 0)),
      elapsedMs: Math.max(0, Number(item?.elapsedMs) || 0),
      ttfbMs: Math.max(0, Number(item?.ttfbMs) || 0),
      error: item
        ? (item.error || "")
        : (response?.error || (response?.ok === false ? "probe unavailable" : "missing result")),
      stage,
    });
  });
}

async function benchmark(tabId, reason = "automatic") {
  const state = stateFor(tabId);
  if (state.testing) return state.testing;
  const sourceUrl = state.sourceUrls.find(isMediaUrl);
  if (!sourceUrl) return null;
  const testing = (async () => {
    const runId = ++state.runId;
    const settings = await readSettings();
    const disabled = new Set(settings.disabledHosts);
    const candidates = uniqueHosts([
      state.originalHost, ...DEFAULT_CANDIDATES, ...state.observedHosts, settings.manualHost,
    ], 8).filter((host) => !disabled.has(host));
    state.phase = "testing";
    state.lastError = "";
    await setBadge(tabId, "testing");
    await publish(tabId);

    const quickResults = await probeCandidates(tabId, sourceUrl, candidates);
    if (runId !== state.runId) return null;
    state.results = quickResults;
    const quickRanked = rankResults(quickResults, state.originalHost);
    if (!quickRanked.length) {
      const now = Date.now();
      state.results = stampResults(quickResults, now);
      state.lastTestedAt = now;
      state.lastVerifiedAt = now;
      state.verifiedVideoKey = state.videoKey;
      state.phase = "error";
      state.lastError = `测速没有可用节点（${reason}）`;
      state.selectedHost = "";
      await clearRule(tabId);
      await persistStateCache(state, "");
      await setBadge(tabId, "error");
      await publish(tabId);
      return null;
    }

    await applyTarget(tabId, quickRanked[0].host, "testing");
    const finalists = quickRanked.slice(0, SUSTAINED_FINALISTS).map((item) => item.host);
    const sustainedResults = await probeCandidates(tabId, sourceUrl, finalists, {
      byteLimit: SUSTAINED_PROBE_BYTES,
      timeoutMs: SUSTAINED_PROBE_TIMEOUT_MS,
      stage: "sustained",
      waitForBufferSeconds: 10,
      waitTimeoutMs: 15_000,
    });
    if (runId !== state.runId) return null;
    const sustainedByHost = new Map(sustainedResults
      .filter((item) => item.ok)
      .map((item) => [item.host, item]));
    const now = Date.now();
    state.results = stampResults(
      quickResults.map((item) => sustainedByHost.get(item.host) || item),
      now,
    );
    state.lastTestedAt = now;
    state.lastVerifiedAt = now;
    state.verifiedVideoKey = state.videoKey;
    state.failedHosts.clear();
    const finalRanked = rankResults(sustainedResults, state.originalHost);
    const winner = finalRanked[0] || quickRanked[0];
    await persistStateCache(state, winner.host);
    const latestSettings = await readSettings();
    if (!latestSettings.enabled || latestSettings.mode !== "auto") {
      await honorMode(tabId);
      return winner;
    }
    await applyTarget(tabId, winner.host, "active");
    if (reason === "manual") {
      chrome.tabs.sendMessage(tabId, { type: "retry-playback", reason: "manual-retest" }).catch(() => {});
    }
    return winner;
  })();
  state.testing = testing;
  const release = () => {
    if (state.testing === testing) state.testing = null;
  };
  testing.then(release, release);
  return testing;
}

async function hydrateFromCache(tabId, settings) {
  const state = stateFor(tabId);
  const disabled = new Set(settings.disabledHosts);
  const cache = await readBenchmarkCache();
  const results = cache.results.filter((item) => !disabled.has(item.host));
  const ranked = rankResults(results, state.originalHost);
  const winner = ranked.find((item) => item.host === cache.winnerHost) || ranked[0];
  state.results = results;
  state.lastTestedAt = cache.lastFullTestedAt;
  state.lastVerifiedAt = cache.lastVerifiedAt;
  if (!winner) {
    const recentFailure = results.some((item) => !item.ok)
      && Date.now() - cache.lastFullTestedAt < ADAPTIVE_POLICY.failureCacheMs;
    if (!recentFailure) return false;
    state.phase = "error";
    state.lastError = "近期测速均失败，10 分钟后自动重试";
    await clearRule(tabId);
    await setBadge(tabId, "error");
    await publish(tabId);
    return true;
  }
  state.lastError = "";
  await applyTarget(tabId, winner.host, "active");
  return true;
}

async function honorMode(tabId, { forceRetest = false } = {}) {
  const state = stateFor(tabId);
  const settings = await readSettings();
  if (!settings.enabled || settings.mode === "original") {
    if (state.phase === "original" && !state.ruleInstalled) return;
    state.phase = "original";
    state.selectedHost = "";
    await clearRule(tabId);
    await setBadge(tabId, "original");
    await publish(tabId);
    return;
  }
  if (settings.mode === "manual" && isBiliVideoHost(settings.manualHost)) {
    if (state.phase === "manual" && state.selectedHost === settings.manualHost) return;
    await applyTarget(tabId, settings.manualHost, "manual");
    return;
  }
  if (forceRetest) return benchmark(tabId, "manual");
  if (!state.selectedHost || !state.results.length) {
    if (!await hydrateFromCache(tabId, settings)) return benchmark(tabId, "automatic");
    return;
  }
  if (state.phase !== "active" && state.phase !== "verifying" && state.phase !== "testing") {
    await applyTarget(tabId, state.selectedHost, "active");
  }
}

function pageVideoKey(pageUrl, sourceUrl) {
  try {
    const page = new URL(String(pageUrl || ""));
    page.hash = "";
    return page.href;
  } catch {
    try {
      const media = new URL(String(sourceUrl || ""));
      return `${media.hostname}${media.pathname}`;
    } catch {
      return "";
    }
  }
}

async function rememberMedia(tabId, urls, { source = "page", observed = false, pageUrl = "" } = {}) {
  const state = stateFor(tabId);
  const valid = [...new Set((urls || []).filter(isMediaUrl))].slice(0, 4);
  if (!valid.length) return;
  const nextVideoKey = pageVideoKey(pageUrl || state.pageUrl, valid[0]);
  if (nextVideoKey && nextVideoKey !== state.videoKey) {
    state.videoKey = nextVideoKey;
    state.verifiedVideoKey = "";
  }
  if (pageUrl) state.pageUrl = String(pageUrl);
  state.sourceUrls = valid;
  for (const value of valid) state.observedHosts.add(new URL(value).hostname.toLowerCase());
  state.originalHost ||= new URL(valid[0]).hostname.toLowerCase();
  state.discoverySource = String(source || "page").slice(0, 40);
  state.lastDetectedAt = Date.now();
  if (observed) state.actualHost = new URL(valid[0]).hostname.toLowerCase();
  await honorMode(tabId);
  await publish(tabId);
}

async function resetForNavigation(tabId, pageUrl) {
  const state = stateFor(tabId);
  state.runId += 1;
  state.testing = null;
  state.sourceUrls = [];
  state.phase = "waiting";
  state.originalHost = "";
  state.actualHost = "";
  state.selectedHost = "";
  state.results = [];
  state.lastTestedAt = 0;
  state.lastVerifiedAt = 0;
  state.observedHosts.clear();
  state.failedHosts.clear();
  state.discoverySource = "";
  state.lastDetectedAt = 0;
  state.pageUrl = String(pageUrl || "");
  state.videoKey = pageVideoKey(pageUrl, "");
  state.verifiedVideoKey = "";
  await clearRule(tabId);
  await setBadge(tabId, "waiting");
  await publish(tabId);
}

function markHostFailed(state, host, reason) {
  const failed = resultFromTiming({
    host, ok: false, status: 0, bytes: 0, elapsedMs: 1, error: reason, stage: "verify",
  });
  failed.sampledAt = Date.now();
  state.results = mergeResults(state.results, [failed]);
}

async function recoverFromStall(tabId, reason = "stall") {
  const state = stateFor(tabId);
  if (state.testing) return state.testing;
  if (!state.selectedHost || !state.results.length) return benchmark(tabId, reason);
  const failedHost = state.selectedHost;
  state.failedHosts.add(failedHost);
  markHostFailed(state, failedHost, `playback ${reason}`);
  const disabled = new Set((await readSettings()).disabledHosts);
  const next = rankResults(state.results, state.originalHost)
    .find((item) => !state.failedHosts.has(item.host) && !disabled.has(item.host));
  if (next) {
    await applyTarget(tabId, next.host, "active");
    await persistStateCache(state, next.host);
    chrome.tabs.sendMessage(tabId, { type: "retry-playback", reason: "stall-recovery" }).catch(() => {});
    return next;
  }
  state.failedHosts.clear();
  return benchmark(tabId, "stall-exhausted");
}

async function lightVerify(tabId, reason = "periodic") {
  const state = stateFor(tabId);
  if (state.testing) return state.testing;
  const sourceUrl = state.sourceUrls.find(isMediaUrl);
  if (!sourceUrl || !state.selectedHost) return null;
  const settings = await readSettings();
  if (!settings.enabled || settings.mode !== "auto") return null;
  const disabled = new Set(settings.disabledHosts);
  const ranked = rankResults(state.results, state.originalHost)
    .filter((item) => !disabled.has(item.host) && !state.failedHosts.has(item.host));
  const backup = ranked.find((item) => item.host !== state.selectedHost);
  if (!backup) return benchmark(tabId, "verify-no-backup");
  const hosts = uniqueHosts([state.selectedHost, backup.host], 2);
  const operation = (async () => {
    state.phase = "verifying";
    state.lastError = "";
    await setBadge(tabId, "verifying");
    await publish(tabId);
    const now = Date.now();
    const verified = stampResults(await probeCandidates(tabId, sourceUrl, hosts, {
      byteLimit: ADAPTIVE_POLICY.lightProbeBytes,
      timeoutMs: ADAPTIVE_POLICY.lightProbeTimeoutMs,
      stage: "verify",
      waitForBufferSeconds: ADAPTIVE_POLICY.safeBufferSeconds,
      waitTimeoutMs: 4_000,
    }), now);
    state.results = mergeResults(state.results, verified);
    state.lastVerifiedAt = now;
    state.verifiedVideoKey = state.videoKey;
    const byHost = new Map(verified.map((item) => [item.host, item]));
    const current = byHost.get(state.selectedHost);
    const alternative = byHost.get(backup.host);
    const shouldSwitch = shouldSwitchAfterVerification(current, alternative);
    const needsFull = !current?.ok || shouldSwitch;
    if (shouldSwitch) await applyTarget(tabId, alternative.host, "active");
    else {
      state.phase = "active";
      await setBadge(tabId, "active");
      await publish(tabId);
    }
    await persistStateCache(state, state.selectedHost);
    return { needsFull, reason };
  })();
  state.testing = operation;
  let outcome;
  try {
    outcome = await operation;
  } finally {
    if (state.testing === operation) state.testing = null;
  }
  if (outcome?.needsFull) return benchmark(tabId, `verify-${reason}`);
  return outcome;
}

function activityAllowsProbe(activity) {
  return activity?.visible === true
    && activity.paused === false
    && activity.ended === false
    && activity.seeking === false
    && Number(activity.bufferedAhead) >= ADAPTIVE_POLICY.safeBufferSeconds;
}

async function maybeAdaptiveMaintenance(tabId, activity) {
  const state = stateFor(tabId);
  if (state.testing || !state.sourceUrls.length || !state.selectedHost || !activityAllowsProbe(activity)) return;
  const settings = await readSettings();
  if (!settings.enabled || settings.mode !== "auto") return;
  const now = Date.now();
  if (!state.lastTestedAt || now - state.lastTestedAt >= ADAPTIVE_POLICY.successCacheMs) {
    await benchmark(tabId, "cache-expired");
    return;
  }
  const newVideoNeedsVerification = Boolean(state.videoKey && state.verifiedVideoKey !== state.videoKey);
  const periodicVerificationDue = !state.lastVerifiedAt
    || now - state.lastVerifiedAt >= ADAPTIVE_POLICY.lightVerifyIntervalMs;
  if (newVideoNeedsVerification || periodicVerificationDue) {
    await lightVerify(tabId, newVideoNeedsVerification ? "new-video" : "periodic");
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const run = async () => {
    const senderTabId = sender.tab?.id;
    if (message?.type === "media-discovered" && Number.isInteger(senderTabId)) {
      await rememberMedia(senderTabId, message.urls, {
        source: message.source,
        observed: message.observed === true,
        pageUrl: message.pageUrl,
      });
      return { ok: true };
    }
    if (message?.type === "media-heartbeat" && Number.isInteger(senderTabId)) {
      const state = stateFor(senderTabId);
      if (state.sourceUrls.length) {
        await honorMode(senderTabId);
        await maybeAdaptiveMaintenance(senderTabId, message.activity);
      }
      return { ok: true };
    }
    if (message?.type === "page-changed" && Number.isInteger(senderTabId)) {
      await resetForNavigation(senderTabId, message.url);
      return { ok: true };
    }
    if (message?.type === "playback-stall" && Number.isInteger(senderTabId)) {
      await recoverFromStall(senderTabId, message.reason || "stall");
      return { ok: true };
    }
    if (message?.type === "network-changed" && Number.isInteger(senderTabId)) {
      const state = stateFor(senderTabId);
      state.lastTestedAt = 0;
      state.lastVerifiedAt = 0;
      state.selectedHost = "";
      state.failedHosts.clear();
      await clearRule(senderTabId);
      if (state.sourceUrls.length) await benchmark(senderTabId, "network-change");
      return { ok: true };
    }
    const tabId = Number(message?.tabId);
    if (message?.type === "get-state" && Number.isInteger(tabId)) {
      if (!tabStates.has(tabId)) chrome.tabs.sendMessage(tabId, { type: "rescan" }).catch(() => {});
      return { settings: await readSettings(), state: publicTabState(tabStates.get(tabId)) };
    }
    if (message?.type === "set-settings" && Number.isInteger(tabId)) {
      const settings = await writeSettings(message.settings);
      await honorMode(tabId, { forceRetest: message.forceRetest === true });
      if (message.applyNow === true) {
        chrome.tabs.sendMessage(tabId, { type: "retry-playback", reason: "manual-switch" }).catch(() => {});
      }
      return { ok: true, settings, state: publicTabState(tabStates.get(tabId)) };
    }
    if (message?.type === "retest" && Number.isInteger(tabId)) {
      const state = stateFor(tabId);
      state.lastTestedAt = 0;
      state.lastVerifiedAt = 0;
      state.selectedHost = "";
      state.failedHosts.clear();
      await clearRule(tabId);
      await benchmark(tabId, "manual");
      return { ok: true, state: publicTabState(state) };
    }
    return { ok: false };
  };
  run().then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabStates.delete(tabId);
  clearRule(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url && !/^https:\/\/(?:www|m)\.bilibili\.com\//i.test(changeInfo.url)) {
    tabStates.delete(tabId);
    clearRule(tabId);
    setBadge(tabId, "waiting");
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  if (!stored[SETTINGS_KEY]) await writeSettings(DEFAULT_SETTINGS);
});
