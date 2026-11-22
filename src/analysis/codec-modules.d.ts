declare module 'hyparquet-compressors/src/brotli.js' {
  export const decompressBrotli: typeof import('hyparquet-compressors').decompressBrotli;
}
declare module 'hyparquet-compressors/src/gzip.js' {
  export const gunzip: typeof import('hyparquet-compressors').gunzip;
}
declare module 'hyparquet-compressors/src/lz4.js' {
  export const decompressLz4: typeof import('hyparquet-compressors').decompressLz4;
  export const decompressLz4Raw: typeof import('hyparquet-compressors').decompressLz4Raw;
}
