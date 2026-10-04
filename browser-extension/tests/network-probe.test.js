import assert from "node:assert/strict";
import test from "node:test";
import { fetchProbe, probeReferrerRule } from "../src/network-probe.js";

test("测速来源规则仅限本扩展的 CDN 请求，不修改页面请求或申请新权限", () => {
  const rule = probeReferrerRule("a".repeat(32));
  assert.equal(rule.action.type, "modifyHeaders");
  assert.deepEqual(rule.condition.initiatorDomains, ["a".repeat(32)]);
  assert.deepEqual(rule.condition.requestDomains, ["bilivideo.com"]);
  assert.deepEqual(rule.action.requestHeaders, [{ header: "referer", operation: "set", value: "https://www.bilibili.com/" }]);
  assert.throws(() => probeReferrerRule("bilibili.com"));
});

test("后台探测保留签名、限制流量且不发送 Cookie", async () => {
  const previous = globalThis.fetch;
  let request;
  let cancelled = false;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, status: 206, url, body: { getReader: () => ({ read: async () => ({ done: false, value: new Uint8Array(4096) }), cancel: async () => { cancelled = true; } }) } };
  };
  try {
    const result = await fetchProbe({ sourceUrl: "https://origin.bilivideo.com/upgcxcode/a/video.m4s?token=keep", host: "target.bilivideo.com", byteLimit: 1024 });
    assert.equal(result.bytes, 1024);
    assert.equal(result.responseHost, "target.bilivideo.com");
    assert.equal(request.url, "https://target.bilivideo.com/upgcxcode/a/video.m4s?token=keep");
    assert.equal(request.options.headers.Range, "bytes=0-1023");
    assert.equal(request.options.credentials, "omit");
    assert.equal(cancelled, true);
  } finally { globalThis.fetch = previous; }
});

test("不能把被重定向至其他 CDN 的结果标成目标节点成功", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 206, url: "https://other.bilivideo.com/upgcxcode/a/video.m4s", body: null });
  try {
    const result = await fetchProbe({ sourceUrl: "https://origin.bilivideo.com/upgcxcode/a/video.m4s", host: "target.bilivideo.com", byteLimit: 1024 });
    assert.equal(result.ok, false);
    assert.equal(result.bytes, 0);
    assert.equal(result.responseHost, "other.bilivideo.com");
  } finally { globalThis.fetch = previous; }
});
