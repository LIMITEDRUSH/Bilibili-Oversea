import {
  DEFAULT_CANDIDATES,
  DEFAULT_SETTINGS,
  isBiliVideoHost,
  isMediaUrl,
  makeRedirectRule,
  publicTabState,
  rankResults,
  resultFromTiming,
  sanitizeSettings,
  uniqueHosts,
} from "./engine.js";

const SETTINGS_KEY = "biliCdnAutoSettingsV2";
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
    results: [],
    lastTestedAt: 0,
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

async function setBadge(tabId, phase) {
  const badges = {
    testing: ["…", "#f59e0b"], active: ["A", "#00a1d6"], manual: ["M", "#fb7299"],
    original: ["—", "#64748b"], error: ["!", "#dc2626"], waiting: ["", "#64748b"],
  };
  const [text, color] = badges[phase] || badges.waiting;
  await Promise.all([
    chrome.action.setBadgeText({ tabId, text }).catch(() => {}),
    chrome.action.setBadgeBackgroundColor({ tabId, color }).catch(() => {}),
  ]);
}

async function publish(tabId) {
  const state = publicTabState(tabStates.get(tabId));
  chrome.runtime.sendMessage({
    type: "state-updated",
    tabId,
    state,
  }).catch(() => {});
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
      state.lastTestedAt = Date.now();
      state.phase = "error";
      state.lastError = `测速没有可用节点（${reason}）`;
      state.selectedHost = "";
      await clearRule(tabId);
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
    const sustainedByHost = new Map(sustainedResults.map((item) => [item.host, item]));
    state.results = quickResults.map((item) => sustainedByHost.get(item.host) || item);
    state.lastTestedAt = Date.now();
    state.failedHosts.clear();
    const finalRanked = rankResults(sustainedResults, state.originalHost);
    const winner = finalRanked[0] || quickRanked[0];
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
  const staleAfter = settings.refreshMinutes * 60_000;
  const expired = settings.refreshMinutes > 0 && Date.now() - state.lastTestedAt > staleAfter;
  if (forceRetest || !state.selectedHost || expired) await benchmark(tabId, forceRetest ? "manual" : "automatic");
  else if (state.phase !== "active") await applyTarget(tabId, state.selectedHost, "active");
}

async function rememberMedia(tabId, urls, { source = "page", observed = false } = {}) {
  const state = stateFor(tabId);
  const valid = [...new Set((urls || []).filter(isMediaUrl))].slice(0, 4);
  if (!valid.length) return;
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
  state.observedHosts.clear();
  state.failedHosts.clear();
  state.discoverySource = "";
  state.lastDetectedAt = 0;
  state.pageUrl = String(pageUrl || "");
  await publish(tabId);
}

async function recoverFromStall(tabId) {
  const state = stateFor(tabId);
  if (!state.selectedHost || !state.results.length) return benchmark(tabId, "stall");
  state.failedHosts.add(state.selectedHost);
  const disabled = new Set((await readSettings()).disabledHosts);
  const next = rankResults(state.results, state.originalHost)
    .find((item) => !state.failedHosts.has(item.host) && !disabled.has(item.host));
  if (next) {
    await applyTarget(tabId, next.host, "active");
    chrome.tabs.sendMessage(tabId, { type: "retry-playback", reason: "stall-recovery" }).catch(() => {});
    return next;
  }
  state.lastTestedAt = 0;
  state.failedHosts.clear();
  return benchmark(tabId, "stall-exhausted");
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const run = async () => {
    const senderTabId = sender.tab?.id;
    if (message?.type === "media-discovered" && Number.isInteger(senderTabId)) {
      await rememberMedia(senderTabId, message.urls, {
        source: message.source,
        observed: message.observed === true,
      });
      return { ok: true };
    }
    if (message?.type === "media-heartbeat" && Number.isInteger(senderTabId)) {
      const state = stateFor(senderTabId);
      if (state.sourceUrls.length) await honorMode(senderTabId);
      return { ok: true };
    }
    if (message?.type === "page-changed" && Number.isInteger(senderTabId)) {
      await resetForNavigation(senderTabId, message.url);
      return { ok: true };
    }
    if (message?.type === "playback-stall" && Number.isInteger(senderTabId)) {
      await recoverFromStall(senderTabId);
      return { ok: true };
    }
    if (message?.type === "network-changed" && Number.isInteger(senderTabId)) {
      const state = stateFor(senderTabId);
      state.lastTestedAt = 0;
      state.selectedHost = "";
      state.failedHosts.clear();
      await clearRule(senderTabId);
      await honorMode(senderTabId, { forceRetest: Boolean(state.sourceUrls.length) });
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
      state.selectedHost = "";
      state.failedHosts.clear();
      await clearRule(tabId);
      await honorMode(tabId, { forceRetest: true });
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
