import {
  DEFAULT_CANDIDATES,
  DEFAULT_SETTINGS,
  isBiliVideoHost,
  isMediaUrl,
  makeRedirectRule,
  publicTabState,
  rankResults,
  replaceMediaHost,
  resultFromTiming,
  sanitizeSettings,
  uniqueHosts,
} from "./engine.js";

const SETTINGS_KEY = "biliCdnAutoSettingsV2";
const PROBE_BYTES = 128 * 1024;
const PROBE_TIMEOUT_MS = 4_500;
const tabStates = new Map();

const ruleId = (tabId) => 1_000_000 + tabId;

function newTabState() {
  return {
    phase: "waiting",
    sourceUrls: [],
    originalHost: "",
    observedHosts: new Set(),
    selectedHost: "",
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
  chrome.runtime.sendMessage({
    type: "state-updated",
    tabId,
    state: publicTabState(tabStates.get(tabId)),
  }).catch(() => {});
}

async function clearRule(tabId) {
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId(tabId)] }).catch(() => {});
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
  state.phase = phase;
  await setBadge(tabId, phase);
  await publish(tabId);
}

async function readAtMost(response, limit) {
  if (!response.body) return 0;
  const reader = response.body.getReader();
  let bytes = 0;
  try {
    while (bytes < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value?.byteLength || 0;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Math.min(bytes, limit);
}

async function probe(sourceUrl, host) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const started = performance.now();
  let ttfb = 0;
  try {
    const response = await fetch(replaceMediaHost(sourceUrl, host), {
      cache: "no-store",
      credentials: "omit",
      headers: { Range: `bytes=0-${PROBE_BYTES - 1}` },
      redirect: "follow",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    ttfb = performance.now() - started;
    const bytes = response.ok ? await readAtMost(response, PROBE_BYTES) : 0;
    return resultFromTiming({
      host, ok: response.ok, status: response.status, bytes,
      elapsedMs: performance.now() - started, ttfbMs: ttfb,
    });
  } catch (error) {
    return resultFromTiming({
      host, ok: false, elapsedMs: performance.now() - started, ttfbMs: ttfb,
      error: error?.name === "AbortError" ? "timeout" : String(error?.message || error),
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function benchmark(tabId, reason = "automatic") {
  const state = stateFor(tabId);
  if (state.testing) return state.testing;
  const sourceUrl = state.sourceUrls.find(isMediaUrl);
  if (!sourceUrl) return null;
  state.testing = (async () => {
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

    const results = await Promise.all(candidates.map((host) => probe(sourceUrl, host)));
    if (runId !== state.runId) return null;
    state.results = results;
    state.lastTestedAt = Date.now();
    state.failedHosts.clear();
    const ranked = rankResults(results, state.originalHost);
    if (!ranked.length) {
      state.phase = "error";
      state.lastError = `测速没有可用节点（${reason}）`;
      state.selectedHost = "";
      await clearRule(tabId);
      await setBadge(tabId, "error");
      await publish(tabId);
      return null;
    }
    await applyTarget(tabId, ranked[0].host, "active");
    return ranked[0];
  })().finally(() => { state.testing = null; });
  return state.testing;
}

async function honorMode(tabId, { forceRetest = false } = {}) {
  const state = stateFor(tabId);
  const settings = await readSettings();
  if (!settings.enabled || settings.mode === "original") {
    state.phase = "original";
    state.selectedHost = "";
    await clearRule(tabId);
    await setBadge(tabId, "original");
    await publish(tabId);
    return;
  }
  if (settings.mode === "manual" && isBiliVideoHost(settings.manualHost)) {
    await applyTarget(tabId, settings.manualHost, "manual");
    return;
  }
  const staleAfter = settings.refreshMinutes * 60_000;
  const expired = settings.refreshMinutes > 0 && Date.now() - state.lastTestedAt > staleAfter;
  if (forceRetest || !state.selectedHost || expired) await benchmark(tabId, forceRetest ? "manual" : "automatic");
  else await applyTarget(tabId, state.selectedHost, "active");
}

async function rememberMedia(tabId, urls) {
  const state = stateFor(tabId);
  const valid = [...new Set((urls || []).filter(isMediaUrl))].slice(0, 4);
  if (!valid.length) return;
  state.sourceUrls = valid;
  for (const value of valid) state.observedHosts.add(new URL(value).hostname.toLowerCase());
  state.originalHost ||= new URL(valid[0]).hostname.toLowerCase();
  await honorMode(tabId);
}

async function recoverFromStall(tabId) {
  const state = stateFor(tabId);
  if (!state.selectedHost || !state.results.length) return benchmark(tabId, "stall");
  state.failedHosts.add(state.selectedHost);
  const disabled = new Set((await readSettings()).disabledHosts);
  const next = rankResults(state.results, state.originalHost)
    .find((item) => !state.failedHosts.has(item.host) && !disabled.has(item.host));
  if (next) return applyTarget(tabId, next.host, "active");
  state.lastTestedAt = 0;
  state.failedHosts.clear();
  return benchmark(tabId, "stall-exhausted");
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const run = async () => {
    const senderTabId = sender.tab?.id;
    if (message?.type === "media-discovered" && Number.isInteger(senderTabId)) {
      await rememberMedia(senderTabId, message.urls);
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
