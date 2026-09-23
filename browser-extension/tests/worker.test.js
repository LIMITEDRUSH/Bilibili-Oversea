import assert from "node:assert/strict";
import test from "node:test";

test("后台收到媒体地址后测速并建立当前标签页规则", async () => {
  let messageListener;
  const ruleUpdates = [];
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
      sendMessage: async () => {},
    },
  };

  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (value) => {
    const host = new URL(value).hostname;
    const delay = host.includes("cosov") ? 1 : host.includes("hwov") ? 4 : host.includes("aliov") ? 8 : 12;
    await new Promise((resolve) => setTimeout(resolve, delay));
    return new Response(new Uint8Array(2_048), { status: 206 });
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
    const applied = ruleUpdates.find((update) => update.addRules?.length);
    assert.ok(applied);
    assert.deepEqual(applied.addRules[0].condition.tabIds, [42]);
    assert.equal(applied.addRules[0].action.redirect.transform.host, "upos-sz-mirrorcosov.bilivideo.com");
  } finally {
    globalThis.fetch = nativeFetch;
    delete globalThis.chrome;
  }
});
