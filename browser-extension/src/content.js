(() => {
  "use strict";

  const SOURCE = "bili-cdn-auto-page-v2";
  const STALL_COOLDOWN_MS = 8_000;
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

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "rescan") {
      window.postMessage({ source: SOURCE, type: "rescan" }, location.origin);
    }
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
