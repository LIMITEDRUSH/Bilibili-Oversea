import assert from "node:assert/strict";
import test from "node:test";

const CACHE_KEY = "biliCdnAutoBenchmarkV3";

function installChrome({ storage = {}, probeResult } = {}) {
  let messageListener;
  const ruleUpdates = [];
  const probeMessages = [];
  const tabMessages = [];
  const noopEvent = { addListener() {} };
  globalThis.chrome = {
    action: {
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {},
    },
    declarativeNetRequest: {
      updateSessionRules: async (update) => { ruleUpdates.push(update); },
    },
    runtime: {
      onMessage: { addListener(listener) { messageListener = listener; } },
      onInstalled: noopEvent,
      sendMessage: async () => {},
    },
    storage: {
      local: {
        async get(key) { return { [key]: storage[key] }; },
        async set(value) { Object.assign(storage, value); },
      },
    },
    tabs: {
      onRemoved: noopEvent,
      onUpdated: noopEvent,
      sendMessage: async (tabId, message) => {
        tabMessages.push({ tabId, message });
        if (message.type !== "probe-candidates") return undefined;
        probeMessages.push(message);
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
    listener: () => messageListener,
  };
}

function send(listener, message, sender = {}) {
  return new Promise((resolve) => {
    const keepAlive = listener(message, sender, resolve);
    assert.equal(keepAlive, true);
  });
}

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
