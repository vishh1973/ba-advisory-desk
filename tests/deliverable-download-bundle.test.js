const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createZipBuffer,
  crc32,
  sanitizeZipFileName,
  uniqueZipFileNames,
} = require("../api/deliverable-download-bundle").__test;

test("ZIP file names are sanitized before packaging", () => {
  assert.equal(sanitizeZipFileName("../secret/answer.docx"), "answer.docx");
  assert.equal(sanitizeZipFileName("bad:name?.xlsx"), "bad_name_.xlsx");
  assert.equal(sanitizeZipFileName(""), "deliverable-file");
});

test("ZIP builder de-duplicates repeated file names", () => {
  const files = uniqueZipFileNames([
    { name: "mapping.xlsx", data: Buffer.from("one") },
    { name: "mapping.xlsx", data: Buffer.from("two") },
    { name: "mapping.xlsx", data: Buffer.from("three") },
  ]);

  assert.deepEqual(files.map((file) => file.zipName), [
    "mapping.xlsx",
    "mapping (2).xlsx",
    "mapping (3).xlsx",
  ]);
});

test("ZIP builder writes a valid stored ZIP envelope", () => {
  const zip = createZipBuffer([
    { name: "../resume.docx", data: Buffer.from("resume") },
    { name: "grid.xlsx", data: Buffer.from("grid") },
  ]);

  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
  assert.ok(zip.includes(Buffer.from("resume.docx")));
  assert.ok(zip.includes(Buffer.from("grid.xlsx")));
  assert.equal(zip.includes(Buffer.from("../")), false);
});

test("ZIP builder uses standard CRC32 values", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
});
