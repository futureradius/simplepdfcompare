// Reads a ZIP of stored entries (as src/export/zip.ts writes them) back into its files, for the
// tests of the .xlsx export. Not a general unzipper: compressed entries are refused.

export function unzipStored(bytes: Uint8Array): Map<string, string> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && v.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error("not a ZIP");
  const count = v.getUint16(end + 10, true);
  let at = v.getUint32(end + 16, true);
  const dec = new TextDecoder();
  const files = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    if (v.getUint32(at, true) !== 0x02014b50) throw new Error("bad central directory");
    const method = v.getUint16(at + 10, true),
      size = v.getUint32(at + 20, true),
      nameLen = v.getUint16(at + 28, true),
      extraLen = v.getUint16(at + 30, true),
      commentLen = v.getUint16(at + 32, true),
      local = v.getUint32(at + 42, true);
    const name = dec.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    if (method !== 0) throw new Error(`${name}: compressed`);
    const dataAt = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    files.set(name, dec.decode(bytes.subarray(dataAt, dataAt + size)));
    at += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}
