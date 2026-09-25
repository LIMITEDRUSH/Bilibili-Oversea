import assert from "node:assert/strict";
import test from "node:test";

test("后台收到媒体地址后测速并建立当前标签页规则", async () => {
  let messageListener;
  const ruleUpdates = [];
  const probeMessages = [];
  const storage = {};
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
      sendMessage: async (_tabId, message) => {
        if (message.type !== "probe-candidates") return undefined;
        probeMessages.push(message);
        return {
          ok: true,
          results: message.hosts.map((host) => ({
            host,
            ok: true,
            status: 206,
            bytes: 2_048,
            elapsedMs: host.includes("cosov") ? 1 : host.includes("hwov") ? 4 : 8,
            ttfbMs: 1,
          })),
        };
      },
    },
  };

  try {
    await import(`../src/worker.js?test=${Date.now()}`);
    const response = await new Promise((resolve) => {
      const keepAlive = messageListener({
        type: "media-discovered",
        urls: ["https://origin.bilivideo.com/upgcxcode/a/video.m4s?token=1"],
      }, { tab: { id: 42 } }, resolve);
      assert.equal(keepAlive, true);
    });
    assert.equal(response.ok, true);
    assert.equal(probeMessages.length, 2);
    assert.equal(probeMessages[0].sourceUrl, "https://origin.bilivideo.com/upgcxcode/a/video.m4s?token=1");
    assert.equal(probeMessages[0].byteLimit, 128 * 1024);
    assert.equal(probeMessages[1].byteLimit, 1024 * 1024);
    assert.equal(probeMessages[1].waitForBufferSeconds, 10);
    const state = await new Promise((resolve) => {
      messageListener({ type: "get-state", tabId: 42 }, {}, resolve);
    });
    assert.equal(state.state.results[0].error, "");
    assert.equal(state.state.results[0].stage, "sustained");
    assert.equal(state.state.ruleInstalled, true);
    const applied = ruleUpdates.find((update) => update.addRules?.length);
    assert.ok(applied);
    assert.deepEqual(applied.addRules[0].condition.tabIds, [42]);
    assert.equal(applied.addRules[0].action.redirect.transform.host, "upos-sz-mirrorcosov.bilivideo.com");
  } finally {
    delete globalThis.chrome;
  }
});
