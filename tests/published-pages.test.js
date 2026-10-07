"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");

test("published pages link the frozen final release, independently of the development manifest", (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "bili-published-pages-"));
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync(output)), fs.realpathSync(os.tmpdir()));
    assert.match(path.basename(output), /^bili-published-pages-/);
    fs.rmSync(output, { recursive: true });
  });
  execFileSync(process.execPath, ["tools/build.mjs", "--base-url=https://example.org/source", `--out=${output}`], { cwd: root });
  const release = JSON.parse(fs.readFileSync(path.join(root, "site/browser-release.json"), "utf8"));
  const mapping = JSON.parse(fs.readFileSync(path.join(output, "install-links.json"), "utf8"));
  assert.equal(release.version, "2.5.1");
  assert.equal(release.fullAcceptancePassed, false);
  assert.equal(release.fileName, "bilibili-oversea-browser-v2.5.1-final.zip");
  assert.equal(release.bytes, 95651);
  assert.equal(release.sha256, "411f5f36c1f0e8173f464f169c54fa9fd89f7745d110919e29c18a3d88a0d5ad");
  assert.deepEqual(mapping.browserRelease, release);
  assert.equal(mapping.links.browser, `${release.downloadBaseUrl}/${release.fileName}`);
  assert.equal(mapping.links.browser_sha256, `${mapping.links.browser}.sha256`);
  for (const name of ["index.html", "browser-guide.html", "guide.html"]) {
    const html = fs.readFileSync(path.join(output, name), "utf8");
    assert.doesNotMatch(html, /__[A-Z_]+__|v2\.4\.0\.zip|开播前.*2 秒|轻微回退播放位置/);
    assert.match(html, /rel="canonical" href="https:\/\/limitedrush\.online\/projects\/bilibili-oversea/);
    for (const [, target] of html.matchAll(/<a\b[^>]*href="([^"]+)"/g)) {
      assert.equal(new URL(target).hostname, "limitedrush.online");
    }
    if (name !== "guide.html") assert.ok(html.includes(mapping.links.browser));
  }
  const guide = fs.readFileSync(path.join(output, "browser-guide.html"), "utf8");
  assert.equal((guide.match(/<li>/g) || []).length, 4);
  assert.match(guide, /不能保证所有视频不卡顿/);
  assert.match(guide, /08CT/);
  assert.match(guide, /2\.5\.1-final\.zip/);
  // Publication changes must not silently migrate legacy mobile configurations.
  assert.match(fs.readFileSync(path.join(output, "BiliCDNAuto.surge.sgmodule"), "utf8"), /https:\/\/example\.org\/source\/scripts\/request\.js/);
});
