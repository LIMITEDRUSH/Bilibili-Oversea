import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

test("使用独立 2.0 MV3 后台", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "2.0.2");
  assert.equal(manifest.name, "Bilibili-oversea");
  assert.equal(manifest.background.service_worker, "src/worker.js");
});

test("不申请代理、Cookie、历史、webRequest 或全站权限", () => {
  for (const permission of ["proxy", "cookies", "history", "webRequest", "webRequestBlocking"]) {
    assert.equal(manifest.permissions.includes(permission), false);
  }
  assert.equal(manifest.host_permissions.includes("<all_urls>"), false);
  assert.deepEqual(manifest.host_permissions, [
    "https://www.bilibili.com/*", "https://m.bilibili.com/*", "https://*.bilivideo.com/*",
    "https://*.mcdn.bilivideo.cn/*",
  ]);
});

test("页面桥接和隔离脚本分开运行", () => {
  assert.equal(manifest.content_scripts[0].world, "MAIN");
  assert.deepEqual(manifest.content_scripts[0].js, ["src/page-bridge.js"]);
  assert.deepEqual(manifest.content_scripts[1].js, ["src/content.js"]);
});

test("清单引用的图标和界面文件存在", () => {
  const files = [manifest.action.default_popup, manifest.background.service_worker, ...Object.values(manifest.icons)];
  for (const file of files) assert.equal(fs.existsSync(path.join(root, file)), true, file);
});

test("新版图标提供清单要求的全部 PNG 尺寸", () => {
  for (const [declaredSize, file] of Object.entries(manifest.icons)) {
    const bytes = fs.readFileSync(path.join(root, file));
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], file);
    assert.equal(bytes.readUInt32BE(16), Number(declaredSize), `${file} width`);
    assert.equal(bytes.readUInt32BE(20), Number(declaredSize), `${file} height`);
  }
  assert.equal(fs.existsSync(path.join(root, "assets/brand/icon-master.png")), true);
});
