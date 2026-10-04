import assert from "node:assert/strict";
import test from "node:test";

const CACHE_KEY = "biliCdnAutoBenchmarkV4";

function installChrome({ storage = {}, probeResult, probeStage, updateRule } = {}) {
  let messageListener;
  const ruleUpdates = [];
  const probeMessages = [];
  const tabMessages = [];
  const broadcasts = [];
  const events = {};
  const noopEvent = { addListener() {} };
  globalThis.chrome = {
    action: {
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {},
    },
    declarativeNetRequest: {
      updateSessionRules: async (update) => { ruleUpdates.push(update); if (updateRule) await updateRule(update); },
    },
    runtime: {
      id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      onMessage: { addListener(listener) { messageListener = listener; } },
      onInstalled: noopEvent,
      sendMessage: async message => { broadcasts.push(message); },
    },
    storage: {
      local: {
        async get(key) { return { [key]: storage[key] }; },
        async set(value) { Object.assign(storage, value); },
      },
    },
    tabs: {
      onRemoved: { addListener(listener) { events.removed = listener; } },
      onUpdated: { addListener(listener) { events.updated = listener; } },
      sendMessage: async (tabId, message) => {
        tabMessages.push({ tabId, message });
        if (message.type !== "probe-candidates") return undefined;
        probeMessages.push(message);
        if (probeStage) return probeStage(message);
        return {
          ok: true,
          results: message.hosts.map((host) => probeResult?.(host, message) || ({
            host,
            ok: true,
            status: 206,
            bytes: message.byteLimit,
            elapsedMs: host.includes("cosov") ? 10 : host.includes("hwov") ? 40 : 80,
            ttfbMs: 2,
          })),
        };
      },
    },
  };
  return {
    storage,
    ruleUpdates,
    probeMessages,
    tabMessages,
    broadcasts,
    events,
    listener: () => messageListener,
  };
}

test("后台无内存状态时心跳请求无下载重扫描", async () => {
  const harness = installChrome();
  try {
    await import(`../src/worker.js?test=wakeup-${Date.now()}`);
    const response = await send(harness.listener(), { type: "media-heartbeat", activity: { visible: true, paused: false } }, { tab: { id: 71 } });
    assert.equal(response.ok, true);
    assert.ok(harness.tabMessages.some(({ tabId, message }) => tabId === 71 && message.type === "rescan"));
    assert.equal(harness.probeMessages.length, 0);
  } finally { delete globalThis.chrome; }
});

test("无缓存时切回自动立即响应，测速期间仍可暂停，不锁住弹窗", async () => {
  let finish;
  const harness = installChrome({
    storage: { biliCdnAutoSettingsV2: { enabled: true, mode: "original" } },
    probeStage: () => new Promise(resolve => { finish = resolve; }),
  });
  try {
    await import(`../src/worker.js?test=responsive-auto-${Date.now()}`);
    await send(harness.listener(), { type: "media-discovered", urls: ["https://origin.bilivideo.com/upgcxcode/a/video.m4s"] }, { tab: { id: 73 } });
    const automatic = await send(harness.listener(), { type: "set-settings", tabId: 73, settings: { enabled: true, mode: "auto" } });
    assert.equal(automatic.ok, true);
    while (!finish) await new Promise(resolve => setTimeout(resolve, 0));
    const paused = await send(harness.listener(), { type: "set-settings", tabId: 73, settings: { enabled: false, mode: "auto" } });
    assert.equal(paused.state.ruleInstalled, false);
    finish({ ok: true, results: harness.probeMessages[0].hosts.map(host => ({ host, ok: true, status: 206, bytes: 1024, elapsedMs: 1 })) });
    await new Promise(resolve => setTimeout(resolve, 0));
    const final = await send(harness.listener(), { type: "get-state", tabId: 73 });
    assert.equal(final.settings.enabled, false);
    assert.equal(final.state.phase, "original");
    const latest = harness.broadcasts.at(-1);
    assert.equal(latest.settings.enabled, false);
    assert.equal(latest.settings.mode, "auto");
    assert.equal(latest.state.phase, "original");
    assert.equal(harness.ruleUpdates.some(update => update.addRules?.length), false);
  } finally { delete globalThis.chrome; }
});

for (const transition of ["removed", "updated", "loading-without-url"]) test(`标签页 ${transition} 后迟到测速不能重建状态与规则`, async () => {
  let finish;
  const harness = installChrome({ probeStage: () => new Promise(resolve => { finish = resolve; }) });
  try {
    await import(`../src/worker.js?test=tab-${transition}-${Date.now()}`);
    const discovery = send(harness.listener(), { type: "media-discovered", urls: ["https://origin.bilivideo.com/upgcxcode/a/video.m4s"] }, { tab: { id: 72 } });
    while (!finish) await new Promise(resolve => setTimeout(resolve, 0));
    if (transition === "removed") harness.events.removed(72);
    else harness.events.updated(72, transition === "updated" ? { url: "https://example.com" } : { status: "loading" });
    finish({ ok: true, results: harness.probeMessages[0].hosts.map(host => ({ host, ok: true, status: 206, bytes: 1024, elapsedMs: 1 })) });
    await discovery;
    const final = await send(harness.listener(), { type: "get-state", tabId: 72 });
    assert.equal(final.state, null);
    assert.equal(harness.ruleUpdates.some(update => update.addRules?.length), false);
  } finally { delete globalThis.chrome; }
});

function send(listener, message, sender = {}) {
  return new Promise((resolve) => {
    const keepAlive = listener(message, sender, resolve);
    assert.equal(keepAlive, true);
  });
}

test("测速代理限定媒体地址、独立请求、暂停时终止在途读取", async () => {
  const harness = installChrome();
  const originalFetch = globalThis.fetch;
  let captured;
  let aborted = false;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return new Promise((resolve, reject) => options.signal.addEventListener("abort", () => {
      aborted = true;
      reject(new DOMException("aborted", "AbortError"));
    }, { once: true }));
  };
  try {
    await import(`../src/worker.js?test=broker-${Date.now()}`);
    const invalid = await send(harness.listener(), { type: "fetch-probe", probeId: "invalid", sourceUrl: "https://example.com/file", host: "cdn.bilivideo.com" }, { tab: { id: 74 } });
    assert.equal(invalid.ok, false);
    assert.match(invalid.error, /invalid probe request/);
    assert.equal(captured, undefined);
    const pending = send(harness.listener(), { type: "fetch-probe", probeId: "qa-1", sourceUrl: "https://origin.bilivideo.com/upgcxcode/a.m4s?token=keep", host: "cdn.bilivideo.com", byteLimit: 1024 }, { tab: { id: 74 } });
    while (!captured) await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(captured.url, "https://cdn.bilivideo.com/upgcxcode/a.m4s?token=keep");
    assert.equal(captured.options.credentials, "omit");
    assert.equal(captured.options.headers.Range, "bytes=0-1023");
    const headerRule = harness.ruleUpdates.find(update => update.addRules?.[0].action.type === "modifyHeaders").addRules[0];
    assert.deepEqual(headerRule.condition.initiatorDomains, [chrome.runtime.id]);
    assert.equal(headerRule.condition.tabIds, undefined);
    await send(harness.listener(), { type: "set-settings", tabId: 74, settings: { enabled: false } });
    assert.equal(aborted, true);
    assert.equal((await pending).ok, false);
  } finally { globalThis.fetch = originalFetch; delete globalThis.chrome; }
});

test("撤销规则失败会明确报错，不伪报已直通原始线路", async () => {
  let rejectRemoval = false;
  const harness = installChrome({ updateRule: async update => {
    if (rejectRemoval && !update.addRules?.length) throw new Error("browser refused rule update");
  } });
  try {
    await import(`../src/worker.js?test=rule-error-${Date.now()}`);
    await send(harness.listener(), { type: "media-discovered", urls: ["https://origin.bilivideo.com/upgcxcode/a.m4s"] }, { tab: { id: 75 } });
    rejectRemoval = true;
    const pause = await send(harness.listener(), { type: "set-settings", tabId: 75, settings: { enabled: false } });
    assert.equal(pause.ok, false);
    assert.match(pause.error, /无法撤销线路规则/);
    const actual = await send(harness.listener(), { type: "get-state", tabId: 75 });
    assert.equal(actual.settings.enabled, false);
    assert.equal(actual.state.phase, "error");
    assert.equal(actual.state.ruleInstalled, true);
  } finally { delete globalThis.chrome; }
});

test("首次媒体地址执行完整测速并缓存当前标签页规则", async () => {
  const harness = installChrome();
  try {
    await import(`../src/worker.js?test=full-${Date.now()}`);
    const response = await send(harness.listener(), {
      type: "media-discovered",
      pageUrl: "https://www.bilibili.com/video/BV1",
      urls: ["https://origin.bilivideo.com/upgcxcode/a/video.m4s?token=1"],
    }, { tab: { id: 42 } });
    assert.equal(response.ok, true);
    assert.equal(harness.probeMessages.length, 2);
    assert.equal(harness.probeMessages[0].byteLimit, 128 * 1024);
    assert.equal(harness.probeMessages[1].byteLimit, 1024 * 1024);
    assert.equal(harness.probeMessages[1].waitForBufferSeconds, 10);
    const state = await send(harness.listener(), { type: "get-state", tabId: 42 });
    assert.equal(state.state.results[0].stage, "sustained");
    assert.equal(state.state.ruleInstalled, true);
    assert.equal(state.state.selectedHost, "upos-sz-mirrorcosov.bilivideo.com");
    assert.equal(harness.storage[CACHE_KEY].winnerHost, "upos-sz-mirrorcosov.bilivideo.com");
    assert.ok(harness.storage[CACHE_KEY].lastFullTestedAt > 0);
    const applied = harness.ruleUpdates.find((update) => update.addRules?.length);
    assert.deepEqual(applied.addRules[0].condition.tabIds, [42]);
  } finally {
    delete globalThis.chrome;
  }
});

test("完整测速未结束时切回原始 CDN，迟到结果不能重新安装规则", async () => {
  let finishProbe;
  const harness = installChrome({ probeStage: () => new Promise((resolve) => { finishProbe = resolve; }) });
  try {
    await import(`../src/worker.js?test=cancel-full-${Date.now()}`);
    const discovery = send(harness.listener(), {
      type: "media-discovered", pageUrl: "https://www.bilibili.com/video/BV6",
      urls: ["https://origin.bilivideo.com/upgcxcode/f/video.m4s"],
    }, { tab: { id: 16 } });
    while (!finishProbe) await new Promise((resolve) => setTimeout(resolve, 0));
    const switched = await send(harness.listener(), {
      type: "set-settings", tabId: 16,
      settings: { enabled: true, mode: "original", disabledHosts: [] },
    });
    assert.equal(switched.state.phase, "original");
    finishProbe({ ok: true, results: harness.probeMessages[0].hosts.map((host) => ({
      host, ok: true, status: 206, bytes: 1024, elapsedMs: 1,
    })) });
    await discovery;
    const final = await send(harness.listener(), { type: "get-state", tabId: 16 });
    assert.equal(final.state.phase, "original");
    assert.equal(final.state.ruleInstalled, false);
    assert.equal(harness.ruleUpdates.some((item) => item.addRules?.length), false);
    assert.ok(harness.tabMessages.some(({ message }) => message.type === "cancel-probes"));
  } finally { delete globalThis.chrome; }
});

test("轻量复核缺少安全缓冲时不把节点误记为失败", async () => {
  const now = Date.now();
  const storage = { [CACHE_KEY]: {
    winnerHost: "upos-sz-mirrorcosov.bilivideo.com", lastFullTestedAt: now, lastVerifiedAt: now,
    results: ["upos-sz-mirrorcosov.bilivideo.com", "upos-sz-mirroraliov.bilivideo.com"].map((host) => ({
      host, ok: true, status: 206, bytes: 1024, elapsedMs: 10, sampledAt: now,
    })),
  } };
  const harness = installChrome({ storage, probeStage: async () => ({ ok: false, skipped: true, results: [] }) });
  try {
    await import(`../src/worker.js?test=unsafe-buffer-${Date.now()}`);
    await send(harness.listener(), {
      type: "media-discovered", pageUrl: "https://www.bilibili.com/video/BV7",
      urls: ["https://origin.bilivideo.com/upgcxcode/g/video.m4s"],
    }, { tab: { id: 17 } });
    await send(harness.listener(), { type: "media-heartbeat",
      activity: { visible: true, paused: false, ended: false, seeking: false, bufferedAhead: 13 },
    }, { tab: { id: 17 } });
    const final = await send(harness.listener(), { type: "get-state", tabId: 17 });
    assert.equal(final.state.phase, "active");
    assert.equal(final.state.results.every((item) => item.ok), true);
    assert.equal(harness.probeMessages.length, 1);
  } finally { delete globalThis.chrome; }
});

test("原始与固定模式中的卡顿不会自动启动测速或轮换", async () => {
  const storage = { biliCdnAutoSettingsV2: { enabled: true, mode: "original", disabledHosts: [] } };
  const harness = installChrome({ storage });
  try {
    await import(`../src/worker.js?test=manual-stall-${Date.now()}`);
    await send(harness.listener(), {
      type: "media-discovered", pageUrl: "https://www.bilibili.com/video/BV8",
      urls: ["https://origin.bilivideo.com/upgcxcode/h/video.m4s"],
    }, { tab: { id: 18 } });
    await send(harness.listener(), { type: "playback-stall" }, { tab: { id: 18 } });
    assert.equal(harness.probeMessages.length, 0);
    await send(harness.listener(), { type: "set-settings", tabId: 18, settings: {
      enabled: true, mode: "manual", manualHost: "upos-sz-mirrorcosov.bilivideo.com", disabledHosts: [],
    } });
    await send(harness.listener(), { type: "playback-stall" }, { tab: { id: 18 } });
    const final = await send(harness.listener(), { type: "get-state", tabId: 18 });
    assert.equal(final.state.phase, "manual");
    assert.equal(harness.probeMessages.length, 0);
  } finally { delete globalThis.chrome; }
});

test("排除当前节点立即撤销规则并选择其他可用节点", async () => {
  const harness = installChrome();
  try {
    await import(`../src/worker.js?test=exclude-active-${Date.now()}`);
    await send(harness.listener(), {
      type: "media-discovered", pageUrl: "https://www.bilibili.com/video/BV9",
      urls: ["https://origin.bilivideo.com/upgcxcode/i/video.m4s"],
    }, { tab: { id: 19 } });
    const result = await send(harness.listener(), { type: "set-settings", tabId: 19, settings: {
      enabled: true, mode: "auto", disabledHosts: ["upos-sz-mirrorcosov.bilivideo.com"],
    } });
    assert.notEqual(result.state.selectedHost, "upos-sz-mirrorcosov.bilivideo.com");
  } finally { delete globalThis.chrome; }
});

test("轻量复核被用户取消后不会用迟到结果恢复自动规则", async () => {
  const now = Date.now();
  const storage = { [CACHE_KEY]: {
    winnerHost: "upos-sz-mirrorcosov.bilivideo.com", lastFullTestedAt: now, lastVerifiedAt: now,
    results: ["upos-sz-mirrorcosov.bilivideo.com", "upos-sz-mirroraliov.bilivideo.com"].map((host) => ({
      host, ok: true, status: 206, bytes: 1024, elapsedMs: 10, sampledAt: now,
    })),
  } };
  let finishProbe;
  const harness = installChrome({ storage, probeStage: () => new Promise((resolve) => { finishProbe = resolve; }) });
  try {
    await import(`../src/worker.js?test=cancel-verify-${Date.now()}`);
    await send(harness.listener(), { type: "media-discovered",
      pageUrl: "https://www.bilibili.com/video/BV10", urls: ["https://origin.bilivideo.com/upgcxcode/j/a.m4s"],
    }, { tab: { id: 20 } });
    const heartbeat = send(harness.listener(), { type: "media-heartbeat",
      activity: { visible: true, paused: false, ended: false, seeking: false, bufferedAhead: 13 },
    }, { tab: { id: 20 } });
    while (!finishProbe) await new Promise((resolve) => setTimeout(resolve, 0));
    const ruleCount = harness.ruleUpdates.filter((item) => item.addRules?.length).length;
    await send(harness.listener(), { type: "set-settings", tabId: 20,
      settings: { enabled: true, mode: "original", disabledHosts: [] },
    });
    finishProbe({ ok: true, results: harness.probeMessages[0].hosts.map((host) => ({
      host, ok: true, status: 206, bytes: 1024, elapsedMs: host.includes("ali") ? 1 : 20,
    })) });
    await heartbeat;
    const final = await send(harness.listener(), { type: "get-state", tabId: 20 });
    assert.equal(final.state.phase, "original");
    assert.equal(final.state.ruleInstalled, false);
    assert.equal(harness.ruleUpdates.filter((item) => item.addRules?.length).length, ruleCount);
  } finally { delete globalThis.chrome; }
});

test("总开关关闭时立即移除所有已知播放标签页的规则", async () => {
  const harness = installChrome();
  try {
    await import(`../src/worker.js?test=pause-all-${Date.now()}`);
    for (const id of [21, 22]) await send(harness.listener(), { type: "media-discovered",
      pageUrl: "https://www.bilibili.com/video/BV" + id,
      urls: ["https://origin.bilivideo.com/upgcxcode/" + id + "/a.m4s"],
    }, { tab: { id } });
    await send(harness.listener(), { type: "set-settings", tabId: 21,
      settings: { enabled: false, mode: "auto", disabledHosts: [] },
    });
    for (const tabId of [21, 22]) {
      const final = await send(harness.listener(), { type: "get-state", tabId });
      assert.equal(final.state.ruleInstalled, false);
      assert.equal(final.state.selectedHost, "");
    }
  } finally { delete globalThis.chrome; }
});

test("新视频立即应用缓存赢家并在安全缓冲后只轻量复核两个节点", async () => {
  const now = Date.now();
  const storage = {
    [CACHE_KEY]: {
      winnerHost: "upos-sz-mirrorcosov.bilivideo.com",
      lastFullTestedAt: now - 60_000,
      lastVerifiedAt: now - 60_000,
      results: [
        {
          host: "upos-sz-mirrorcosov.bilivideo.com", ok: true, status: 206,
          bytes: 1024 * 1024, elapsedMs: 100, ttfbMs: 5, stage: "sustained", sampledAt: now - 60_000,
        },
        {
          host: "upos-sz-mirroraliov.bilivideo.com", ok: true, status: 206,
          bytes: 1024 * 1024, elapsedMs: 180, ttfbMs: 8, stage: "sustained", sampledAt: now - 60_000,
        },
      ],
    },
  };
  const harness = installChrome({ storage });
  try {
    await import(`../src/worker.js?test=cache-${Date.now()}`);
    await send(harness.listener(), {
      type: "media-discovered",
      pageUrl: "https://www.bilibili.com/video/BV2",
      urls: ["https://origin.bilivideo.com/upgcxcode/b/video.m4s?token=2"],
    }, { tab: { id: 7 } });
    assert.equal(harness.probeMessages.length, 0, "缓存赢家应先应用，不阻塞开播");
    let state = await send(harness.listener(), { type: "get-state", tabId: 7 });
    assert.equal(state.state.selectedHost, "upos-sz-mirrorcosov.bilivideo.com");

    await send(harness.listener(), {
      type: "media-heartbeat",
      activity: { visible: true, paused: false, ended: false, seeking: false, bufferedAhead: 12.5 },
    }, { tab: { id: 7 } });
    assert.equal(harness.probeMessages.length, 1);
    assert.equal(harness.probeMessages[0].hosts.length, 2);
    assert.equal(harness.probeMessages[0].byteLimit, 256 * 1024);
    assert.equal(harness.probeMessages[0].waitForBufferSeconds, 12);
    state = await send(harness.listener(), { type: "get-state", tabId: 7 });
    assert.equal(state.state.phase, "active");
    assert.ok(state.state.lastVerifiedAt >= now);

    await send(harness.listener(), {
      type: "media-heartbeat",
      activity: { visible: true, paused: false, ended: false, seeking: false, bufferedAhead: 20 },
    }, { tab: { id: 7 } });
    assert.equal(harness.probeMessages.length, 1, "同一视频不应重复轻量复核");
  } finally {
    delete globalThis.chrome;
  }
});

test("确认卡顿后直接轮换已验证备用节点而不等待完整重测", async () => {
  const now = Date.now();
  const storage = {
    [CACHE_KEY]: {
      winnerHost: "upos-sz-mirrorcosov.bilivideo.com",
      lastFullTestedAt: now,
      lastVerifiedAt: now,
      results: [
        {
          host: "upos-sz-mirrorcosov.bilivideo.com", ok: true, status: 206,
          bytes: 1024, elapsedMs: 10, ttfbMs: 2, stage: "sustained", sampledAt: now,
        },
        {
          host: "upos-sz-mirroraliov.bilivideo.com", ok: true, status: 206,
          bytes: 1024, elapsedMs: 20, ttfbMs: 3, stage: "sustained", sampledAt: now,
        },
      ],
    },
  };
  const harness = installChrome({ storage });
  try {
    await import(`../src/worker.js?test=stall-${Date.now()}`);
    await send(harness.listener(), {
      type: "media-discovered",
      pageUrl: "https://www.bilibili.com/video/BV3",
      urls: ["https://origin.bilivideo.com/upgcxcode/c/video.m4s?token=3"],
    }, { tab: { id: 9 } });
    await send(harness.listener(), {
      type: "playback-stall",
      reason: "waiting",
    }, { tab: { id: 9 } });
    const state = await send(harness.listener(), { type: "get-state", tabId: 9 });
    assert.equal(state.state.selectedHost, "upos-sz-mirroraliov.bilivideo.com");
    assert.equal(harness.probeMessages.length, 0);
    assert.equal(harness.tabMessages.some(({ message }) => message.reason === "stall-recovery"), true);
  } finally {
    delete globalThis.chrome;
  }
});

test("从手动模式切回自动模式时没有测速结果就立即测速", async () => {
  const settingsKey = "biliCdnAutoSettingsV2";
  const storage = {
    [settingsKey]: {
      enabled: true,
      mode: "manual",
      manualHost: "upos-sz-mirroraliov.bilivideo.com",
      disabledHosts: [],
    },
  };
  const harness = installChrome({ storage });
  try {
    await import(`../src/worker.js?test=manual-auto-${Date.now()}`);
    await send(harness.listener(), {
      type: "media-discovered",
      pageUrl: "https://www.bilibili.com/video/BV4",
      urls: ["https://origin.bilivideo.com/upgcxcode/d/video.m4s?token=4"],
    }, { tab: { id: 11 } });
    assert.equal(harness.probeMessages.length, 0);

    await send(harness.listener(), {
      type: "set-settings",
      tabId: 11,
      settings: { enabled: true, mode: "auto", manualHost: "", disabledHosts: [] },
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(harness.probeMessages.length, 2);
    const state = await send(harness.listener(), { type: "get-state", tabId: 11 });
    assert.equal(state.state.phase, "active");
    assert.equal(state.state.results.length > 0, true);
  } finally {
    delete globalThis.chrome;
  }
});

test("全部节点失败后十分钟内不在每次心跳重复完整测速", async () => {
  const harness = installChrome({
    probeResult: (host, message) => ({
      host,
      ok: false,
      status: 0,
      bytes: 0,
      elapsedMs: 25,
      ttfbMs: 0,
      error: `unreachable-${message.byteLimit}`,
    }),
  });
  try {
    await import(`../src/worker.js?test=failure-backoff-${Date.now()}`);
    await send(harness.listener(), {
      type: "media-discovered",
      pageUrl: "https://www.bilibili.com/video/BV5",
      urls: ["https://origin.bilivideo.com/upgcxcode/e/video.m4s?token=5"],
    }, { tab: { id: 13 } });
    assert.equal(harness.probeMessages.length, 1);

    await send(harness.listener(), {
      type: "media-heartbeat",
      activity: { visible: true, paused: false, ended: false, seeking: false, bufferedAhead: 20 },
    }, { tab: { id: 13 } });
    assert.equal(harness.probeMessages.length, 1);
    const state = await send(harness.listener(), { type: "get-state", tabId: 13 });
    assert.equal(state.state.phase, "error");
    assert.match(state.state.lastError, /10 分钟/);
  } finally {
    delete globalThis.chrome;
  }
});
