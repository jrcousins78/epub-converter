// A small, strict ZIP writer for EPUB files.
//
// Each entry is fully known before it is written, so every local header
// carries the real CRC and sizes (no data descriptors, no extra fields).
// That keeps the archive friendly to old e-reader firmware and satisfies the
// EPUB rule that `mimetype` is the first entry, stored uncompressed, with no
// extra field. Output is streamed entry-by-entry to `sink`, so a large bundle
// never has to sit in memory as a single buffer.
import { deflateSync } from 'fflate';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export type ZipSink = (chunk: Uint8Array) => void | Promise<void>;

interface Entry {
  name: Uint8Array;
  crc: number;
  csize: number;
  usize: number;
  method: 0 | 8;
  offset: number;
  utf8: boolean;
}

function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export class ZipWriter {
  private entries: Entry[] = [];
  private offset = 0;
  private finished = false;
  private readonly stamp: { time: number; date: number };
  private readonly encoder = new TextEncoder();

  constructor(private readonly sink: ZipSink, now = new Date()) {
    this.stamp = dosDateTime(now);
  }

  get bytesWritten(): number {
    return this.offset;
  }

  async add(name: string, data: Uint8Array, opts: { store?: boolean } = {}): Promise<void> {
    if (this.finished) throw new Error('ZIP already finished');
    const nameBytes = this.encoder.encode(name);
    const utf8 = nameBytes.length !== name.length;
    const crc = crc32(data);
    let method: 0 | 8 = 0;
    let body = data;
    if (!opts.store && data.length > 64) {
      const deflated = deflateSync(data, { level: 6 });
      if (deflated.length < data.length) {
        method = 8;
        body = deflated;
      }
    }
    const header = new Uint8Array(30 + nameBytes.length);
    const v = new DataView(header.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, utf8 ? 0x0800 : 0, true);
    v.setUint16(8, method, true);
    v.setUint16(10, this.stamp.time, true);
    v.setUint16(12, this.stamp.date, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, body.length, true);
    v.setUint32(22, data.length, true);
    v.setUint16(26, nameBytes.length, true);
    v.setUint16(28, 0, true);
    header.set(nameBytes, 30);

    this.entries.push({ name: nameBytes, crc, csize: body.length, usize: data.length, method, offset: this.offset, utf8 });
    await this.write(header);
    await this.write(body);
  }

  async finish(): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    const cdStart = this.offset;
    for (const e of this.entries) {
      const h = new Uint8Array(46 + e.name.length);
      const v = new DataView(h.buffer);
      v.setUint32(0, 0x02014b50, true);
      v.setUint16(4, 20, true);
      v.setUint16(6, 20, true);
      v.setUint16(8, e.utf8 ? 0x0800 : 0, true);
      v.setUint16(10, e.method, true);
      v.setUint16(12, this.stamp.time, true);
      v.setUint16(14, this.stamp.date, true);
      v.setUint32(16, e.crc, true);
      v.setUint32(20, e.csize, true);
      v.setUint32(24, e.usize, true);
      v.setUint16(28, e.name.length, true);
      v.setUint16(30, 0, true);
      v.setUint16(32, 0, true);
      v.setUint16(34, 0, true);
      v.setUint16(36, 0, true);
      v.setUint32(38, 0, true);
      v.setUint32(42, e.offset, true);
      h.set(e.name, 46);
      await this.write(h);
    }
    const cdSize = this.offset - cdStart;
    const end = new Uint8Array(22);
    const v = new DataView(end.buffer);
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, this.entries.length, true);
    v.setUint16(10, this.entries.length, true);
    v.setUint32(12, cdSize, true);
    v.setUint32(16, cdStart, true);
    await this.write(end);
  }

  private async write(chunk: Uint8Array): Promise<void> {
    if (chunk.length === 0) return;
    this.offset += chunk.length;
    if (this.offset > 0xffffffff) throw new Error('EPUB is larger than 4 GB');
    await this.sink(chunk);
  }
}
