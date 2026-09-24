(() => {
  "use strict";

  const SOURCE = "bili-cdn-auto-page-v2";
  const STALL_COOLDOWN_MS = 8_000;
  const MAX_PROBE_BYTES = 512 * 1024;
  const MAX_PROBE_TIMEOUT_MS = 15_000;
  let activeVideo = null;
  let lastStallAt = 0;
  let healthTimer = 0;
  const bufferHistory = [];

  function send(message) {
    try {
      const pending = chrome.runtime.sendMessage(message);
      if (pending?.catch) pending.catch(() => {});
    } catch {}
  }

  function connectionHint() {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    return {
      online: navigator.onLine,
      effectiveType: String(connection?.effectiveType || "unknown"),
      downlink: Number(connection?.downlink) || 0,
      rtt: Number(connection?.rtt) || 0,
    };
  }

  function isMediaHost(host) {
    const value = String(host || "").toLowerCase();
    return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+bilivideo\.com$/.test(value)
      || /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+mcdn\.bilivideo\.cn$/.test(value);
  }

  function probeUrl(sourceUrl, host) {
    const target = new URL(String(sourceUrl));
    if (!isMediaHost(target.hostname) || !target.pathname.includes("/upgcxcode/") || !isMediaHost(host)) {
      throw new Error("invalid media probe target");
    }
    target.hostname = String(host).toLowerCase();
    return target.href;
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

  async function probe(sourceUrl, host, byteLimit, timeoutMs) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    const started = performance.now();
    let ttfbMs = 0;
    try {
      const response = await fetch(probeUrl(sourceUrl, host), {
        cache: "no-store",
        credentials: "omit",
        headers: { Range: `bytes=0-${byteLimit - 1}` },
        redirect: "follow",
        signal: controller.signal,
      });
      ttfbMs = performance.now() - started;
      const bytes = response.ok ? await readAtMost(response, byteLimit) : 0;
      return {
        host, ok: response.ok, status: response.status, bytes,
        elapsedMs: performance.now() - started, ttfbMs,
      };
    } catch (error) {
      return {
        host, ok: false, status: 0, bytes: 0,
        elapsedMs: performance.now() - started, ttfbMs,
        error: error?.name === "AbortError" ? "timeout" : String(error?.message || error),
      };
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function probeCandidates(message) {
    const sourceUrl = String(message?.sourceUrl || "");
    const hosts = [...new Set((Array.isArray(message?.hosts) ? message.hosts : [])
      .map((host) => String(host).toLowerCase()).filter(isMediaHost))].slice(0, 8);
    const byteLimit = Math.min(MAX_PROBE_BYTES, Math.max(1, Number(message?.byteLimit) || 128 * 1024));
    const timeoutMs = Math.min(MAX_PROBE_TIMEOUT_MS, Math.max(1_000, Number(message?.timeoutMs) || 4_500));
    if (!hosts.length) return { ok: false, error: "no valid probe hosts", results: [] };
    const results = await Promise.all(hosts.map((host) => probe(sourceUrl, host, byteLimit, timeoutMs)));
    return { ok: true, results };
  }

  function reportStall(reason) {
    const now = Date.now();
    if (now - lastStallAt < STALL_COOLDOWN_MS) return;
    lastStallAt = now;
    send({ type: "playback-stall", reason, connection: connectionHint() });
  }

  function bufferedAhead(video) {
    const time = video.currentTime;
    for (let index = 0; index < video.buffered.length; index += 1) {
      if (video.buffered.start(index) <= time && video.buffered.end(index) >= time) {
        return Math.max(0, video.buffered.end(index) - time);
      }
    }
    return 0;
  }

  function sampleHealth() {
    if (!activeVideo || activeVideo.paused || activeVideo.ended || document.hidden) {
      bufferHistory.length = 0;
      return;
    }
    const ahead = bufferedAhead(activeVideo);
    bufferHistory.push(ahead);
    if (bufferHistory.length > 4) bufferHistory.shift();
    if (
      bufferHistory.length === 4
      && ahead > 0
      && ahead < 3
      && bufferHistory.every((value, index, values) => index === 0 || value < values[index - 1])
    ) {
      reportStall("buffer-low");
      bufferHistory.length = 0;
    }
  }

  function watchVideo(video) {
    if (video === activeVideo) return;
    activeVideo = video;
    bufferHistory.length = 0;
    video.addEventListener("waiting", () => reportStall("waiting"));
    video.addEventListener("stalled", () => reportStall("stalled"));
    if (!healthTimer) healthTimer = window.setInterval(sampleHealth, 2_000);
  }

  function locateVideo() {
    const video = document.querySelector("video");
    if (video) watchVideo(video);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.source !== SOURCE || event.data?.type !== "media-urls") return;
    const urls = Array.isArray(event.data.urls) ? event.data.urls.slice(0, 8) : [];
    send({ type: "media-discovered", urls, connection: connectionHint() });
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "rescan") {
      window.postMessage({ source: SOURCE, type: "rescan" }, location.origin);
      return false;
    }
    if (message?.type === "probe-candidates") {
      probeCandidates(message).then(sendResponse).catch((error) => {
        sendResponse({ ok: false, error: String(error?.message || error), results: [] });
      });
      return true;
    }
    return false;
  });

  const observer = new MutationObserver(locateVideo);
  function startObserver() {
    if (document.documentElement) observer.observe(document.documentElement, { childList: true, subtree: true });
    else document.addEventListener("readystatechange", startObserver, { once: true });
  }
  startObserver();
  document.addEventListener("DOMContentLoaded", locateVideo, { once: true });
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  connection?.addEventListener?.("change", () => send({ type: "network-changed", connection: connectionHint() }));
  window.addEventListener("online", () => send({ type: "network-changed", connection: connectionHint() }));
})();
