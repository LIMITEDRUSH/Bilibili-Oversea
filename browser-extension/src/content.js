(() => {
  "use strict";

  const SOURCE = "bili-cdn-auto-page-v2";
  const DISCOVERY_INTERVAL_MS = 10_000;
  const HEALTH_SAMPLE_INTERVAL_MS = 2_000;
  const STALL_CONFIRM_MS = 2_500;
  const STALL_COOLDOWN_MS = 8_000;
  const STARTUP_GRACE_MS = 10_000;
  const SEEK_GRACE_MS = 4_000;
  const HEALTHY_BUFFER_SECONDS = 12;
  const LOW_BUFFER_SECONDS = 8;
  const MIN_BUFFER_DRAIN_SECONDS = 4;
  const HEALTH_WINDOW_SAMPLES = 4;
  const MAX_PROBE_BYTES = 1024 * 1024;
  const MAX_PROBE_TIMEOUT_MS = 15_000;
  const discoveredUrls = new Set();
  const observedResourceUrls = new Set();
  const observedResponseUrls = new Set();
  const seenResourceEntries = new Set();
  const bufferHistory = [];
  const trackKinds = new Map();
  const mediaOriginals = new Map();
  const probeControllers = new Set();
  let probeGeneration = 0;
  let nextProbeId = 0;
  let navigationResourceTime = 0;
  let activeVideo = null;
  let videoStartedAt = 0;
  let healthArmed = false;
  let lastSeekAt = 0;
  let lastStallAt = 0;
  let stallTimer = 0;
  let healthTimer = 0;
  let recoveryTimer = 0;
  let recoveryVideo = null;
  let lastUrl = location.href;

  // Read-only popup telemetry. No timer, network request, or routing message.
  const displayVideos = new WeakMap();
  let displayPage = location.href;
  let displayPreviousVideo = null;
  let displayPreviousSource = "";
  let displayNavigationPending = false;

  function displayVideo() {
    const videos = [...(document.querySelectorAll?.("video") || [])];
    return videos.sort((a, b) => {
      const score = video => {
        const rect = video.getBoundingClientRect?.() || {};
        const main = video.closest?.("#bilibili-player, #bilibiliPlayer, .bpx-player-container, .bilibili-player, .bilibili-player-video, .player-container");
        return (main ? 1e9 : 0) + Math.max(0, rect.width || 0) * Math.max(0, rect.height || 0);
      };
      return score(b) - score(a);
    })[0] || null;
  }

  function readPlaybackInfo() {
    const video = displayVideo();
    const source = String(video?.currentSrc || video?.src || "");
    if (displayPage !== location.href) {
      displayPage = location.href;
      displayNavigationPending = Boolean(video && video === displayPreviousVideo && source === displayPreviousSource
        && displayVideos.get(video)?.page !== displayPage);
      const old = video && displayVideos.get(video);
      if (old && displayNavigationPending) { old.status = "loading"; old.lastTime = Number(video.currentTime) || 0; }
    }
    const heading = document.querySelector("h1.video-title, .video-info-title, h1.media-title, .mediainfo_mediaTitle__yejlB");
    const title = String(heading?.getAttribute?.("title") || heading?.textContent || document.title || "")
      .replace(/[_\s-]*(?:哔哩哔哩|bilibili)(?:_.*)?$/i, "").trim().slice(0, 240);
    const candidateHosts = [...new Set([...discoveredUrls, ...observedResourceUrls, ...observedResponseUrls]
      .filter(isMediaUrl).map(url => new URL(url).hostname))].slice(0, 12);
    const result = { sampledAt: Date.now(), hasVideo: Boolean(video), title, status: "empty", candidateHosts };
    if (!video) { displayPreviousVideo = null; displayPreviousSource = ""; return result; }
    let display = displayVideos.get(video);
    if (!display) {
      display = { status: "loading", lastTime: Number(video.currentTime) || 0, page: displayPage };
      displayVideos.set(video, display);
      for (const name of ["playing", "waiting", "stalled", "pause", "ended", "seeking", "error", "loadstart", "emptied", "loadedmetadata", "timeupdate"]) {
        video.addEventListener(name, () => {
          // Ignore detached display sessions after a navigation.
          if (displayVideos.get(video) !== display) return;
          if (name === "loadedmetadata" || name === "loadstart" || name === "emptied") {
            displayNavigationPending = false;
            display.page = location.href;
            display.status = "loading";
          } else if (name === "playing") display.status = "playing";
          else if (name === "waiting" || name === "stalled") display.status = "buffering";
          else if (name === "timeupdate") {
            if (Number(video.currentTime) > display.lastTime && !video.paused && !video.seeking) display.status = "playing";
          } else display.status = name === "pause" ? "paused" : name;
        });
      }
    }
    if (displayNavigationPending && (video !== displayPreviousVideo || source !== displayPreviousSource)) displayNavigationPending = false;
    if (displayNavigationPending) return { ...result, hasVideo: false, status: "loading", title: "正在加载视频" };
    const currentTime = Number(video.currentTime);
    const moving = Number.isFinite(currentTime) && currentTime > display.lastTime && currentTime - display.lastTime < 5;
    const status = video.error ? "error" : video.ended ? "ended" : video.seeking ? "seeking"
      : video.paused ? "paused" : Number(video.readyState) < 3 ? "buffering"
      : moving ? "playing" : display.status;
    display.lastTime = currentTime;
    display.status = status;
    displayPreviousVideo = video;
    displayPreviousSource = source;
    return { ...result, status, currentTime, duration: Number.isFinite(video.duration) ? video.duration : null,
      width: Number(video.videoWidth) || 0, height: Number(video.videoHeight) || 0,
      bufferedAhead: Number(bufferedAhead(video).toFixed(3)) };
  }

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

  function connectionSignature() {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    return [
      navigator.onLine ? "online" : "offline",
      String(connection?.type || "unknown"),
      String(connection?.effectiveType || "unknown"),
    ].join("|");
  }

  function isMediaHost(host) {
    const value = String(host || "").toLowerCase();
    return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+bilivideo\.com$/.test(value)
      || /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+mcdn\.bilivideo\.cn$/.test(value)
      || value === "upos-hz-mirrorakam.akamaized.net";
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
    const weight = url => ({ video: 0, audio: 2 }[trackKinds.get(new URL(url).pathname)] ?? 1);
    return [...new Set((Array.isArray(values) ? values : []).filter(isMediaUrl))]
      .sort((left, right) => weight(left) - weight(right)).slice(0, 8);
  }

  function reportUrls(values, source, observed = false) {
    const known = source === "page-response" ? observedResponseUrls : observed ? observedResourceUrls : discoveredUrls;
    const urls = sanitizeUrls(values).filter((value) => !known.has(value));
    if (!urls.length) return;
    for (const value of urls) known.add(value);
    send({
      type: "media-discovered",
      urls,
      source,
      observed,
      tracks: urls.map(url => ({ url, kind: trackKinds.get(new URL(url).pathname) || "unknown" })),
      originals: source === "page-response" ? urls.map(url => mediaOriginals.get(url)).filter(Boolean) : [],
      pageUrl: location.href,
      connection: connectionHint(),
    });
  }

  function probeUrl(sourceUrl, host) {
    const target = new URL(String(sourceUrl));
    if (!isMediaUrl(target.href) || !isMediaHost(host)) throw new Error("invalid media probe target");
    target.hostname = String(host).toLowerCase();
    return target.href;
  }

  async function probe(sourceUrl, host, byteLimit, timeoutMs, startByte = 0) {
    const controller = new AbortController();
    const probeId = Date.now().toString(36) + "-" + (++nextProbeId);
    controller.signal.addEventListener("abort", () => send({ type: "cancel-probe", probeId }), { once: true });
    probeControllers.add(controller);
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    const started = performance.now();
    let ttfbMs = 0;
    try {
      probeUrl(sourceUrl, host); // Validate before crossing the message boundary.
      return await chrome.runtime.sendMessage({ type: "fetch-probe", sourceUrl, host, byteLimit, timeoutMs, probeId, startByte });
    } catch (error) {
      return {
        host, ok: false, status: 0, bytes: 0,
        elapsedMs: performance.now() - started, ttfbMs,
        error: error?.name === "AbortError" ? "timeout" : String(error?.message || error),
      };
    } finally {
      probeControllers.delete(controller);
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

  async function waitForSafeBuffer(minimumSeconds, maximumWaitMs, generation) {
    const minimum = Math.max(0, Number(minimumSeconds) || 0);
    if (!minimum) return true;
    if (!activeVideo || activeVideo.paused || activeVideo.ended || document.hidden) return false;
    const deadline = Date.now() + Math.max(0, Number(maximumWaitMs) || 0);
    do {
      if (generation !== probeGeneration || !activeVideo || activeVideo.paused
        || activeVideo.ended || activeVideo.seeking || document.hidden) return false;
      if (bufferedAhead(activeVideo) >= minimum) return true;
      if (Date.now() >= deadline) return false;
      await new Promise((resolve) => window.setTimeout(resolve, 500));
    } while (Date.now() <= deadline);
    return false;
  }

  async function probeCandidates(message) {
    const generation = probeGeneration;
    const sourceUrl = String(message?.sourceUrl || "");
    const hosts = [...new Set((Array.isArray(message?.hosts) ? message.hosts : [])
      .map((host) => String(host).toLowerCase()).filter(isMediaHost))].slice(0, 8);
    const byteLimit = Math.min(MAX_PROBE_BYTES, Math.max(1, Number(message?.byteLimit) || 128 * 1024));
    const timeoutMs = Math.min(MAX_PROBE_TIMEOUT_MS, Math.max(1_000, Number(message?.timeoutMs) || 4_500));
    if (!hosts.length) return { ok: false, error: "no valid probe hosts", results: [] };
    if (!await waitForSafeBuffer(message?.waitForBufferSeconds, message?.waitTimeoutMs, generation)
      || generation !== probeGeneration) {
      return { ok: false, skipped: true, error: "safe buffer unavailable", results: [] };
    }
    const startByte = Number.isSafeInteger(message?.startByte) && message.startByte >= 0 && message.startByte <= 2 ** 40 ? message.startByte : 0;
    const results = await Promise.all(hosts.map((host) => probe(sourceUrl, host, byteLimit, timeoutMs, startByte)));
    if (generation !== probeGeneration) return { ok: false, skipped: true, results: [] };
    return { ok: true, results };
  }

  function startupProtected() {
    return !healthArmed && Date.now() - videoStartedAt < STARTUP_GRACE_MS;
  }

  function reportStall(reason) {
    const now = Date.now();
    if (now - lastStallAt < STALL_COOLDOWN_MS) return;
    lastStallAt = now;
    cancelProbes();
    send({ type: "playback-stall", reason, connection: connectionHint() });
  }

  function scheduleStallCheck(video, reason) {
    if (
      video !== activeVideo || document.hidden || video.paused || video.ended || video.seeking
      || Date.now() - lastSeekAt < SEEK_GRACE_MS
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
    if (bufferHistory.length > HEALTH_WINDOW_SAMPLES) bufferHistory.shift();
    const drain = bufferHistory.length ? bufferHistory[0] - ahead : 0;
    if (
      bufferHistory.length === HEALTH_WINDOW_SAMPLES
      && ahead > 0
      && ahead < LOW_BUFFER_SECONDS
      && drain >= MIN_BUFFER_DRAIN_SECONDS
      && bufferHistory.every((value, index, values) => index === 0 || value <= values[index - 1] + 0.25)
    ) {
      reportStall("buffer-low");
      bufferHistory.length = 0;
    }
  }

  function retryPlayback() {
    const video = activeVideo;
    if (!video || video.ended || (video.seeking && recoveryVideo !== video) || !Number.isFinite(video.currentTime)) return false;
    if (video.currentTime > 0.2) video.currentTime = Math.max(0, video.currentTime - 0.15);
    else if (Number.isFinite(video.duration) && video.duration > 0) video.currentTime = Math.min(0.001, video.duration / 2);
    else return false;
    clearRecoveryWatchdog();
    recoveryVideo = video;
    // A recovery-triggered seek can itself hang on the failed request. Do not
    // let `seeking` suppress all recovery forever; use the existing cooldown.
    recoveryTimer = window.setTimeout(() => {
      recoveryTimer = 0;
      if (video === activeVideo && !document.hidden && !video.paused && !video.ended
        && bufferedAhead(video) < 0.5) reportStall("recovery-timeout");
    }, STALL_COOLDOWN_MS + 1);
    return true;
  }

  function clearRecoveryWatchdog() {
    window.clearTimeout(recoveryTimer);
    recoveryTimer = 0;
    recoveryVideo = null;
  }

  function watchVideo(video) {
    if (video === activeVideo) return;
    activeVideo = video;
    clearRecoveryWatchdog();
    videoStartedAt = Date.now();
    healthArmed = false;
    lastSeekAt = 0;
    lastStallAt = 0;
    bufferHistory.length = 0;
    video.addEventListener("waiting", () => scheduleStallCheck(video, "waiting"));
    video.addEventListener("play", periodicDiscovery);
    video.addEventListener("stalled", () => scheduleStallCheck(video, "stalled"));
    video.addEventListener("playing", clearRecoveryWatchdog);
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
    cancelProbes();
    clearRecoveryWatchdog();
    discoveredUrls.clear();
    trackKinds.clear();
    mediaOriginals.clear();
    observedResourceUrls.clear();
    observedResponseUrls.clear();
    seenResourceEntries.clear();
    navigationResourceTime = performance.now();
    bufferHistory.length = 0;
    videoStartedAt = Date.now();
    healthArmed = false;
    lastStallAt = 0;
    send({ type: "page-changed", url });
  }

  function scanPerformanceEntries(entries = performance.getEntriesByType?.("resource") || []) {
    const urls = [];
    for (const entry of entries) {
      const name = String(entry?.name || "");
      if (Number(entry.startTime) < navigationResourceTime) continue;
      if (!isMediaUrl(name)) continue;
      const key = `${name}\n${Number(entry.startTime) || 0}\n${Number(entry.duration) || 0}\n${entry.initiatorType || ""}`;
      if (seenResourceEntries.has(key)) continue;
      seenResourceEntries.add(key);
      urls.push(name);
    }
    reportUrls(urls, "performance", true);
  }

  function periodicDiscovery() {
    reportNavigation(location.href);
    window.postMessage({ source: SOURCE, type: "rescan" }, location.origin);
    scanPerformanceEntries();
    if (activeVideo && !activeVideo.paused && !activeVideo.ended && !document.hidden) {
      send({
        type: "media-heartbeat",
        activity: {
          visible: !document.hidden,
          paused: activeVideo.paused,
          ended: activeVideo.ended,
          seeking: activeVideo.seeking,
          bufferedAhead: Number(bufferedAhead(activeVideo).toFixed(3)),
        },
        connection: connectionHint(),
      });
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== SOURCE) return;
    if (event.data?.type === "media-urls") {
      for (const track of (Array.isArray(event.data.tracks) ? event.data.tracks : []).slice(0, 128)) {
        if (isMediaUrl(track?.url) && ["video", "audio"].includes(track.kind)) {
          trackKinds.set(new URL(track.url).pathname, track.kind);
          if (trackKinds.size > 512) trackKinds.delete(trackKinds.keys().next().value);
        }
      }
      reportUrls(event.data.urls, `page-${event.data.reason || "playurl"}`, false);
    } else if (event.data?.type === "media-observed") {
      for (const item of (Array.isArray(event.data.originals) ? event.data.originals : []).slice(0, 8)) {
        if (isMediaUrl(item?.url) && isMediaUrl(item.originalUrl)
          && new URL(item.url).pathname === new URL(item.originalUrl).pathname) {
          mediaOriginals.set(item.url, { url: item.url, originalUrl: item.originalUrl,
            startByte: Number.isSafeInteger(item.startByte) && item.startByte >= 0 && item.startByte <= 2 ** 40 ? item.startByte : 0 });
          if (mediaOriginals.size > 512) mediaOriginals.delete(mediaOriginals.keys().next().value);
          // Repeat transfers of one signed URL have different Range offsets.
          observedResponseUrls.delete(item.url);
        }
      }
      reportUrls(event.data.urls, "page-response", true);
    } else if (event.data?.type === "page-changed") {
      reportNavigation(String(event.data.url || location.href));
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "get-playback-info") {
      sendResponse({ ok: true, playback: readPlaybackInfo() });
      return false;
    }
    if (message?.type === "cancel-probes") {
      cancelProbes();
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === "rescan") {
      // MV3 workers can sleep while the page stays open. Replay known media
      // without downloading or reclassifying resources from older videos.
      for (const [known, observed] of [[discoveredUrls, false], [observedResourceUrls, true], [observedResponseUrls, true]]) {
        const urls = sanitizeUrls([...known].reverse());
        if (urls.length) send({ type: "media-discovered", urls, observed, tracks: urls.map(url => ({ url, kind: trackKinds.get(new URL(url).pathname) || "unknown" })), originals: known === observedResponseUrls ? urls.map(url => mediaOriginals.get(url)).filter(Boolean) : [], source: known === observedResponseUrls ? "page-response" : "rescan-cache", pageUrl: location.href, connection: connectionHint() });
      }
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

  function cancelProbes() {
    probeGeneration += 1;
    for (const controller of probeControllers) controller.abort();
    probeControllers.clear();
  }

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
  let lastConnectionSignature = connectionSignature();
  function reportNetworkChange() {
    const nextSignature = connectionSignature();
    if (nextSignature === lastConnectionSignature) return;
    lastConnectionSignature = nextSignature;
    send({ type: "network-changed", connection: connectionHint() });
  }
  connection?.addEventListener?.("change", reportNetworkChange);
  window.addEventListener("online", reportNetworkChange);
  window.addEventListener("offline", reportNetworkChange);
  // Explicit user interaction cancels this narrowly scoped recovery watchdog.
  window.addEventListener("pointerdown", clearRecoveryWatchdog, { capture: true });
  window.addEventListener("keydown", clearRecoveryWatchdog, { capture: true });
})();
