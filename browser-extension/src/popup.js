"use strict";

const elements = Object.fromEntries([
  "enabled", "dot", "phase", "selected", "actual", "applyState", "message", "auto", "retest", "original",
  "results", "testedAt", "refresh",
].map((id) => [id, document.getElementById(id)]));

let tabId = null;
let settings = { enabled: true, mode: "auto", manualHost: "", disabledHosts: [], refreshMinutes: 30 };
let state = null;

function send(message) {
  return chrome.runtime.sendMessage({ ...message, tabId });
}

function phaseText(phase) {
  return {
    waiting: "等待视频", testing: "正在测速", active: "自动模式",
    manual: "固定节点", original: "使用原始 CDN", error: "测速失败",
  }[phase] || "等待视频";
}

function formatTime(timestamp) {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(timestamp);
}

function renderResults() {
  elements.results.replaceChildren();
  const results = Array.isArray(state?.results) ? [...state.results] : [];
  results.sort((a, b) => Number(b.ok) - Number(a.ok) || b.kbps - a.kbps);
  if (!results.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "尚无结果";
    elements.results.append(empty);
    return;
  }
  for (const item of results) {
    const row = document.createElement("div");
    row.className = `result${item.host === state?.selectedHost ? " selected" : ""}`;
    const info = document.createElement("div");
    const host = document.createElement("div");
    host.className = "host";
    host.textContent = item.host;
    const metrics = document.createElement("div");
    metrics.className = "metrics";
    const stage = item.stage === "sustained" ? "复测" : "初筛";
    metrics.textContent = item.ok ? `${item.kbps} kbps · 首包 ${item.ttfbMs} ms · ${stage}` : `不可用 · ${item.error || item.status}`;
    info.append(host, metrics);
    const actions = document.createElement("div");
    actions.className = "actions";
    if (item.ok) {
      const use = document.createElement("button");
      use.type = "button";
      const isFixed = settings.mode === "manual" && settings.manualHost === item.host;
      use.textContent = isFixed ? "已固定" : "固定";
      use.disabled = isFixed;
      use.addEventListener("click", () => updateSettings({ mode: "manual", manualHost: item.host }, false, true));
      actions.append(use);
    }
    const disable = document.createElement("button");
    disable.type = "button";
    disable.className = "disable";
    disable.textContent = settings.disabledHosts.includes(item.host) ? "启用" : "禁用";
    disable.addEventListener("click", () => toggleHost(item.host));
    actions.append(disable);
    row.append(info, actions);
    elements.results.append(row);
  }
}

function render() {
  const phase = state?.phase || "waiting";
  elements.enabled.checked = settings.enabled;
  elements.refresh.value = String(settings.refreshMinutes);
  elements.phase.textContent = phaseText(phase);
  elements.dot.className = `dot ${phase}`;
  elements.selected.textContent = state?.selectedHost || "尚未选择 CDN";
  elements.actual.textContent = `最近媒体请求：${state?.actualHost || "尚未观察"}`;
  elements.applyState.textContent = !state?.selectedHost
    ? "等待规则"
    : state.actualHost === state.selectedHost
      ? "已观察到目标请求"
      : state.ruleInstalled
        ? "规则已安装"
        : state.selectedHost === state.originalHost
          ? "当前已是目标节点"
          : "等待后续请求";
  elements.message.textContent = state?.lastError || (
    phase === "waiting" ? "打开 B 站视频并播放几秒。" : "规则只作用于当前 B 站播放标签页。"
  );
  elements.testedAt.textContent = state?.lastTestedAt ? `测试于 ${formatTime(state.lastTestedAt)}` : "";
  const busy = phase === "testing";
  elements.auto.disabled = busy;
  elements.retest.disabled = busy;
  elements.original.disabled = busy;
  renderResults();
}

async function loadState(retry = true) {
  const response = await send({ type: "get-state" });
  settings = response?.settings || settings;
  state = response?.state || null;
  render();
  if (!state && retry) setTimeout(() => loadState(false).catch(() => {}), 500);
}

async function updateSettings(patch, forceRetest = false, applyNow = false) {
  settings = { ...settings, ...patch };
  render();
  const response = await send({ type: "set-settings", settings, forceRetest, applyNow });
  settings = response?.settings || settings;
  state = response?.state || state;
  render();
}

async function toggleHost(host) {
  const disabled = new Set(settings.disabledHosts);
  const disabling = !disabled.has(host);
  if (disabling) disabled.add(host);
  else disabled.delete(host);
  const patch = { disabledHosts: [...disabled] };
  if (disabling && settings.mode === "manual" && settings.manualHost === host) {
    patch.mode = "auto";
    patch.manualHost = "";
  }
  await updateSettings(patch, disabling && host === state?.selectedHost);
}

elements.enabled.addEventListener("change", () => updateSettings({ enabled: elements.enabled.checked }));
elements.auto.addEventListener("click", () => updateSettings({ enabled: true, mode: "auto", manualHost: "" }, true));
elements.original.addEventListener("click", () => updateSettings({ mode: "original", manualHost: "" }, false, true));
elements.retest.addEventListener("click", async () => {
  state = { ...state, phase: "testing" };
  render();
  const response = await send({ type: "retest" });
  state = response?.state || state;
  render();
});
elements.refresh.addEventListener("change", () => updateSettings({ refreshMinutes: Number(elements.refresh.value) }));

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "state-updated" && message.tabId === tabId) {
    state = message.state;
    render();
  }
});

chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  tabId = tab?.id;
  if (!Number.isInteger(tabId) || !/^https:\/\/(?:www|m)\.bilibili\.com\//i.test(tab?.url || "")) {
    elements.message.textContent = "请先打开 B 站视频页面。";
    document.querySelectorAll("button,select,input").forEach((control) => { control.disabled = true; });
    return;
  }
  loadState().catch((error) => {
    elements.phase.textContent = "无法读取状态";
    elements.message.textContent = String(error?.message || error);
  });
});
