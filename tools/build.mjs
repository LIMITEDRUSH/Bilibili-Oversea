import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).map((item) => {
    const index = item.indexOf("=");
    return index < 0 ? [item.replace(/^--/, ""), ""] : [item.slice(2, index), item.slice(index + 1)];
  }),
);
const baseUrl = String(args["base-url"] || "").replace(/\/+$/, "");
const outDir = path.resolve(root, args.out || "dist");
// A published download is a frozen artifact, not a development manifest name.
const browserRelease = JSON.parse(
  await fs.readFile(path.join(root, "site", "browser-release.json"), "utf8"),
);
if (!/^\d+\.\d+\.\d+$/.test(browserRelease.version)
    || !/^bilibili-oversea-browser-v[\w.-]+\.zip$/.test(browserRelease.fileName)
    || browserRelease.downloadBaseUrl !== `https://limitedrush.online/assets/projects/bilibili-oversea/browser-${browserRelease.version}`
    || browserRelease.projectUrl !== "https://limitedrush.online/projects/bilibili-oversea"
    || !/^[a-f0-9]{64}$/.test(browserRelease.sha256)
    || !Number.isSafeInteger(browserRelease.bytes) || browserRelease.bytes <= 0) {
  throw new Error("Invalid frozen browser release metadata");
}

if (!/^https:\/\/[^\s]+$/i.test(baseUrl)) {
  throw new Error("请使用 --base-url=https://... 指定项目根目录的公开 HTTPS 地址");
}

const templateDir = path.join(root, "ios", "templates");
const templates = [
  "BiliCDNAuto.surge.sgmodule",
  "BiliCDNAuto.shadowrocket.module",
  "BiliCDNAuto.loon.plugin",
  "BiliCDNAuto.stash.stoverride",
  "BiliCDNAuto.quantumultx.snippet",
];
const shortcutNames = ["BiliCDNAuto-ConnectVPN.shortcut"];

await fs.mkdir(outDir, { recursive: true });
await fs.copyFile(
  path.join(root, "browser-extension", "assets", "icons", "icon-32.png"),
  path.join(outDir, "favicon.png"),
);
await fs.copyFile(
  path.join(root, "browser-extension", "assets", "icons", "icon-128.png"),
  path.join(outDir, "icon-128.png"),
);
for (const name of templates) {
  const source = await fs.readFile(path.join(templateDir, name), "utf8");
  await fs.writeFile(path.join(outDir, name), source.replaceAll("__BASE_URL__", baseUrl));
}
for (const name of shortcutNames) {
  await fs.copyFile(path.join(root, "ios", "shortcuts", name), path.join(outDir, name));
}

const configUrls = Object.fromEntries(templates.map((name) => [name, `${baseUrl}/dist/${name}`]));
const links = {
  surge: `surge:///install-module?url=${encodeURIComponent(configUrls[templates[0]])}`,
  shadowrocket: `shadowrocket://install?module=${encodeURIComponent(configUrls[templates[1]])}`,
  loon: `https://www.nsloon.com/openloon/import?plugin=${encodeURIComponent(configUrls[templates[2]])}`,
  stash: `stash://install-override?url=${encodeURIComponent(configUrls[templates[3]])}`,
  quantumultx: configUrls[templates[4]],
  browser: `${browserRelease.downloadBaseUrl}/${browserRelease.fileName}`,
  browser_sha256: `${browserRelease.downloadBaseUrl}/${browserRelease.fileName}.sha256`,
  project: browserRelease.projectUrl,
  shortcut: `./${shortcutNames[0]}`,
};

const pages = [
  ["install.template.html", "index.html"],
  ["guide.template.html", "guide.html"],
  ["browser-guide.template.html", "browser-guide.html"],
];
for (const [templateName, outputName] of pages) {
  let html = await fs.readFile(path.join(root, "site", templateName), "utf8");
  html = html.replaceAll("__BROWSER_VERSION__", browserRelease.version)
    .replaceAll("__BROWSER_FILENAME__", browserRelease.fileName);
  for (const [key, value] of Object.entries(links)) {
    html = html.replaceAll(`__${key.toUpperCase()}__`, value);
  }
  await fs.writeFile(path.join(outDir, outputName), html);
}
await fs.writeFile(
  path.join(outDir, "install-links.json"),
  `${JSON.stringify({ baseUrl, generatedAt: new Date().toISOString(), browserRelease, links }, null, 2)}\n`,
);

console.log(
  `Built ${templates.length} iOS configs, ${shortcutNames.length} signed shortcut and install page in ${outDir}`,
);
