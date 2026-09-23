"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("iOS 自动化助手只连接系统 VPN，不会跳离哔哩哔哩", async () => {
  const { createConnectVpnShortcut } = await import("../tools/shortcut-definition.mjs");
  const workflow = createConnectVpnShortcut();
  assert.deepEqual(workflow.WFWorkflowActions, [
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.vpn.set",
      WFWorkflowActionParameters: { WFVPNOperation: "Connect" },
    },
  ]);
});

test("仓库包含已签名、可分发的快捷指令", async () => {
  const { shortcutFileName } = await import("../tools/shortcut-definition.mjs");
  const shortcutPath = path.join(root, "ios", "shortcuts", shortcutFileName);
  assert.ok(fs.statSync(shortcutPath).size > 1_000);
});
