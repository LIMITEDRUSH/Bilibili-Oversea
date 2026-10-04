import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { ADAPTIVE_POLICY, DEFAULT_CANDIDATES, DEFAULT_SETTINGS, rankResults } from "../src/engine.js";

// Frozen from the released 2.2.0 archive, not regenerated from current code.
test("播放策略保持用户确认的 2.2.0 基线", () => {
  assert.deepEqual(ADAPTIVE_POLICY, {
    lightVerifyIntervalMs: 900000, successCacheMs: 10800000, failureCacheMs: 600000,
    safeBufferSeconds: 12, lightProbeBytes: 262144, lightProbeTimeoutMs: 5000, switchGainRatio: 1.2,
  });
  assert.deepEqual(DEFAULT_CANDIDATES, [
    "upos-sz-mirroraliov.bilivideo.com", "upos-sz-mirrorcosov.bilivideo.com", "upos-sz-mirrorhwov.bilivideo.com",
  ]);
  assert.deepEqual(DEFAULT_SETTINGS, { enabled: true, mode: "auto", manualHost: "", disabledHosts: [] });
});

function constant(file, name) {
  const source = fs.readFileSync(new URL(file, import.meta.url), "utf8");
  const expression = source.match(new RegExp(`const ${name} = ([0-9_* ]+);`))?.[1];
  assert.ok(expression, `Missing numeric policy constant ${name}`);
  return expression.split("*").reduce((product, item) => product * Number(item.replaceAll("_", "").trim()), 1);
}

test("缓冲健康监测及完整测速预算保持 2.2.0 基线", () => {
  const health = { DISCOVERY_INTERVAL_MS: 10000, HEALTH_SAMPLE_INTERVAL_MS: 2000,
    STALL_CONFIRM_MS: 2500, STALL_COOLDOWN_MS: 8000, STARTUP_GRACE_MS: 10000,
    SEEK_GRACE_MS: 4000, HEALTHY_BUFFER_SECONDS: 12, LOW_BUFFER_SECONDS: 8,
    MIN_BUFFER_DRAIN_SECONDS: 4, HEALTH_WINDOW_SAMPLES: 4 };
  for (const [name, value] of Object.entries(health)) assert.equal(constant("../src/content.js", name), value, name);
  const probe = { QUICK_PROBE_BYTES: 131072, QUICK_PROBE_TIMEOUT_MS: 4500,
    SUSTAINED_PROBE_BYTES: 1048576, SUSTAINED_PROBE_TIMEOUT_MS: 9000, SUSTAINED_FINALISTS: 3 };
  for (const [name, value] of Object.entries(probe)) assert.equal(constant("../src/worker.js", name), value, name);
});

test("2.2.0 排序仍按吞吐量、首包和原线路打破平局", () => {
  const a = { host: "a.bilivideo.com", ok: true, kbps: 1000, ttfbMs: 20 };
  const b = { host: "b.bilivideo.com", ok: true, kbps: 1000, ttfbMs: 20 };
  const c = { host: "c.bilivideo.com", ok: true, kbps: 1100, ttfbMs: 100 };
  assert.deepEqual(rankResults([a, b, c], b.host).map(r=>r.host), [c.host, b.host, a.host]);
});
