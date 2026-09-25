(() => {
  "use strict";

  const SOURCE = "bili-cdn-auto-page-v2";
  const DISCOVERY_INTERVAL_MS = 10_000;
  const HEALTH_SAMPLE_INTERVAL_MS = 2_000;
  const STALL_CONFIRM_MS = 2_500;
  const STALL_COOLDOWN_MS = 8_000;
  const STARTUP_GRACE_MS = 20_000;
  const SEEK_GRACE_MS = 4_000;
  const HEALTHY_BUFFER_SECONDS = 8;
  const LOW_BUFFER_SECONDS = 3;
  const MAX_PROBE_BYTES = 1024 * 1024;
  const MAX_PROBE_TIMEOUT_MS = 15_000;
  const discoveredUrls = new Set();
  const observedResourceUrls = new Set();
  const seenResourceEntries = new Set();
  const probeSuppressions = new Map();
  const bufferHistory = [];
  let activeVideo = null;
  let videoStartedAt = 0;
  let healthArmed = false;
  let lastSeekAt = 0;
  let lastStallAt = 0;
  let stallTimer = 0;
  let healthTimer = 0;
  let lastUrl = location.href;

  function writeDiagnostics(state = null) {
    const root = document.documentElement;
    if (!root?.dataset) return;
    root.dataset.biliCdnAutoVersion = chrome.runtime.getManifest?.()?.version || "";
    root.dataset.biliCdnAutoPhase = state?.phase || root.dataset.biliCdnAutoPhase || "waiting";
    root.dataset.biliCdnAutoSelectedHost = state?.selectedHost || "";
    root.dataset.biliCdnAutoActualHost = state?.actualHost || "";
    root.dataset.biliCdnAutoRuleInstalled = String(state?.ruleInstalled === true);
  }

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

  function isMediaUrl(value) {
    try {
      const url = new URL(String(value));
      return ["http:", "https:"].includes(url.protocol)
        && isMediaHost(url.hostname)
        && url.pathname.includes("/upgcxcode/");
    } catch {
      return false;
    }
  }

  function sanitizeUrls(values) {
    return [...new Set((Array.isArray(values) ? values : []).filter(isMediaUrl))].slice(0, 8);
  }

  function reportUrls(values, source, observed = false) {
    const known = observed ? observedResourceUrls : discoveredUrls;
    const urls = sanitizeUrls(values).filter((value) => !known.has(value));
    if (!urls.length) return;
    for (const value of urls) known.add(value);
    send({
      type: "media-discovered",
      urls,
      source,
      observed,
      connection: connectionHint(),
    });
  }

  function probeUrl(sourceUrl, host) {
    const target = new URL(String(sourceUrl));
    if (!isMediaUrl(target.href) || !isMediaHost(host)) throw new Error("invalid media probe target");
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
      const targetUrl = probeUrl(sourceUrl, host);
      const suppressions = probeSuppressions.get(targetUrl) || [];
      suppressions.push(Date.now() + 60_000);
      probeSuppressions.set(targetUrl, suppressions);
      const response = await fetch(targetUrl, {
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

  function bufferedAhead(video) {
    if (!video) return 0;
    const time = Number(video.currentTime) || 0;
    for (let index = 0; index < video.buffered.length; index += 1) {
      if (video.buffered.start(index) <= time + 0.05 && video.buffered.end(index) >= time) {
        return Math.max(0, video.buffered.end(index) - time);
      }
    }
    return 0;
  }

  async function waitForSafeBuffer(minimumSeconds, maximumWaitMs) {
    const minimum = Math.max(0, Number(minimumSeconds) || 0);
    if (!minimum || !activeVideo || activeVideo.paused || activeVideo.ended || document.hidden) return;
    const deadline = Date.now() + Math.max(0, Number(maximumWaitMs) || 0);
    while (Date.now() < deadline && activeVideo && !activeVideo.ended) {
      if (bufferedAhead(activeVideo) >= minimum) return;
      await new Promise((resolve) => window.setTimeout(resolve, 500));
    }
  }

  async function probeCandidates(message) {
    const sourceUrl = String(message?.sourceUrl || "");
    const hosts = [...new Set((Array.isArray(message?.hosts) ? message.hosts : [])
      .map((host) => String(host).toLowerCase()).filter(isMediaHost))].slice(0, 8);
    const byteLimit = Math.min(MAX_PROBE_BYTES, Math.max(1, Number(message?.byteLimit) || 128 * 1024));
    const timeoutMs = Math.min(MAX_PROBE_TIMEOUT_MS, Math.max(1_000, Number(message?.timeoutMs) || 4_500));
    if (!hosts.length) return { ok: false, error: "no valid probe hosts", results: [] };
    await waitForSafeBuffer(message?.waitForBufferSeconds, message?.waitTimeoutMs);
    const results = await Promise.all(hosts.map((host) => probe(sourceUrl, host, byteLimit, timeoutMs)));
    return { ok: true, results };
  }

  function startupProtected() {
    return !healthArmed && Date.now() - videoStartedAt < STARTUP_GRACE_MS;
  }

  function reportStall(reason) {
    const now = Date.now();
    if (now - lastStallAt < STALL_COOLDOWN_MS) return;
    lastStallAt = now;
    send({ type: "playback-stall", reason, connection: connectionHint() });
  }

  function scheduleStallCheck(video, reason) {
    if (
      video !== activeVideo || document.hidden || video.paused || video.ended || video.seeking
      || startupProtected() || Date.now() - lastSeekAt < SEEK_GRACE_MS
    ) return;
    window.clearTimeout(stallTimer);
    stallTimer = window.setTimeout(() => {
      stallTimer = 0;
      if (
        video === activeVideo && !document.hidden && !video.paused && !video.ended && !video.seeking
        && bufferedAhead(video) < 0.5
      ) reportStall(reason);
    }, STALL_CONFIRM_MS);
  }

  function sampleHealth() {
    if (!activeVideo || activeVideo.paused || activeVideo.ended || activeVideo.seeking || document.hidden) {
      bufferHistory.length = 0;
      return;
    }
    const ahead = bufferedAhead(activeVideo);
    if (ahead >= HEALTHY_BUFFER_SECONDS) {
      healthArmed = true;
      bufferHistory.length = 0;
      return;
    }
    if (startupProtected() || Date.now() - lastSeekAt < SEEK_GRACE_MS) {
      bufferHistory.length = 0;
      return;
    }
    const duration = Number(activeVideo.duration);
    if (Number.isFinite(duration) && duration > 0 && activeVideo.currentTime + ahead >= duration - 0.5) {
      bufferHistory.length = 0;
      return;
    }
    bufferHistory.push(ahead);
    if (bufferHistory.length > 4) bufferHistory.shift();
    if (
      bufferHistory.length === 4
      && ahead > 0
      && ahead < LOW_BUFFER_SECONDS
      && bufferHistory.every((value, index, values) => index === 0 || value < values[index - 1])
    ) {
      reportStall("buffer-low");
      bufferHistory.length = 0;
    }
  }

  function retryPlayback() {
    const video = activeVideo;
    if (!video || video.ended || video.seeking || !Number.isFinite(video.currentTime)) return false;
    if (video.currentTime > 0.2) {
      video.currentTime = Math.max(0, video.currentTime - 0.15);
      return true;
    }
    return false;
  }

  function watchVideo(video) {
    if (video === activeVideo) return;
    activeVideo = video;
    videoStartedAt = Date.now();
    healthArmed = false;
    lastSeekAt = 0;
    bufferHistory.length = 0;
    video.addEventListener("waiting", () => scheduleStallCheck(video, "waiting"));
    video.addEventListener("stalled", () => scheduleStallCheck(video, "stalled"));
    video.addEventListener("seeking", () => {
      lastSeekAt = Date.now();
      bufferHistory.length = 0;
      window.clearTimeout(stallTimer);
    });
    if (!healthTimer) healthTimer = window.setInterval(sampleHealth, HEALTH_SAMPLE_INTERVAL_MS);
  }

  function locateVideo() {
    const video = document.querySelector("video");
    if (video) watchVideo(video);
  }

  function reportNavigation(url = location.href) {
    if (url === lastUrl) return;
    lastUrl = url;
    discoveredUrls.clear();
    bufferHistory.length = 0;
    send({ type: "page-changed", url });
  }

  function scanPerformanceEntries(entries = performance.getEntriesByType?.("resource") || []) {
    const urls = [];
    for (const entry of entries) {
      const name = String(entry?.name || "");
      if (!isMediaUrl(name)) continue;
      const key = `${name}\n${Number(entry.startTime) || 0}\n${Number(entry.duration) || 0}\n${entry.initiatorType || ""}`;
      if (seenResourceEntries.has(key)) continue;
      seenResourceEntries.add(key);
      const suppressions = (probeSuppressions.get(name) || []).filter((expiresAt) => expiresAt > Date.now());
      if (suppressions.length) {
        suppressions.shift();
        if (suppressions.length) probeSuppressions.set(name, suppressions);
        else probeSuppressions.delete(name);
        continue;
      }
      urls.push(name);
    }
    reportUrls(urls, "performance", true);
  }

  function periodicDiscovery() {
    reportNavigation(location.href);
    window.postMessage({ source: SOURCE, type: "rescan" }, location.origin);
    scanPerformanceEntries();
    if (activeVideo && !activeVideo.paused && !activeVideo.ended && !document.hidden) {
      send({ type: "media-heartbeat", connection: connectionHint() });
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== SOURCE) return;
    if (event.data?.type === "media-urls") {
      reportUrls(event.data.urls, `page-${event.data.reason || "playurl"}`, false);
    } else if (event.data?.type === "page-changed") {
      reportNavigation(String(event.data.url || location.href));
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "rescan") {
      periodicDiscovery();
      return false;
    }
    if (message?.type === "probe-candidates") {
      probeCandidates(message).then(sendResponse).catch((error) => {
        sendResponse({ ok: false, error: String(error?.message || error), results: [] });
      });
      return true;
    }
    if (message?.type === "retry-playback") {
      sendResponse({ ok: true, retried: retryPlayback() });
      return false;
    }
    if (message?.type === "state-update") {
      writeDiagnostics(message.state);
      return false;
    }
    return false;
  });

  const observer = new MutationObserver(locateVideo);
  function startObserver() {
    if (document.documentElement) observer.observe(document.documentElement, { childList: true, subtree: true });
    else document.addEventListener("readystatechange", startObserver, { once: true });
  }
  startObserver();
  writeDiagnostics();
  document.addEventListener("DOMContentLoaded", () => {
    writeDiagnostics();
    locateVideo();
    scanPerformanceEntries();
  }, { once: true });
  window.addEventListener("popstate", () => reportNavigation(location.href));
  window.addEventListener("hashchange", () => reportNavigation(location.href));

  if (typeof PerformanceObserver !== "undefined") {
    try {
      const resourceObserver = new PerformanceObserver((list) => scanPerformanceEntries(list.getEntries()));
      resourceObserver.observe({ type: "resource", buffered: true });
    } catch {}
  }

  window.setInterval(periodicDiscovery, DISCOVERY_INTERVAL_MS);
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  connection?.addEventListener?.("change", () => send({ type: "network-changed", connection: connectionHint() }));
  window.addEventListener("online", () => send({ type: "network-changed", connection: connectionHint() }));
})();
