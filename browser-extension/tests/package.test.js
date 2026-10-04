import assert from "node:assert/strict";
import test from "node:test";
import { inflateRawSync } from "node:zlib";
import { createZip, crc32 } from "../scripts/zip.mjs";

test("标准 ZIP 可解压、CRC 正确、无点路径且重复构建一致", () => {
  const entries = [
    { name: "src/popup.js", bytes: Buffer.from("console.log('你好')") },
    { name: "manifest.json", bytes: Buffer.from('{"version":"2.3.0"}') },
  ];
  const archive = createZip(entries);
  assert.deepEqual(archive, createZip([...entries].reverse()));
  let offset = 0;
  const actual = new Map();
  while (archive.readUInt32LE(offset) === 0x04034b50) {
    const size = archive.readUInt32LE(offset + 18);
    const nameSize = archive.readUInt16LE(offset + 26);
    const extraSize = archive.readUInt16LE(offset + 28);
    const name = archive.subarray(offset + 30, offset + 30 + nameSize).toString("utf8");
    const start = offset + 30 + nameSize + extraSize;
    const data = inflateRawSync(archive.subarray(start, start + size));
    assert.equal(crc32(data), archive.readUInt32LE(offset + 14));
    assert.equal(data.length, archive.readUInt32LE(offset + 22));
    assert.doesNotMatch(name, /^\.\//);
    actual.set(name, data);
    offset = start + size;
  }
  assert.equal(archive.readUInt32LE(offset), 0x02014b50);
  for (const entry of entries) assert.deepEqual(actual.get(entry.name), entry.bytes);
  assert.equal(archive.readUInt16LE(archive.length - 12), entries.length);
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
});

test("ZIP 打包拒绝绝对路径、父路径、重复项和反斜杠", () => {
  for (const name of ["/manifest.json", "C:/manifest.json", "C:manifest.json", "../manifest.json", "./manifest.json", "src\\popup.js"]) {
    assert.throws(() => createZip([{ name, bytes: Buffer.alloc(0) }]), /Unsafe/);
  }
  const entry = { name: "manifest.json", bytes: Buffer.alloc(0) };
  assert.throws(() => createZip([entry, entry]), /duplicate/);
});
