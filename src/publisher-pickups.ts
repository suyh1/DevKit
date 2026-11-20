export type PublishedTransfer = { id: string; publisherKey?: string; expires?: number };
type Receipt = { key: string; expires: number };
const prefix = 'devkit:transfer:publisher:';

export function clearPortalPickups() {
  try {
    for (const name of Object.keys(sessionStorage)) if (name.startsWith(prefix)) sessionStorage.removeItem(name);
  } catch { /* Storage is optional in private browsing. */ }
}

export function publisherPickups(portal: boolean) {
  const memory = new Map<string, Receipt>();
  let storage: Storage | undefined;
  try {
    storage = portal ? sessionStorage : localStorage;
    for (const name of Object.keys(storage)) {
      if (!name.startsWith(prefix)) continue;
      let row: Receipt | null = null;
      try { row = JSON.parse(storage.getItem(name) || 'null'); } catch { /* Remove malformed records. */ }
      if (row && /^[a-f0-9]{64}$/.test(row.key) && Number.isFinite(row.expires) && row.expires > Date.now())
        memory.set(name.slice(prefix.length), row);
      else storage.removeItem(name);
    }
  } catch { /* Keep new receipts in memory when storage is unavailable. */ }
  return {
    remember({ id, publisherKey, expires }: PublishedTransfer) {
      if (!publisherKey || !expires) return;
      const receipt = { key: publisherKey, expires };
      memory.set(id, receipt);
      try { storage?.setItem(prefix + id, JSON.stringify(receipt)); } catch { /* Still available in this page. */ }
    },
    key(id: string) {
      const receipt = memory.get(id);
      return receipt && receipt.expires > Date.now() ? receipt.key : undefined;
    },
    forget(id: string) {
      memory.delete(id);
      try { storage?.removeItem(prefix + id); } catch { /* Item removal is enforced by the host. */ }
    },
  };
}
