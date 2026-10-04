// Dedicated quiet QA profile only. Tests tab lifecycle, not zero-stall playback.
async (page) => {
  const context = page.context();
  const worker = context.serviceWorkers().find(w => w.url().endsWith("/src/worker.js"));
  if (!worker) throw new Error("Extension worker required");
  const ui = await context.newPage();
  await ui.goto(new URL("../src/popup.html", worker.url()).href);
  const keys = ["biliCdnAutoSettingsV2", "biliCdnAutoBenchmarkV5"];
  const saved = await ui.evaluate(keys => chrome.storage.local.get(keys), keys);
  const checks = [], cases = [];
  const check = (name, value, detail) => {
    checks.push({ name, pass: !!value, detail });
    if (!value) throw new Error(name);
  };
  const state = async tabId => (await ui.evaluate(tabId => chrome.runtime.sendMessage({ type: "get-state", tabId }), tabId)).state;
  const rules = () => ui.evaluate(() => chrome.declarativeNetRequest.getSessionRules());
  const until = async (read, condition, timeout = 45000) => {
    const start = Date.now(); let result;
    do { result = await read(); if (condition(result)) return result; await page.waitForTimeout(250); } while (Date.now() - start < timeout);
    throw new Error("Timed out: " + JSON.stringify(result));
  };
  const opened = [];
  const openVideo = async bvid => {
    const videoPage = await context.newPage(); opened.push(videoPage);
    const session = await context.newCDPSession(videoPage);
    const urls = [];
    await session.send("Network.enable");
    await session.send("Network.setCacheDisabled", { cacheDisabled: true });
    session.on("Network.requestWillBeSent", event => {
      if (new URL(event.request.url).pathname.includes("/upgcxcode/")) urls.push(event.request.url);
    });
    await videoPage.goto("https://www.bilibili.com/video/" + bvid + "/", { waitUntil: "domcontentloaded" });
    await videoPage.bringToFront();
    await videoPage.waitForFunction(() => document.querySelector("video")?.readyState >= 1);
    await videoPage.evaluate(async () => { const v = document.querySelector("video"); v.muted = true; v.currentTime = 0; await v.play().catch(() => {}); });
    const tabId = await ui.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)?.id, videoPage.url());
    if (!Number.isInteger(tabId)) throw new Error("Playback tab unavailable");
    const metadata = await videoPage.evaluate(() => ({
      title: document.title, views: document.querySelector(".view-text")?.textContent,
      quality: document.querySelector(".bpx-player-ctrl-quality-result")?.textContent,
      width: document.querySelector("video").videoWidth, height: document.querySelector("video").videoHeight,
    }));
    return { videoPage, session, urls, tabId, bvid, metadata };
  };
  const closeVideo = async test => {
    await test.videoPage.close();
    await until(() => state(test.tabId), s => s === null, 5000);
    await until(rules, list => !list.some(rule => rule.condition.tabIds?.includes(test.tabId)), 5000);
    check(test.bvid + " old state and redirect removed", true);
  };
  try {
    await ui.evaluate(async () => {
      await chrome.storage.local.set({ biliCdnAutoSettingsV2: { enabled: true, mode: "auto", manualHost: "", disabledHosts: [] } });
      await chrome.storage.local.remove("biliCdnAutoBenchmarkV5");
    });
    const first = await openVideo("BV1Kwam6FEZZ");
    const firstState = await until(() => state(first.tabId), s => s?.phase === "active" && s.lastTestedAt > 0);
    check("First tab cold benchmark completes", firstState.sourceKind === "video" && firstState.results.some(r => r.ok), { tabId: first.tabId, selected: firstState.selectedHost });
    first.metadata.quality = await first.videoPage.locator(".bpx-player-ctrl-quality-result").textContent();
    cases.push({ bvid: first.bvid, ...first.metadata, mode: "cold", phase: firstState.phase });
    await closeVideo(first);
    const second = await openVideo("BV17eHY6yEJm");
    const initial = await until(() => state(second.tabId), s => !!s?.selectedHost);
    check("New tab independently receives cached results", initial.lastTestedAt === firstState.lastTestedAt && initial.sourceKind === "video", { oldTab: first.tabId, newTab: second.tabId, phase: initial.phase });
    const verified = await until(() => state(second.tabId), s => s?.phase === "active" && s.lastVerifiedAt > firstState.lastVerifiedAt);
    check("New tab performs automatic safe-buffer maintenance", verified.results.some(r => r.ok), { testedAt: verified.lastTestedAt, verifiedAt: verified.lastVerifiedAt });
    second.metadata.quality = await second.videoPage.locator(".bpx-player-ctrl-quality-result").textContent();
    cases.push({ bvid: second.bvid, ...second.metadata, mode: "warm then automatic verification", phase: verified.phase });

    // Controlled confirmed-stall transport test: not a naturally observed stall.
    const contexts = [];
    second.session.on("Runtime.executionContextCreated", event => contexts.push(event.context));
    await second.session.send("Runtime.enable");
    const extensionId = worker.url().split("/")[2];
    let isolated;
    for (const candidate of contexts.filter(c => c.auxData?.isDefault === false)) {
      const probe = await second.session.send("Runtime.evaluate", { contextId: candidate.id,
        expression: "globalThis.chrome?.runtime?.id", returnByValue: true }).catch(() => null);
      if (probe?.result?.value === extensionId) { isolated = candidate; break; }
    }
    if (!isolated) throw new Error("Extension isolated execution context not found");
    const beforeHost = verified.selectedHost;
    await second.session.send("Runtime.evaluate", { contextId: isolated.id, expression: 'chrome.runtime.sendMessage({type:"playback-stall",reason:"qa-controlled-confirmed-stall"})', awaitPromise: true, returnByValue: true });
    const switched = await until(() => state(second.tabId), s => !!s?.selectedHost && s.selectedHost !== beforeHost, 5000);
    check("Confirmed-stall message rotates candidate in the new tab", switched.results.some(r => r.host === switched.selectedHost && r.ok), { from: beforeHost, to: switched.selectedHost, controlled: true });
    const source = await second.videoPage.evaluate(urls => {
      const videos = window.__playinfo__?.data?.dash?.video || [];
      return [...urls].reverse().find(url => videos.some(v => new URL(v.baseUrl || v.base_url).pathname === new URL(url).pathname));
    }, second.urls);
    if (!source) throw new Error("Actual video request source unavailable");
    const routed = await second.videoPage.evaluate(async url => {
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 5000);
      try { const response = await fetch(url, { headers: { Range: "bytes=0-1023" }, signal: controller.signal }); const host = new URL(response.url).hostname; await response.body?.cancel(); return { host, status: response.status }; }
      finally { clearTimeout(timeout); }
    }, source);
    check("New tab redirect routes a controlled 1 KiB media request", routed.host === switched.selectedHost && routed.status === 206, { ...routed, controlled: true });

    await ui.evaluate(async tabId => {
      await chrome.storage.local.remove("biliCdnAutoBenchmarkV5");
      await chrome.runtime.sendMessage({ type: "set-settings", tabId, forceRetest: true, settings: { enabled: true, mode: "auto", manualHost: "", disabledHosts: [] } });
    }, second.tabId);
    const busy = await state(second.tabId);
    check("Second tab is closed during a real retest", busy.phase === "testing", { phase: busy.phase });
    await closeVideo(second);
    const third = await openVideo("BV1PCHi6KERb");
    const final = await until(() => state(third.tabId), s => s?.phase === "active" && s.lastTestedAt > verified.lastTestedAt);
    check("After closing a testing tab, next tab benchmarks and selects independently", final.sourceKind === "video" && final.results.some(r => r.ok), { tabId: third.tabId, selected: final.selectedHost });
    check("No old redirects return after new benchmark", !(await rules()).some(rule => [first.tabId, second.tabId].some(id => rule.condition.tabIds?.includes(id))));
    third.metadata.quality = await third.videoPage.locator(".bpx-player-ctrl-quality-result").textContent();
    cases.push({ bvid: third.bvid, ...third.metadata, mode: "cold after closing retest", phase: final.phase });
    await closeVideo(third);
    return { pass: true, version: await ui.evaluate(() => chrome.runtime.getManifest().version), checks, cases,
      scope: "quiet real Edge tab close/reopen and real probes; controlled confirmed-stall message and 1 KiB routing check; not full-playback or natural-stall acceptance" };
  } catch (error) { return { pass: false, failure: error.message, checks, cases }; }
  finally {
    for (const p of opened) if (!p.isClosed()) await p.close();
    await ui.evaluate(async ({ keys, saved }) => { await chrome.storage.local.remove(keys); await chrome.storage.local.set(saved); }, { keys, saved }).catch(() => {});
    await ui.close(); await page.bringToFront();
  }
}
