// Just enough of the zip format to read one small text file from a jar.
import fs from 'node:fs';
import zlib from 'node:zlib';

const EOCD = 0x06054b50, CENTRAL = 0x02014b50, STORED = 0;

interface Entry { name: string; method: number; compSize: number; local: number }

function entries(buf: Buffer): Entry[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const list: Entry[] = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CENTRAL) throw new Error('damaged zip directory');
    const nameLen = buf.readUInt16LE(p + 28);
    list.push({
      name: buf.toString('utf8', p + 46, p + 46 + nameLen),
      method: buf.readUInt16LE(p + 10),
      compSize: buf.readUInt32LE(p + 20),
      local: buf.readUInt32LE(p + 42),
    });
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return list;
}

/** The text of one entry; null when the jar has no such entry. Damaged jars throw. */
export function readText(file: string, entryName: string): string | null {
  const buf = fs.readFileSync(file);
  const e = entries(buf).find((x) => x.name === entryName);
  if (!e) return null;
  const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
  const data = buf.subarray(start, start + e.compSize);
  return (e.method === STORED ? data : zlib.inflateRawSync(data)).toString('utf8');
}
