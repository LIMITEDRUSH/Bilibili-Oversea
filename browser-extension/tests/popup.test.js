import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "src/popup.html"), "utf8");

test("弹窗提供自动、重测、原始 CDN、自适应维护和教程入口", () => {
  for (const id of ["auto", "retest", "original", "results", "refresh", "actual", "applyState"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /browser-guide\.html/);
  assert.match(html, /自适应 · 15 分钟/);
  assert.doesNotMatch(html, /on(?:click|change)=/i);
});
