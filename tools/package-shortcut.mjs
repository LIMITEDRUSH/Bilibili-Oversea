import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createConnectVpnShortcut, shortcutFileName } from "./shortcut-definition.mjs";

if (process.platform !== "darwin") {
  throw new Error("Apple 快捷指令签名只能在安装了 Shortcuts 的 macOS 上运行");
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "ios", "shortcuts");
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bili-cdn-auto-shortcut-"));
const jsonPath = path.join(tempDir, "ConnectVPN.json");
const unsignedPath = path.join(tempDir, "ConnectVPN-unsigned.shortcut");
const outputPath = path.join(outputDir, shortcutFileName);

try {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(jsonPath, `${JSON.stringify(createConnectVpnShortcut(), null, 2)}\n`);
  execFileSync("plutil", ["-convert", "binary1", "-o", unsignedPath, jsonPath], {
    stdio: "inherit",
  });
  execFileSync(
    "shortcuts",
    ["sign", "--mode", "anyone", "--input", unsignedPath, "--output", outputPath],
    { stdio: "inherit" },
  );
  console.log(`Signed ${path.relative(root, outputPath)}`);
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
