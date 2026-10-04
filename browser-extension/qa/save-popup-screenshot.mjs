// Save generated CDP pixels from capture-popup.js JSON; no image editing.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const result = JSON.parse(input.trim().replace(/^\uFEFF/, ""));
if (typeof result.png !== "string" || result.png.length > 5_000_000) throw new Error("Invalid screenshot payload");
const png = Buffer.from(result.png, "base64");
if (png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("Not a PNG");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const directory = path.join(root, "output/playwright/ui-v2.3.3");
await fs.mkdir(directory, { recursive: true });
const output = path.join(directory, "live-playing.png");
await fs.writeFile(output, png);
console.log(JSON.stringify({ output, width: result.width, height: result.height, layout: result.layout }));
