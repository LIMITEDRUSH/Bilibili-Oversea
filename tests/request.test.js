"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  applyHost,
  chooseBest,
  isMediaUrl,
  networkKey,
  parseArgs,
  parseCandidates,
  rewrittenUrl,
  run,
} = require("../scripts/request.js");

test("parses module arguments and candidates", () => {
  assert.deepEqual(parseArgs("cache_ttl=60&fallback=original"), {
    cache_ttl: "60",
    fallback: "original",
  });
  assert.deepEqual(parseCandidates("a.bilivideo.com|evil.example.com|b.bilivideo.com|a.bilivideo.com"), [
    "a.bilivideo.com",
    "b.bilivideo.com",
  ]);
});

test("recognizes only supported media paths", () => {
  assert.equal(isMediaUrl("https://upos-sz-mirroraliov.bilivideo.com/upgcxcode/a.m4s?x=1"), true);
  assert.equal(isMediaUrl("https://a.mcdn.bilivideo.cn:4483/upgcxcode/a.m4s"), true);
  assert.equal(isMediaUrl("https://api.bilibili.com/x/player/playurl"), false);
});

test("rewrites hostname while preserving signed path and query", () => {
  const input = "https://old.bilivideo.com:4483/upgcxcode/a.m4s?deadline=1&token=x";
  const output = rewrittenUrl(input, "new.bilivideo.com");
  assert.equal(output, "https://new.bilivideo.com/upgcxcode/a.m4s?deadline=1&token=x");
  const changed = applyHost({ url: input, headers: { Host: "old.bilivideo.com", Range: "bytes=1-2" } }, "new.bilivideo.com");
  assert.equal(changed.headers.Host, "new.bilivideo.com");
  assert.equal(changed.headers.Range, "bytes=1-2");
});

test("chooses the fastest successful candidate", () => {
  const winner = chooseBest([
    { host: "slow.example.com", ok: true, elapsedMs: 300, bytes: 65536 },
    { host: "bad.example.com", ok: false, elapsedMs: 10, bytes: 0 },
    { host: "fast.example.com", ok: true, elapsedMs: 120, bytes: 65536 },
  ]);
  assert.equal(winner.host, "fast.example.com");
});

test("builds stable network keys", () => {
  assert.equal(networkKey({ wifi: { ssid: "Home" } }), "wifi:Home");
  assert.equal(
    networkKey({ "cellular-data": { carrier: "Carrier", radio: "5G" } }),
    "cellular:Carrier:5G",
  );
});

test("benchmarks once then reuses the cached winner", async () => {
  const memory = new Map();
  const store = {
    read: (key) => memory.get(key) || null,
    write: (value, key) => (memory.set(key, value), true),
  };
  let probes = 0;
  const client = {
    get(options, callback) {
      probes += 1;
      const finish = () => callback(null, { status: 206 }, new Uint8Array(4096));
      if (options.url.includes("fast.bilivideo.com")) finish();
      else setTimeout(finish, 20);
    },
  };
  const request = {
    url: "https://source.bilivideo.com/upgcxcode/a.m4s?token=1",
    headers: { Host: "source.bilivideo.com", "User-Agent": "test" },
  };
  const doneValues = [];
  const runtime = {
    request,
    argument: "candidates=slow.bilivideo.com|fast.bilivideo.com&probe_bytes=4096",
    network: { wifi: { ssid: "Home" } },
    store,
    client,
    done: (value) => doneValues.push(value),
    notify: () => {},
    log: () => {},
  };

  await run(runtime);
  await run(runtime);
  assert.equal(probes, 2);
  assert.match(doneValues[0].url, /^https:\/\/fast\.bilivideo\.com\//);
  assert.match(doneValues[1].url, /^https:\/\/fast\.bilivideo\.com\//);
});
