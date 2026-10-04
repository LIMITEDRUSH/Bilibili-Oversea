import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createZip } from "./zip.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8"));
const outputDir = path.join(root, "dist");
const name = "bilibili-oversea-browser-v" + manifest.version + ".zip";
const archivePath = path.join(outputDir, name);
const entries = [];

async function collect(relative) {
  const absolute = path.join(root, relative);
  const stat = await fs.lstat(absolute);
  if (stat.isSymbolicLink()) throw new Error("Packaging refuses symlink: " + relative);
  if (stat.isDirectory()) {
    for (const name of await fs.readdir(absolute)) await collect(relative + "/" + name);
  } else if (stat.isFile()) {
    entries.push({ name: relative, bytes: await fs.readFile(absolute) });
  }
}

for (const file of ["manifest.json", "LICENSE", "README.md", "PRIVACY.md", "SECURITY.md", "ARCHITECTURE.md", "src", "assets/icons"]) {
  await collect(file);
}
const bytes = createZip(entries);
await fs.mkdir(outputDir, { recursive: true });
const temporary = archivePath + "." + process.pid + ".tmp";
try {
  await fs.writeFile(temporary, bytes);
  await fs.rename(temporary, archivePath);
} finally {
  await fs.rm(temporary, { force: true });
}
const checksum = createHash("sha256").update(bytes).digest("hex");
await fs.writeFile(archivePath + ".sha256", checksum + "  " + name + "\n");
console.log(path.relative(root, archivePath));
console.log("files: " + entries.length + " · size: " + bytes.length + " bytes");
console.log("sha256: " + checksum);
