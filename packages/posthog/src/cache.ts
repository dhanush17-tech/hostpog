/**
 * Small in-process cache with request coalescing. Keys MUST include the tenant,
 * source, credential version and query fingerprint (see provider.ts) so results
 * never leak across tenants or survive a credential change.
 */
interface Entry<T> {
  value: T;
  expires: number;
}

export class CoalescingCache {
  private store = new Map<string, Entry<unknown>>();
  private inflight = new Map<string, Promise<unknown>>();
  constructor(private readonly maxEntries = 1000) {}

  async get<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<{ value: T; hit: boolean }> {
    const now = Date.now();
    const e = this.store.get(key);
    if (e && e.expires > now) return { value: e.value as T, hit: true };
    const pending = this.inflight.get(key);
    if (pending) return { value: (await pending) as T, hit: true };
    const p = load()
      .then((v) => {
        if (this.store.size >= this.maxEntries) {
          const first = this.store.keys().next().value;
          if (first) this.store.delete(first);
        }
        this.store.set(key, { value: v, expires: Date.now() + ttlMs });
        return v;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return { value: await p, hit: false };
  }

  /** Invalidate everything for a prefix (e.g. on disconnect / credential rotation). */
  invalidate(prefix: string) {
    for (const k of this.store.keys()) if (k.startsWith(prefix)) this.store.delete(k);
  }
}

export const sharedCache = new CoalescingCache();
