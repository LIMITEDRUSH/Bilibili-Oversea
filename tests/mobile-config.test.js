"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const templates = [
  "BiliCDNAuto.surge.sgmodule",
  "BiliCDNAuto.shadowrocket.module",
  "BiliCDNAuto.loon.plugin",
  "BiliCDNAuto.stash.stoverride",
  "BiliCDNAuto.quantumultx.snippet",
];

test("all mobile clients load the shared adaptive request and response scripts", () => {
  for (const name of templates) {
    const source = fs.readFileSync(path.join(root, "ios", "templates", name), "utf8");
    assert.match(source, /scripts\/request\.js/);
    assert.match(source, /scripts\/response\.js/);
    assert.match(source, /upgcxcode/);
  }
});

test("configurable clients use non-blocking adaptive defaults", () => {
  for (const name of templates.slice(0, 4)) {
    const source = fs.readFileSync(path.join(root, "ios", "templates", name), "utf8");
    assert.match(source, /success_ttl[^\r\n]*10800/);
    assert.match(source, /failure_ttl[^\r\n]*600/);
    assert.match(source, /verify_interval[^\r\n]*900/);
    assert.match(source, /verify_delay[^\r\n]*15/);
    assert.match(source, /quick_probe_bytes[^\r\n]*131072/);
    assert.match(source, /verify_probe_bytes[^\r\n]*131072/);
    assert.doesNotMatch(source, /health_ttl|cache_ttl=3600|probe_bytes=65536/);
  }
});

test("clients with network event support invalidate the cache on a real network change", () => {
  for (const name of [
    "BiliCDNAuto.surge.sgmodule",
    "BiliCDNAuto.shadowrocket.module",
    "BiliCDNAuto.loon.plugin",
    "BiliCDNAuto.quantumultx.snippet",
  ]) {
    const source = fs.readFileSync(path.join(root, "ios", "templates", name), "utf8");
    assert.match(source, /network-changed\.js/);
  }
});

test("generated mobile configs contain deployable public script URLs", () => {
  for (const name of templates) {
    const source = fs.readFileSync(path.join(root, "dist", name), "utf8");
    assert.doesNotMatch(source, /__BASE_URL__/);
    assert.match(
      source,
      /https:\/\/raw\.githubusercontent\.com\/LIMITEDRUSH\/Bilibili-Oversea\/main\/scripts\/request\.js/,
    );
    assert.match(
      source,
      /https:\/\/raw\.githubusercontent\.com\/LIMITEDRUSH\/Bilibili-Oversea\/main\/scripts\/response\.js/,
    );
  }
});
