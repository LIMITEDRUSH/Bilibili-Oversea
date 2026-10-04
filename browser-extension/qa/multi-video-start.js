// Dedicated quiet profile only. No native popup or user-browser mutation.
async (page) => {
  const target = page.__auditTarget || "BV1Kwam6FEZZ";
  if (!/^BV[a-zA-Z0-9]+$/.test(target)) throw new Error("Invalid video ID");
  const context = page.context(), worker = context.serviceWorkers().find(w => w.url().endsWith("/src/worker.js"));
  if (!worker) throw new Error("Extension missing");
  await page.__multiAudit?.session?.detach().catch(() => {});
  await page.goto("about:blank");
  const ui = await context.newPage();
  await ui.goto(new URL("../src/popup.html", worker.url()).href);
  await ui.evaluate(async cold => {
    if (cold) await chrome.storage.local.remove(["biliCdnAutoBenchmarkV5"]);
    await chrome.runtime.sendMessage({ type: "set-settings", settings: { enabled: true, mode: "auto", manualHost: "", disabledHosts: [] } });
  }, page.__auditCold === true);
  await ui.close();
  const session = await context.newCDPSession(page), requests = new Map(), network = [];
  await session.send("Network.enable");
  await session.send("Network.setCacheDisabled", { cacheDisabled: true });
  session.on("Network.requestWillBeSent", e => {
    const url = new URL(e.request.url);
    if (url.pathname.includes("/upgcxcode/")) requests.set(e.requestId, { host: url.hostname, path: url.pathname, at: Date.now(), received: 0 });
  });
  session.on("Network.dataReceived", e => { const request = requests.get(e.requestId); if (request) request.received += e.dataLength || 0; });
  session.on("Network.responseReceived", e => {
    const request = requests.get(e.requestId);
    if (request) Object.assign(request, { actual: new URL(e.response.url).hostname, status: e.response.status, ttfb: Date.now() - request.at, cached: !!(e.response.fromDiskCache || e.response.fromServiceWorker) });
  });
  for (const event of ["Network.loadingFinished", "Network.loadingFailed"]) session.on(event, e => {
    const request = requests.get(e.requestId); if (!request) return;
    network.push({ ...request, elapsed: Date.now() - request.at, bytes: e.encodedDataLength || request.received, error: e.errorText || "" }); requests.delete(e.requestId);
  });
  page.__multiAudit = { session, requests, network, target, cold: page.__auditCold === true };
  if (!page.__multiInit) await page.addInitScript(() => {
    const audit = window.__multiAudit = { started: performance.now(), samples: [], events: [], episodes: [], final: null, meta: null };
    const attached = new WeakSet(); let prior = null, progressAt = performance.now(), frameAt = performance.now(), seekAt = null, lastVideo = null;
    const sample = () => {
      if (audit.final) return;
      const videos = [...document.querySelectorAll("video")];
      const v = videos.find(v => v.closest("#bilibili-player, .bpx-player-container")) || videos[0]; if (!v) return;
      const now = performance.now(), frames = v.getVideoPlaybackQuality?.();
      audit.meta ||= { title: document.title, views: document.querySelector(".view-text")?.textContent };
      if (v !== lastVideo) { prior = null; progressAt = frameAt = now; lastVideo = v; }
      if (!attached.has(v)) {
        attached.add(v);
        for (const type of ["playing", "waiting", "stalled", "pause", "seeking", "seeked", "error", "ended"]) v.addEventListener(type, () => {
          if (audit.final) return;
          audit.events.push({ type, at: Math.round(performance.now() - audit.started), time: +v.currentTime.toFixed(3) });
          if (type === "ended" && !audit.final) { sample(); audit.final = { ...audit.meta, endedWall: Date.now(), duration: v.duration, quality: document.querySelector(".bpx-player-ctrl-quality-result")?.textContent, width: v.videoWidth, height: v.videoHeight }; }
        });
      }
      let buffer = 0;
      for (let i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= v.currentTime + .05 && v.buffered.end(i) >= v.currentTime) buffer = v.buffered.end(i) - v.currentTime;
      if (prior && v.currentTime > prior.time + .01) progressAt = now;
      if (prior && frames?.totalVideoFrames > prior.frames) frameAt = now;
      if (v.paused || v.ended) progressAt = frameAt = now;
      if (v.seeking) seekAt ??= now; else seekAt = null;
      const flags = [];
      if (!v.paused && !v.ended && v.currentTime > 1 && v.duration - v.currentTime > 1) {
        if (!v.seeking && now - progressAt > 1500) flags.push("playhead-freeze");
        if (!v.seeking && frames && now - frameAt > 1500) flags.push("decoded-frame-freeze");
        if (seekAt && now - seekAt > 4000) flags.push("seek-hang");
      }
      for (const flag of flags) {
        let episode = audit.episodes.findLast(e => e.flag === flag);
        if (!episode || now - episode.last > 750) { episode = { flag, first: now, last: now, time: v.currentTime, buffer }; audit.episodes.push(episode); }
        else episode.last = now;
      }
      const s = { at: Math.round(now - audit.started), time: v.currentTime, frames: frames?.totalVideoFrames || 0, dropped: frames?.droppedVideoFrames || 0, buffer, ready: v.readyState, paused: v.paused, seeking: v.seeking,
        selected: document.documentElement.dataset.biliCdnAutoSelectedHost || "", actual: document.documentElement.dataset.biliCdnAutoActualHost || "" };
      if (!audit.final) audit.samples.push(s); prior = s;
    };
    setInterval(sample, 250);
  });
  page.__multiInit = true;
  await page.goto("https://www.bilibili.com/video/" + target + "/", { waitUntil: "domcontentloaded" });
  await page.bringToFront(); await page.waitForSelector("video");
  await page.waitForFunction(() => document.querySelector("video")?.readyState >= 1);
  await page.evaluate(async () => { const v = document.querySelector("video"); v.muted = true; v.currentTime = 0; await v.play().catch(() => {}); });
  return await page.evaluate(() => ({ title: document.title, views: document.querySelector(".view-text")?.textContent,
    quality: document.querySelector(".bpx-player-ctrl-quality-result")?.textContent, visibility: document.visibilityState,
    policy: "single sequential playback; browser cache disabled; CDN cache unknown" }));
}
