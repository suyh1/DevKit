import { randomUUID } from 'node:crypto';

// Application standard IO, not a PTY or a system shell. Cursors count UTF-16 units.
export function createJarConsole({ capacity = 1024 * 1024, leaseMs = 20000, now = Date.now } = {}) {
  let generation = randomUUID(), text = '', base = 0, end = 0, lease = null;
  function currentLease() { if (lease && lease.expiresAt <= now()) lease = null; return lease; }
  function sameGeneration(value) { if (value !== generation) throw new Error('应用已重启，请重新读取控制台并取得输入控制权。'); }
  return {
    begin() { generation = randomUUID(); text = ''; base = end = 0; lease = null; },
    append(value) {
      if (!value) return;
      end += value.length; text += value;
      if (text.length > capacity) text = text.slice(-capacity);
      base = end - text.length;
    },
    read({ cursor, generation: requested, owner, renew = false } = {}) {
      const active = currentLease();
      if (renew && active?.owner === owner) active.expiresAt = now() + leaseMs;
      const reset = requested !== generation || !Number.isSafeInteger(cursor) || cursor < 0 || cursor > end;
      const from = reset ? base : Math.max(base, cursor);
      const to = Math.min(end, from + 65536);
      return { generation, text: text.slice(from - base, to - base), cursor: to, end, reset, truncated: reset ? from > 0 : cursor < base, lease: active ? { ...active } : null };
    },
    claim({ owner, label, generation: requested }) {
      sameGeneration(requested);
      if (typeof owner !== 'string' || !owner || owner.length > 180 || typeof label !== 'string' || label.length > 100) throw new Error('控制台客户端标识无效。');
      const active = currentLease();
      if (active && active.owner !== owner) throw new Error(`输入控制权由 ${active.label} 持有，请等待释放或租约到期。`);
      lease = { owner, label, expiresAt: now() + leaseMs }; return { ...lease };
    },
    assertInput(owner, requested) {
      sameGeneration(requested);
      if (currentLease()?.owner !== owner) throw new Error('请先取得控制台输入控制权。');
      lease.expiresAt = now() + leaseMs;
    },
    release(owner) { if (currentLease()?.owner === owner) { lease = null; return true; } return false; },
    finish() { lease = null; },
    revoke(session) { if (currentLease()?.owner.startsWith(session + ':')) lease = null; },
  };
}
