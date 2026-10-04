import { replaceMediaHost } from "./engine.js";

export const PROBE_REFERRER_RULE_ID = 900_000;

export function probeReferrerRule(extensionId) {
  if (!/^[a-p]{32}$/.test(extensionId || "")) throw new TypeError("invalid extension id");
  return {
    id: PROBE_REFERRER_RULE_ID,
    priority: 1,
    action: { type: "modifyHeaders", requestHeaders: [{ header: "referer", operation: "set", value: "https://www.bilibili.com/" }] },
    condition: { initiatorDomains: [extensionId], requestDomains: ["bilivideo.com"], regexFilter: "^https?://[^/]+/upgcxcode/", resourceTypes: ["xmlhttprequest"] },
  };
}

// Worker fetches have no playback tab id, so tab-scoped redirect rules cannot
// route one candidate's probe through another. No cookies or signed URL edits.
export async function fetchProbe({ sourceUrl, host, byteLimit, signal, startByte = 0 }) {
  const target = replaceMediaHost(sourceUrl, host);
  const limit = Math.min(1024 * 1024, Math.max(1, Number(byteLimit) || 128 * 1024));
  const offset = Number.isSafeInteger(startByte) && startByte >= 0 && startByte <= 2 ** 40 ? startByte : 0;
  const started = performance.now();
  let ttfbMs = 0;
  try {
    const response = await fetch(target, { cache: "no-store", credentials: "omit", headers: { Range: `bytes=${offset}-${offset + limit - 1}` }, signal });
    ttfbMs = performance.now() - started;
    const responseHost = response.url ? new URL(response.url).hostname : host;
    if (responseHost !== host || !response.ok) {
      await response.body?.cancel().catch(() => {});
      return { host, responseHost, ok: false, status: response.status, bytes: 0, elapsedMs: performance.now() - started, ttfbMs, error: responseHost !== host ? "probe redirected to another CDN" : `HTTP ${response.status}` };
    }
    let bytes = 0;
    if (response.body) {
      const reader = response.body.getReader();
      try {
        while (bytes < limit) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value?.byteLength || 0;
        }
      } finally { await reader.cancel().catch(() => {}); }
    }
    return { host, responseHost, ok: bytes > 0, status: response.status, bytes: Math.min(bytes, limit), elapsedMs: performance.now() - started, ttfbMs };
  } catch (error) {
    return { host, ok: false, status: 0, bytes: 0, elapsedMs: performance.now() - started, ttfbMs, error: error?.name === "AbortError" ? "cancelled or timed out" : "probe network error" };
  }
}
