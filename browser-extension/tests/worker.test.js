import assert from "node:assert/strict";
import test from "node:test";

const CACHE_KEY = "biliCdnAutoBenchmarkV5";

function cachedFixture() {
  const now=Date.now();
  return { [CACHE_KEY]:{winnerHost:"upos-sz-mirrorcosov.bilivideo.com",lastFullTestedAt:now,lastVerifiedAt:now,
    results:["upos-sz-mirrorcosov.bilivideo.com","upos-sz-mirroraliov.bilivideo.com"].map((host,i)=>({host,ok:true,status:206,bytes:1048576,elapsedMs:100+i*100,ttfbMs:5,stage:"sustained",sampledAt:now}))} };
}

test("完整 DASH 描述中的备用主机不因前八条 URL 截断而丢失候选", async () => {
  const harness = installChrome();
  try {
    await import(`../src/worker.js?descriptor-hosts=${Date.now()}`);
    const sender = { tab: { id: 88 } }, pageUrl = "https://www.bilibili.com/video/BVHD";
    const actual = "https://upos-sz-mirrorcosov.bilivideo.com/upgcxcode/hd/current.m4s";
    const backup = "https://late-backup.bilivideo.com/upgcxcode/hd/other-quality.m4s";
    await send(harness.listener(), { type: "media-discovered", pageUrl, urls: [actual],
      tracks: [{ url: actual, kind: "video" }, { url: backup, kind: "video" },
        { url: "https://unrelated.example/upgcxcode/hd/v.m4s", kind: "video" }] }, sender);
    assert.equal(harness.probeMessages.length, 0);
    await send(harness.listener(), { type: "media-discovered", pageUrl, urls: [actual],
      tracks: [{ url: actual, kind: "video" }], observed: true, source: "page-response" }, sender);
    assert.ok(harness.probeMessages[0].hosts.includes("late-backup.bilivideo.com"));
    assert.equal(harness.probeMessages[0].sourceUrl, actual);
    assert.ok(harness.probeMessages[0].hosts.length <= 8);
    assert.ok(!harness.probeMessages[0].hosts.includes("unrelated.example"));
  } finally { delete globalThis.chrome; }
});

test("实际视频请求在下载完成前更新最高画质测速源，但不冒充已确认响应", async () => {
  const harness = installChrome();
  try {
    await import(`../src/worker.js?requested-source=${Date.now()}`);
    const sender = { tab: { id: 89 } }, pageUrl = "https://www.bilibili.com/video/BVHD";
    const low = "https://origin.bilivideo.com/upgcxcode/hd/low.m4s";
    const high = "https://origin.bilivideo.com/upgcxcode/hd/high.m4s";
    await send(harness.listener(), { type: "media-discovered", pageUrl, urls: [low], tracks: [{ url: low, kind: "video" }, { url: high, kind: "video" }] }, sender);
    assert.equal(harness.probeMessages.length, 0);
    await send(harness.listener(), { type: "media-discovered", requested: true, source: "page-request", pageUrl,
      urls: [high], tracks: [{ url: high, kind: "video" }], originals: [{ url: high, originalUrl: high, startByte: 123000 }] }, sender);
    assert.equal(harness.probeMessages[0].sourceUrl, high);
    assert.equal(harness.probeMessages[0].startByte, 123000);
    const state = (await send(harness.listener(), { type: "get-state", tabId: 89 })).state;
    assert.equal(state.actualHost, "");
  } finally { delete globalThis.chrome; }
});

test("请求阶段识别最高画质 Akamai 就立即直通，不等待超时后的 load", async () => {
  const harness = installChrome({ storage: cachedFixture() });
  try {
    await import(`../src/worker.js?requested-akamai=${Date.now()}`);
    const sender = { tab: { id: 90 } }, pageUrl = "https://www.bilibili.com/video/BVHD";
    const low = "https://upos-sz-mirrorcosov.bilivideo.com/upgcxcode/hd/low.m4s";
    const high = "https://upos-hz-mirrorakam.akamaized.net/upgcxcode/hd/high.m4s";
    await send(harness.listener(), { type: "media-discovered", pageUrl, urls: [low], tracks: [{ url: low, kind: "video" }, { url: high, kind: "video" }] }, sender);
    await send(harness.listener(), { type: "media-discovered", requested: true, source: "page-request", pageUrl,
      urls: [high], tracks: [{ url: high, kind: "video" }], originals: [{ url: high, originalUrl: high, startByte: 0 }] }, sender);
    const state = (await send(harness.listener(), { type: "get-state", tabId: 90 })).state;
    assert.equal(state.passthroughReason, "baseline-akamai");
    assert.equal(state.selectedHost, ""); assert.equal(state.actualHost, "");
    assert.equal(harness.probeMessages.length, 0);
  } finally { delete globalThis.chrome; }
});

test("无缓存时不拿 SSR 的其他画质替代实际最高画质测速",async()=>{
  const harness=installChrome();
  try{
    await import(`../src/worker.js?actual-source=${Date.now()}`);
    const pageUrl="https://www.bilibili.com/video/BVHD",sender={tab:{id:83}};
    const advertised="https://origin.bilivideo.com/upgcxcode/hd/advertised.m4s";
    const actual="https://origin.bilivideo.com/upgcxcode/hd/actual-high.m4s";
    await send(harness.listener(),{type:"media-discovered",pageUrl,urls:[advertised],tracks:[{url:advertised,kind:"video"}]},sender);
    assert.equal(harness.probeMessages.length,0);
    await send(harness.listener(),{type:"media-discovered",pageUrl,urls:[actual],tracks:[{url:actual,kind:"video"}],observed:true,source:"page-response"},sender);
    assert.equal(harness.probeMessages[0].sourceUrl,actual);
  }finally{delete globalThis.chrome;}
});

test("音频完成不覆盖视频测速源，也不冒充当前视频线路",async()=>{
  const harness=installChrome({storage:cachedFixture()});
  try {
    await import(`../src/worker.js?tracks=${Date.now()}`);
    const video="https://upos-sz-mirrorcosov.bilivideo.com/upgcxcode/hd/video.m4s";
    const audio="https://audio.bilivideo.com/upgcxcode/hd/audio.m4s";
    const pageUrl="https://www.bilibili.com/video/BVHD",sender={tab:{id:81}};
    await send(harness.listener(),{type:"media-discovered",pageUrl,urls:[video,audio],tracks:[{url:video,kind:"video"},{url:audio,kind:"audio"}]},sender);
    await send(harness.listener(),{type:"media-discovered",pageUrl,urls:[audio],tracks:[{url:audio,kind:"audio"}],observed:true,source:"page-response"},sender);
    await send(harness.listener(),{type:"media-heartbeat",activity:{visible:true,paused:false,ended:false,seeking:false,bufferedAhead:20}},sender);
    assert.equal(harness.probeMessages[0].sourceUrl,video);
    const state=(await send(harness.listener(),{type:"get-state",tabId:81})).state;
    assert.equal(state.sourceKind,"video");assert.equal(state.actualHost,"");
  }finally{delete globalThis.chrome;}
});

test("最高画质切换重新轻量复核；实际响应 host 优先于原始性能地址",async()=>{
  const harness=installChrome({storage:cachedFixture()});
  try{
    await import(`../src/worker.js?quality=${Date.now()}`);
    const sender={tab:{id:82}},pageUrl="https://www.bilibili.com/video/BVHD";
    const report=async(url,source="page-response")=>send(harness.listener(),{type:"media-discovered",pageUrl,urls:[url],tracks:[{url,kind:"video"}],observed:true,source},sender);
    const heartbeat=()=>send(harness.listener(),{type:"media-heartbeat",activity:{visible:true,paused:false,ended:false,seeking:false,bufferedAhead:20}},sender);
    await report("https://upos-sz-mirrorcosov.bilivideo.com/upgcxcode/hd/low.m4s");await heartbeat();
    const high="https://upos-sz-mirrorcosov.bilivideo.com/upgcxcode/hd/high.m4s";
    await report(high);await heartbeat();
    assert.equal(harness.probeMessages.length,2);
    assert.equal(harness.probeMessages[1].sourceUrl,high);
    assert.equal(harness.probeMessages[1].byteLimit,262144);
    await report("https://upos-hz-mirrorakam.akamaized.net/upgcxcode/hd/high.m4s");
    await report("https://origin.bilivideo.com/upgcxcode/hd/high.m4s","performance");
    const state=(await send(harness.listener(),{type:"get-state",tabId:82})).state;
    assert.equal(state.actualHost,"upos-hz-mirrorakam.akamaized.net");
    assert.equal(state.actualHostSource,"page-response");
  }finally{delete globalThis.chrome;}
});

test("新实际 CDN 在安全缓冲后纳入候选，测速使用视频当前片段偏移",async()=>{
  const harness=installChrome({storage:cachedFixture()});
  try{
    await import(`../src/worker.js?segment=${Date.now()}`);
    const sender={tab:{id:84}},pageUrl="https://www.bilibili.com/video/BVHD";
    const cos="https://upos-sz-mirrorcosov.bilivideo.com/upgcxcode/hd/high.m4s";
    const akam="https://new-origin.bilivideo.com/upgcxcode/hd/high.m4s";
    await send(harness.listener(),{type:"media-discovered",pageUrl,urls:[cos],tracks:[{url:cos,kind:"video"}],observed:true},sender);
    await send(harness.listener(),{type:"media-discovered",pageUrl,urls:[akam],tracks:[{url:akam,kind:"video"}],observed:true,source:"page-response",originals:[{url:akam,originalUrl:akam,startByte:8000000}]},sender);
    await send(harness.listener(),{type:"media-heartbeat",activity:{visible:true,paused:false,ended:false,seeking:false,bufferedAhead:7}},sender);
    assert.equal(harness.probeMessages.length,0);
    await send(harness.listener(),{type:"media-heartbeat",activity:{visible:true,paused:false,ended:false,seeking:false,bufferedAhead:20}},sender);
    assert.equal(harness.probeMessages[0].sourceUrl,akam);
    assert.equal(harness.probeMessages[0].startByte,8000000);
    assert.ok(harness.probeMessages[0].hosts.includes("new-origin.bilivideo.com"));
    assert.equal(harness.probeMessages[0].byteLimit,131072);
  }finally{delete globalThis.chrome;}
});

test("Akamai 视频沿用 2.2.0 直通，缓存、音频、固定、心跳与卡顿不能自动改道",async()=>{
  const harness=installChrome({storage:cachedFixture()});
  try {
    await import(`../src/worker.js?akam-passthrough=${Date.now()}`);
    const sender={tab:{id:85}},pageUrl="https://www.bilibili.com/video/BVHD";
    const video="https://upos-hz-mirrorakam.akamaized.net/upgcxcode/hd/video.m4s";
    const audio="https://audio.bilivideo.com/upgcxcode/hd/audio.m4s";
    await send(harness.listener(),{type:"media-discovered",pageUrl,urls:[video,audio],tracks:[{url:video,kind:"video"},{url:audio,kind:"audio"}]},sender);
    await send(harness.listener(),{type:"media-discovered",pageUrl,urls:[audio],observed:true,source:"page-response"},sender);
    await send(harness.listener(),{type:"media-discovered",pageUrl,urls:[video],observed:true,source:"page-response",originals:[{url:video,originalUrl:video,startByte:4000000}]},sender);
    await send(harness.listener(),{type:"media-heartbeat",activity:{visible:true,paused:false,ended:false,seeking:false,bufferedAhead:20}},sender);
    await send(harness.listener(),{type:"playback-stall",reason:"waiting"},sender);
    await send(harness.listener(),{type:"set-settings",tabId:85,settings:{enabled:true,mode:"manual",manualHost:"upos-sz-mirroraliov.bilivideo.com"}});
    const state=(await send(harness.listener(),{type:"get-state",tabId:85})).state;
    assert.equal(state.passthroughReason,"baseline-akamai");
    assert.equal(state.actualHost,"upos-hz-mirrorakam.akamaized.net");
    assert.equal(state.ruleInstalled,false);assert.equal(state.phase,"original");
    assert.equal(harness.probeMessages.length,0);
    assert.equal(harness.ruleUpdates.some(update=>update.addRules?.some(rule=>rule.action.type==="redirect")),false);
  } finally {delete globalThis.chrome;}
});

test("后台唤醒批次中的大量音频不能挤掉视频；无关原始地址不能改写来源",async()=>{
  const harness=installChrome({storage:cachedFixture()});
  try {
    await import(`../src/worker.js?audio-batch=${Date.now()}`);
    const sender={tab:{id:86}},pageUrl="https://www.bilibili.com/video/BVHD";
    const audio=Array.from({length:7},(_,i)=>`https://audio.bilivideo.com/upgcxcode/hd/audio-${i}.m4s`);
    const video="https://upos-sz-mirrorcosov.bilivideo.com/upgcxcode/hd/video.m4s";
    const unrelated="https://upos-hz-mirrorakam.akamaized.net/upgcxcode/hd/other.m4s";
    await send(harness.listener(),{type:"media-discovered",pageUrl,urls:[...audio,video],tracks:[...audio.map(url=>({url,kind:"audio"})),{url:video,kind:"video"},{url:unrelated,kind:"video"}],observed:true,source:"page-response",originals:[{url:unrelated,originalUrl:unrelated,startByte:1}]},sender);
    await send(harness.listener(),{type:"media-heartbeat",activity:{visible:true,paused:false,ended:false,seeking:false,bufferedAhead:20}},sender);
    assert.equal(harness.probeMessages[0].sourceUrl,video);
    const state=(await send(harness.listener(),{type:"get-state",tabId:86})).state;
    assert.equal(state.sourceKind,"video");assert.equal(state.actualHost,"upos-sz-mirrorcosov.bilivideo.com");
    assert.equal(state.passthroughReason,"");
  } finally {delete globalThis.chrome;}
});

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
