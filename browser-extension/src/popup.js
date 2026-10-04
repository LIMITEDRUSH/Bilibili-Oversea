import { diagnostics, hostLabel, popupView, speedLabel } from "./popup-model.js";

const elements = Object.fromEntries([
  "enabled", "dot", "phase", "selected", "actual", "applyState", "message", "auto", "retest", "original",
  "results", "testedAt", "refresh", "statusPanel", "powerState", "modeDescription", "resultSummary", "version", "copyDiagnostics",
].map((id) => [id, document.getElementById(id)]));

let tabId = null;
let supported = false;
let settings = { enabled: true, mode: "auto", manualHost: "", disabledHosts: [] };
let state = null;
let operationError = "";
let settingBusy = false;
let commandSequence = 0;
let resultsSignature = "";

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
  const results = Array.isArray(state?.results) ? [...state.results] : [];
  results.sort((a, b) => Number(b.ok) - Number(a.ok) || b.kbps - a.kbps);
  elements.resultSummary.textContent = results.length
    ? results.filter((item) => item.ok && !settings.disabledHosts.includes(item.host)).length + " / " + results.length + " 可用" + (results.length > 2 ? " ↓" : "")
    : "等待数据";
  const signature = JSON.stringify([results, state?.selectedHost, settings.mode, settings.manualHost,
    settings.disabledHosts, settingBusy, settings.enabled, supported]);
  if (signature === resultsSignature) return;
  resultsSignature = signature;
  const focused = document.activeElement?.dataset?.actionKey;
  elements.results.replaceChildren();
  if (!results.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = supported ? "播放视频后显示可用线路" : "打开 B 站播放页开始优化";
    elements.results.append(empty);
    return;
  }
  for (const item of results) {
    const excluded = settings.disabledHosts.includes(item.host);
    const selected = settings.enabled && item.host === state?.selectedHost;
    const row = document.createElement("div");
    row.className = "result" + (selected ? " selected" : "") + (excluded ? " excluded" : "");
    const info = document.createElement("div");
    const name = document.createElement("div");
    name.className = "host-name";
    name.title = item.host;
    const label = document.createElement("span");
    label.textContent = hostLabel(item.host);
    name.append(label);
    if (selected || excluded) {
      const tag = document.createElement("small");
      tag.textContent = excluded ? "已排除" : settings.mode === "manual" ? "已固定" : "使用中";
      name.append(tag);
    }
    const metrics = document.createElement("div");
    metrics.className = "metrics";
    metrics.textContent = item.ok
      ? speedLabel(item.kbps) + " · 首包 " + Math.round(Number(item.ttfbMs) || 0) + " ms"
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
  if (focused) {
    for (const button of elements.results.querySelectorAll("button")) {
      if (button.dataset.actionKey === focused && !button.disabled) button.focus();
    }
  }
}

function render() {
  const view = popupView(settings, state, { supported, error: operationError });
  elements.enabled.checked = settings.enabled;
  elements.enabled.disabled = settingBusy || !Number.isInteger(tabId);
  elements.statusPanel.dataset.phase = view.phase;
  elements.phase.textContent = view.title;
  elements.powerState.textContent = settings.enabled ? "本地线路优化" : "优化已暂停";
  elements.dot.className = "dot " + view.phase;
  elements.selected.textContent = view.selected ? hostLabel(view.selected) : "原始线路";
  elements.selected.title = view.selected || state?.originalHost || "";
  elements.actual.textContent = state?.actualHost ? hostLabel(state.actualHost) : "尚未观察";
  elements.actual.title = state?.actualHost || "";
  elements.applyState.textContent = view.applied;
  elements.message.textContent = view.message;
  elements.testedAt.textContent = state?.lastVerifiedAt
    ? "最近复核 " + formatTime(state.lastVerifiedAt)
    : state?.lastTestedAt ? "最近测速 " + formatTime(state.lastTestedAt) : "尚未测速";
  elements.modeDescription.textContent = settings.mode === "manual" ? "固定线路，不自动轮换"
    : settings.mode === "original" ? "使用 B 站默认线路" : "按缓冲状态智能切换";
  elements.auto.setAttribute("aria-pressed", String(settings.mode === "auto"));
  elements.original.setAttribute("aria-pressed", String(settings.mode === "original"));
  elements.auto.disabled = settingBusy || !supported;
  elements.original.disabled = settingBusy || !supported;
  elements.retest.disabled = settingBusy || view.busy || !view.canRetest;
  elements.refresh.textContent = "自适应 · 15 分钟轻量复核";
  renderResults();
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
    settings = before;
    operationError = String(error?.message || error);
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
}).catch((error) => {
  operationError = String(error?.message || error);
  render();
});
