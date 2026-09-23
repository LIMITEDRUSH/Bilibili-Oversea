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

await fs.mkdir(outDir, { recursive: true });
for (const name of templates) {
  const source = await fs.readFile(path.join(templateDir, name), "utf8");
  await fs.writeFile(path.join(outDir, name), source.replaceAll("__BASE_URL__", baseUrl));
}

const configUrls = Object.fromEntries(templates.map((name) => [name, `${baseUrl}/dist/${name}`]));
const links = {
  surge: `surge:///install-module?url=${encodeURIComponent(configUrls[templates[0]])}`,
  shadowrocket: `shadowrocket://install?module=${encodeURIComponent(configUrls[templates[1]])}`,
  loon: `https://www.nsloon.com/openloon/import?plugin=${encodeURIComponent(configUrls[templates[2]])}`,
  stash: `stash://install-override?url=${encodeURIComponent(configUrls[templates[3]])}`,
  quantumultx: configUrls[templates[4]],
  browser: `${baseUrl}/browser-extension/dist/bili-cdn-auto-browser-v1.8.5.zip`,
};

let html = await fs.readFile(path.join(root, "site", "install.template.html"), "utf8");
for (const [key, value] of Object.entries(links)) {
  html = html.replaceAll(`__${key.toUpperCase()}__`, value);
}
await fs.writeFile(path.join(outDir, "index.html"), html);
await fs.writeFile(
  path.join(outDir, "install-links.json"),
  `${JSON.stringify({ baseUrl, generatedAt: new Date().toISOString(), links }, null, 2)}\n`,
);

console.log(`Built ${templates.length} iOS configs and install page in ${outDir}`);
