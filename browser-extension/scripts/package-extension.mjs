import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await fs.readFile(path.join(extensionRoot, "manifest.json"), "utf8"));
const outputDir = path.join(extensionRoot, "dist");
const stagingDir = path.join(outputDir, `.stage-${process.pid}`);
const archiveName = `bilibili-oversea-browser-v${manifest.version}.zip`;
const archivePath = path.join(outputDir, archiveName);

await fs.rm(stagingDir, { recursive: true, force: true });
await fs.mkdir(stagingDir, { recursive: true });
await fs.rm(archivePath, { force: true });

for (const file of ["manifest.json", "LICENSE", "README.md", "PRIVACY.md", "SECURITY.md", "ARCHITECTURE.md"]) {
  await fs.copyFile(path.join(extensionRoot, file), path.join(stagingDir, file));
}
await fs.cp(path.join(extensionRoot, "src"), path.join(stagingDir, "src"), { recursive: true });
await fs.cp(path.join(extensionRoot, "assets", "icons"), path.join(stagingDir, "assets", "icons"), { recursive: true });

const zipCommand = process.platform === "win32"
  ? ["tar", ["-a", "-c", "-f", archivePath, "."]]
  : ["zip", ["-X", "-q", "-r", archivePath, "."]];
const zipped = spawnSync(zipCommand[0], zipCommand[1], {
  cwd: stagingDir,
  encoding: "utf8",
});
await fs.rm(stagingDir, { recursive: true, force: true });
if (zipped.status !== 0) throw new Error(zipped.error?.message || zipped.stderr || "zip packaging failed");

const bytes = await fs.readFile(archivePath);
console.log(path.relative(extensionRoot, archivePath));
console.log(`size: ${bytes.length} bytes`);
console.log(`sha256: ${createHash("sha256").update(bytes).digest("hex")}`);
