import { diagnostics, hostLabel, popupRows, popupView, speedLabel } from "./popup-model.js";
import { playbackView } from "./playback-view.js";

const elements = Object.fromEntries([
  "enabled", "dot", "phase", "selected", "actual", "applyState", "message", "auto", "retest", "original",
  "results", "testedAt", "statusPanel", "resultSummary", "version", "copyDiagnostics",
  "playbackStatus", "videoTitle", "resolution", "buffer", "progress", "routeMode", "pendingRoute", "routingActivity",
].map((id) => [id, document.getElementById(id)]));

let tabId = null;
let supported = false;
let settings = { enabled: true, mode: "auto", manualHost: "", disabledHosts: [] };
let state = null;
let operationError = "";
let settingBusy = false;
let commandSequence = 0;
let resultsSignature = "";
let playback = null;
let readingPlayback = false;

async function send(message) {
  const response = await chrome.runtime.sendMessage({ ...message, tabId });
  if (!response || response.ok === false) {
    throw new Error(response?.error || "后台未响应，请在扩展管理页重新加载插件。");
  }
  return response;
}

function formatTime(timestamp) {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(timestamp);
}

function renderResults() {
  const candidateHosts = playback && Date.now() - playback.sampledAt < 5000 ? playback.candidateHosts || [] : [];
  const results = popupRows(settings, state, { candidateHosts });
  const measured = results.filter(item => !item.untested).length;
  elements.resultSummary.textContent = results.length
    ? (measured ? results.filter((item) => item.ok && !settings.disabledHosts.includes(item.host)).length + " 可用" : "0 已测") + " / 共 " + results.length + " 个"
    : "0 个";
  const signature = JSON.stringify([results, state?.selectedHost, state?.passthroughReason, state?.actualHost, state?.phase, settings.mode, settings.manualHost,
    settings.disabledHosts, settingBusy, settings.enabled, supported]);
  if (signature === resultsSignature) return;
  resultsSignature = signature;
  const focused = document.activeElement?.dataset?.actionKey;
  const scrollTop = elements.results.scrollTop;
  elements.results.replaceChildren();
  if (!results.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = state?.passthroughReason === "baseline-akamai" ? "原始直通 · 不参与测速" : "尚未测速";
    elements.results.append(empty);
    return;
  }
  for (const item of results) {
    const excluded = settings.disabledHosts.includes(item.host);
    const selected = settings.enabled && item.host === state?.selectedHost;
    const current = item.host === state?.actualHost;
    const row = document.createElement("div");
    row.className = "result" + (selected ? " selected" : "") + (excluded ? " excluded" : "");
    const info = document.createElement("div");
    const name = document.createElement("div");
    name.className = "host-name";
    name.title = item.host;
    const label = document.createElement("span");
    label.textContent = hostLabel(item.host);
    name.append(label);
    if (selected || excluded || current || item.untested) {
      const tag = document.createElement("small");
      tag.textContent = excluded ? "已排除" : current ? "当前" : selected
        ? settings.mode === "manual" ? "已固定" : "已选" : item.observed ? "已发现" : item.preset ? "预置" : "未测";
      name.append(tag);
    }
    const metrics = document.createElement("div");
    metrics.className = "metrics";
    const previous = ["testing", "verifying"].includes(state?.phase) && Number(item.sampledAt) > 0;
    metrics.textContent = item.untested
      ? state?.passthroughReason === "baseline-akamai" ? "未参与测速" : "未测速"
      : item.ok
      ? (previous ? "上次 · " : "") + speedLabel(item.kbps) + " · " + Math.round(Number(item.ttfbMs) || 0) + " ms"
      : "不可用 · " + (item.status ? "HTTP " + item.status : "请求失败");
    metrics.title = item.ok ? (item.stage === "verify" ? "轻量复核" : item.stage === "sustained" ? "完整复测" : "初筛")
      : String(item.error || item.status || "请检查网络后重测");
    info.append(name, metrics);
    const actions = document.createElement("div");
    actions.className = "actions";
    if (item.ok && !excluded) {
      const use = document.createElement("button");
      use.type = "button";
      use.dataset.actionKey = "use:" + item.host;
      const fixed = settings.mode === "manual" && settings.manualHost === item.host;
      use.textContent = fixed ? "已固定" : "固定";
      use.setAttribute("aria-label", "固定 " + hostLabel(item.host));
      use.disabled = fixed || settingBusy || !settings.enabled || !supported;
      use.addEventListener("click", () => updateSettings({ enabled: true, mode: "manual", manualHost: item.host }, true));
      actions.append(use);
    }
    const exclude = document.createElement("button");
    exclude.type = "button";
    exclude.className = "exclude";
    exclude.dataset.actionKey = "exclude:" + item.host;
    exclude.textContent = excluded ? "恢复" : "排除";
    exclude.setAttribute("aria-label", (excluded ? "恢复 " : "排除 ") + hostLabel(item.host));
    exclude.disabled = settingBusy || !supported;
    exclude.addEventListener("click", () => toggleHost(item.host));
    actions.append(exclude);
    row.append(info, actions);
    elements.results.append(row);
  }
  elements.results.scrollTop = scrollTop;
  if (focused) {
    for (const button of elements.results.querySelectorAll("button")) {
      if (button.dataset.actionKey === focused && !button.disabled) button.focus({ preventScroll: true });
    }
  }
}

function render() {
  const view = popupView(settings, state, { supported, error: operationError });
  elements.enabled.checked = settings.enabled;
  elements.enabled.disabled = settingBusy || !Number.isInteger(tabId);
  elements.statusPanel.dataset.phase = view.phase;
  elements.phase.textContent = view.phase === "verifying" ? "正在复核线路" : "正在测速";
  elements.routingActivity.hidden = !view.busy;
  renderPlayback();
  elements.selected.textContent = view.selected ? hostLabel(view.selected) : "原始线路";
  elements.selected.title = view.selected || state?.originalHost || "";
  elements.actual.textContent = state?.actualHost ? hostLabel(state.actualHost) : "尚未观察";
  elements.actual.title = state?.actualHost || "";
  elements.applyState.textContent = ({ "原始请求直通": "直通", "目标请求已确认": "已确认", "规则已就绪": "待请求",
    "原线路即最优": "原始最优", "等待后续请求": "待请求", "等待媒体请求": "", "规则仍可能生效": "规则异常" })[view.applied] || view.applied;
  elements.applyState.title = view.applied;
  elements.pendingRoute.hidden = !view.selected || view.selected === state?.actualHost;
  elements.message.hidden = !operationError && view.phase !== "error";
  elements.message.textContent = elements.message.hidden ? "" : String(view.message).slice(0, 400);
  elements.testedAt.textContent = state?.lastVerifiedAt
    ? "最近复核 " + formatTime(state.lastVerifiedAt)
    : state?.lastTestedAt ? "最近测速 " + formatTime(state.lastTestedAt) : "尚未测速";
  const nativePassthrough = settings.enabled && settings.mode !== "original" && state?.passthroughReason === "baseline-akamai";
  elements.routeMode.textContent = view.applied === "规则仍可能生效" ? "规则异常"
    : !settings.enabled ? "优化关闭" : nativePassthrough ? "原始直通"
    : settings.mode === "manual" ? "固定线路" : settings.mode === "original" ? "原始线路" : "自动选路";
  elements.auto.setAttribute("aria-pressed", String(settings.mode === "auto"));
  elements.original.setAttribute("aria-pressed", String(settings.mode === "original"));
  elements.auto.disabled = settingBusy || !supported;
  elements.original.disabled = settingBusy || !supported;
  elements.retest.disabled = settingBusy || view.busy || !view.canRetest;
  renderResults();
}

function renderPlayback() {
  const view = playbackView(playback, { supported });
  elements.statusPanel.dataset.playback = view.phase;
  const setText = (element, value) => { if (element.textContent !== value) element.textContent = value; };
  // Do not re-announce an unchanged live-region status on every clock tick.
  setText(elements.playbackStatus, view.title);
  setText(elements.videoTitle, view.videoTitle);
  elements.videoTitle.title = view.videoTitle;
  setText(elements.resolution, view.resolution);
  setText(elements.buffer, view.buffer);
  setText(elements.progress, view.progress);
}

async function readPlayback() {
  renderPlayback(); // Expire stale snapshots even while a request is pending.
  if (readingPlayback || !supported || !Number.isInteger(tabId) || document.hidden) return;
  readingPlayback = true;
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "get-playback-info" });
    playback = response?.ok === true ? response.playback || null : null;
  } catch { playback = null; }
  finally { readingPlayback = false; renderPlayback(); renderResults(); }
}

async function loadState() {
  const response = await send({ type: "get-state" });
  settings = response.settings || settings;
  state = response.state || null;
  render();
}

async function updateSettings(patch, applyNow = false) {
  if (settingBusy) return;
  const sequence = ++commandSequence;
  const before = settings;
  settings = { ...settings, ...patch };
  settingBusy = true;
  operationError = "";
  render();
  try {
    const response = await send({ type: "set-settings", settings, applyNow });
    if (sequence !== commandSequence) return;
    settings = response.settings || settings;
    state = response.state || state;
  } catch (error) {
    if (sequence !== commandSequence) return;
    operationError = String(error?.message || error);
    // A setting may have been saved before a browser rule update failed.
    // Read the actual saved state rather than showing a false rollback.
    try { await loadState(); } catch { settings = before; }
  } finally {
    if (sequence === commandSequence) settingBusy = false;
    render();
  }
}

function toggleHost(host) {
  const disabled = new Set(settings.disabledHosts);
  const excluding = !disabled.has(host);
  if (excluding) disabled.add(host);
  else disabled.delete(host);
  const patch = { disabledHosts: [...disabled] };
  if (excluding && settings.mode === "manual" && settings.manualHost === host) {
    patch.mode = "auto";
    patch.manualHost = "";
  }
  return updateSettings(patch);
}

async function retest() {
  if (elements.retest.disabled) return;
  const sequence = ++commandSequence;
  const before = state;
  operationError = "";
  state = { ...state, phase: "testing" };
  render();
  try {
    const response = await send({ type: "retest" });
    if (sequence === commandSequence) {
      settings = response.settings || settings;
      state = response.state || state;
    }
  } catch (error) {
    if (sequence === commandSequence) {
      state = before;
      operationError = String(error?.message || error);
    }
  }
  render();
}

elements.enabled.addEventListener("change", () => updateSettings({ enabled: elements.enabled.checked }));
elements.auto.addEventListener("click", () => updateSettings({ enabled: true, mode: "auto", manualHost: "" }));
elements.original.addEventListener("click", () => updateSettings({ mode: "original", manualHost: "" }, true));
elements.retest.addEventListener("click", retest);
elements.copyDiagnostics.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(JSON.stringify(
      diagnostics(settings, state, chrome.runtime.getManifest().version), null, 2,
    ));
    elements.copyDiagnostics.textContent = "已复制";
  } catch {
    elements.copyDiagnostics.textContent = "复制失败";
  }
  setTimeout(() => { elements.copyDiagnostics.textContent = "复制诊断"; }, 2000);
});
document.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() !== "r" || event.ctrlKey || event.metaKey || event.altKey || event.repeat
    || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
  if (!elements.retest.disabled) { event.preventDefault(); retest(); }
});
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "state-updated" && message.tabId === tabId) {
    if (!settingBusy && message.settings) settings = message.settings;
    state = message.state;
    render();
  }
});

elements.version.textContent = "v" + chrome.runtime.getManifest().version;
render();
chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
  tabId = tab?.id;
  supported = Number.isInteger(tabId) && /^https:\/\/(?:www|m)\.bilibili\.com\/(?:video\/|bangumi\/play\/|cheese\/play\/)/i.test(tab?.url || "");
  // Settings (including the power switch) are accessible outside a playback page.
  if (Number.isInteger(tabId)) await loadState();
  else render();
  await readPlayback();
}).catch((error) => {
  operationError = String(error?.message || error);
  render();
});
// This timer belongs to the action popup and dies when its document closes.
const playbackTimer = window.setInterval(readPlayback, 1000);
window.addEventListener("pagehide", () => window.clearInterval(playbackTimer), { once: true });
