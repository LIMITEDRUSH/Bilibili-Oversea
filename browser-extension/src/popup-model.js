import { isBiliMediaHost } from "./engine.js";

const hostNames = [
  ["mirrorali", "阿里云"], ["mirrorcos", "腾讯云"], ["mirrorhw", "华为云"],
  ["mirrorakam", "Akamai"], ["mcdn", "B 站边缘"],
];

export function hostLabel(host) {
  if (!host) return "等待选择";
  for (const [part, name] of hostNames) {
    if (host.includes(part)) return name + (host.includes("ov.") ? " · 海外" : "");
  }
  return host;
}

export function speedLabel(kbps) {
  const value = Math.max(0, Number(kbps) || 0) / 1000;
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value) + " Mbps";
}

export function popupRows(settings, state) {
  const rows = new Map((state?.results || []).map(item => [item.host, { ...item }]));
  for (const host of settings.disabledHosts || []) {
    if (!rows.has(host)) rows.set(host, { host, ok: false, untested: true, kbps: 0 });
  }
  const disabled = new Set(settings.disabledHosts || []);
  return [...rows.values()].sort((a, b) => Number(disabled.has(a.host)) - Number(disabled.has(b.host))
    || Number(b.ok) - Number(a.ok) || (Number(b.kbps) || 0) - (Number(a.kbps) || 0));
}

export function diagnostics(settings, state, version) {
  const host = (value) => isBiliMediaHost(value) ? value : "";
  return {
    version, enabled: settings.enabled, mode: settings.mode, phase: state?.phase || "waiting",
    selectedHost: host(state?.selectedHost), actualHost: host(state?.actualHost),
    sourceKind: ["video", "audio"].includes(state?.sourceKind) ? state.sourceKind : "unknown",
    ruleInstalled: state?.ruleInstalled === true,
    results: (state?.results || []).map((item) => ({
      host: host(item.host), ok: item.ok === true, kbps: Number(item.kbps) || 0,
      ttfbMs: Number(item.ttfbMs) || 0, status: Number(item.status) || 0,
    })),
  };
}

export function popupView(settings, state, { supported = true, error = "" } = {}) {
  const ruleError = state?.phase === "error" && state?.ruleInstalled === true;
  const baselinePassthrough = settings.enabled && settings.mode !== "original"
    && state?.passthroughReason === "baseline-akamai";
  const phase = ruleError ? "error" : !settings.enabled ? "paused" : state?.phase || "waiting";
  const title = {
    paused: "已暂停优化", waiting: "等待视频", testing: "正在寻找快线路",
    verifying: "正在复核线路", active: "自动优化中", manual: "已固定线路",
    original: "使用原始 CDN", error: "已回退原始线路",
  }[phase] || "等待视频";
  const message = {
    paused: "视频继续使用原始线路，打开开关可恢复优化。",
    waiting: "开始播放视频后，自动识别并选择线路。",
    testing: "播放继续进行。缓冲充足后再做完整复测。",
    verifying: "只比较当前与备用节点，避免频繁测速。",
    active: "监测缓冲变化，线路失效时自动切换备用节点。",
    manual: "当前线路由你指定，选择自动可恢复智能切换。",
    original: "使用 B 站提供的线路，暂不测速或切换。",
    error: "候选线路暂不可用，继续播放并稍后重试。",
  }[phase] || "";
  const selected = settings.enabled ? state?.selectedHost || "" : "";
  let applied = "等待媒体请求";
  if (ruleError) applied = "规则仍可能生效";
  else if (!settings.enabled || settings.mode === "original" || baselinePassthrough) applied = "原始请求直通";
  else if (selected) {
    applied = state.actualHost === selected ? "目标请求已确认"
      : state.ruleInstalled ? "规则已就绪"
        : selected === state.originalHost ? "原线路即最优" : "等待后续请求";
  }
  return {
    phase: error ? "error" : phase,
    title: error ? "操作未完成" : !supported ? "打开 B 站播放页" : ruleError ? "规则更新未完成" : title,
    message: error || (!supported
      ? "在视频、番剧或课程播放页使用线路优化。"
      : state?.lastError || (baselinePassthrough ? "此视频使用 Akamai，保持 2.2.0 原始直通，不跨 CDN 改道。" : message)),
    applied,
    selected,
    busy: phase === "testing" || phase === "verifying",
    canRetest: supported && settings.enabled && !baselinePassthrough && Boolean(state?.lastDetectedAt),
  };
}
