export const DEFAULT_CANDIDATES = Object.freeze([
  "upos-sz-mirroraliov.bilivideo.com",
  "upos-sz-mirrorcosov.bilivideo.com",
  "upos-sz-mirrorhwov.bilivideo.com",
]);

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  mode: "auto",
  manualHost: "",
  disabledHosts: [],
  refreshMinutes: 30,
});

export function isBiliVideoHost(value) {
  const host = String(value || "").trim().toLowerCase().replace(/\.$/, "");
  if (!host.endsWith(".bilivideo.com") || host.length > 253) return false;
  return host.split(".").every((label) => (
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)
  ));
}

export function isBiliMediaHost(value) {
  const host = String(value || "").trim().toLowerCase().replace(/\.$/, "");
  return isBiliVideoHost(host)
    || (host.endsWith(".mcdn.bilivideo.cn") && host.split(".").every((label) => (
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)
    )));
}

export function isMediaUrl(value) {
  try {
    const url = new URL(String(value));
    return ["http:", "https:"].includes(url.protocol)
      && isBiliMediaHost(url.hostname)
      && url.pathname.includes("/upgcxcode/");
  } catch {
    return false;
  }
}

export function replaceMediaHost(value, targetHost) {
  if (!isMediaUrl(value) || !isBiliVideoHost(targetHost)) {
    throw new TypeError("invalid Bilibili media URL or CDN host");
  }
  const url = new URL(value);
  url.hostname = targetHost.toLowerCase();
  return url.toString();
}

export function uniqueHosts(values, limit = 12) {
  const output = [];
  const seen = new Set();
  for (const value of values || []) {
    const host = String(value || "").trim().toLowerCase();
    if (!isBiliVideoHost(host) || seen.has(host)) continue;
    seen.add(host);
    output.push(host);
    if (output.length >= limit) break;
  }
  return output;
}

export function uniqueMediaHosts(values, limit = 12) {
  const output = [];
  const seen = new Set();
  for (const value of values || []) {
    const host = String(value || "").trim().toLowerCase();
    if (!isBiliMediaHost(host) || seen.has(host)) continue;
    seen.add(host);
    output.push(host);
    if (output.length >= limit) break;
  }
  return output;
}

export function sanitizeSettings(input = {}) {
  const mode = ["auto", "manual", "original"].includes(input.mode)
    ? input.mode
    : DEFAULT_SETTINGS.mode;
  const manualHost = isBiliVideoHost(input.manualHost) ? input.manualHost.toLowerCase() : "";
  const refresh = Number(input.refreshMinutes);
  return {
    enabled: input.enabled !== false,
    mode,
    manualHost,
    disabledHosts: uniqueHosts(input.disabledHosts, 24),
    refreshMinutes: [0, 15, 30, 60].includes(refresh) ? refresh : 30,
  };
}

export function resultFromTiming({
  host, ok, status = 0, bytes = 0, elapsedMs = 0, ttfbMs = 0, error = "", stage = "quick",
}) {
  const safeMs = Math.max(1, Number(elapsedMs) || 0);
  const safeBytes = Math.max(0, Number(bytes) || 0);
  return {
    host: String(host || "").toLowerCase(),
    ok: Boolean(ok) && safeBytes > 0,
    status: Number(status) || 0,
    bytes: safeBytes,
    elapsedMs: Math.round(safeMs),
    ttfbMs: Math.round(Math.max(0, Number(ttfbMs) || 0)),
    kbps: Math.round((safeBytes * 8) / safeMs),
    error: String(error || "").slice(0, 120),
    stage: stage === "sustained" ? "sustained" : "quick",
  };
}

export function rankResults(results, currentHost = "") {
  const current = String(currentHost || "").toLowerCase();
  return [...(results || [])]
    .filter((item) => item && item.ok && isBiliVideoHost(item.host))
    .sort((a, b) => {
      if (b.kbps !== a.kbps) return b.kbps - a.kbps;
      if (a.ttfbMs !== b.ttfbMs) return a.ttfbMs - b.ttfbMs;
      if (a.host === current) return -1;
      if (b.host === current) return 1;
      return a.host.localeCompare(b.host);
    });
}

export function makeRedirectRule({ id, tabId, sourceHosts, targetHost }) {
  if (!Number.isInteger(id) || id < 1 || !Number.isInteger(tabId) || tabId < 0) {
    throw new TypeError("invalid rule or tab id");
  }
  if (!isBiliVideoHost(targetHost)) throw new TypeError("invalid target host");
  const requestDomains = uniqueMediaHosts(sourceHosts).filter((host) => host !== targetHost);
  if (!requestDomains.length) return null;
  return {
    id,
    priority: 1,
    action: {
      type: "redirect",
      redirect: { transform: { host: targetHost } },
    },
    condition: {
      tabIds: [tabId],
      initiatorDomains: ["bilibili.com"],
      requestDomains,
      resourceTypes: ["media", "xmlhttprequest", "other"],
    },
  };
}

export function publicTabState(state) {
  if (!state) return null;
  return {
    phase: state.phase || "idle",
    selectedHost: state.selectedHost || "",
    originalHost: state.originalHost || "",
    actualHost: state.actualHost || "",
    ruleInstalled: state.ruleInstalled === true,
    discoverySource: state.discoverySource || "",
    lastDetectedAt: Number(state.lastDetectedAt) || 0,
    results: Array.isArray(state.results) ? state.results.slice(0, 12) : [],
    lastTestedAt: Number(state.lastTestedAt) || 0,
    lastError: String(state.lastError || ""),
  };
}
