import type { Compressors } from 'hyparquet';
import { decompress } from 'fzstd';
import { decompressBrotli } from 'hyparquet-compressors/src/brotli.js';
import { decompressLz4, decompressLz4Raw } from 'hyparquet-compressors/src/lz4.js';
import { gunzip } from 'hyparquet-compressors/src/gzip.js';
// Use hyparquet's built-in JS Snappy decoder under the desktop CSP.
export const compressors: Compressors = {
  GZIP: (bytes, size) => gunzip(bytes, new Uint8Array(size)),
  ZSTD: (bytes) => decompress(bytes),
  BROTLI: decompressBrotli,
  LZ4: decompressLz4,
  LZ4_RAW: decompressLz4Raw,
};
