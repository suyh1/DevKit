import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

export async function fileDigest(file: Blob, progress?: (bytes: number) => void, cancelled?: () => boolean) {
  const hash = sha256.create();
  const chunkSize = 1024 * 1024;
  for (let offset = 0; offset < file.size; offset += chunkSize) {
    if (cancelled?.()) throw new Error('已暂停读取文件。');
    const chunk = await file.slice(offset, offset + chunkSize).arrayBuffer();
    hash.update(new Uint8Array(chunk));
    progress?.(offset + chunk.byteLength);
  }
  return bytesToHex(hash.digest());
}

const memory = new Map<string, string>();
export function uploadIdentity(file: File, digest: string, hours: number) {
  const key = 'devkit:resume:' + JSON.stringify([location.pathname, file.name, digest, hours]);
  let token = memory.get(key);
  try {
    token ||= sessionStorage.getItem(key) || undefined;
  } catch {
    /* memory fallback */
  }
  if (!token) token = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  memory.set(key, token);
  try {
    sessionStorage.setItem(key, token);
  } catch {
    /* memory fallback */
  }
  return {
    token,
    clear() {
      memory.delete(key);
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* memory fallback */
      }
    },
  };
}
