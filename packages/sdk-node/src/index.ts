/**
 * @hostpog/node — server SDK for HostPog native collection.
 *
 *   const hp = new HostPogNode("hp_pk_…", { host: "http://localhost:3001" });
 *   hp.capture({ distinctId: user.id, event: "invoice_paid", properties: { amount: 20 } });
 *   await hp.shutdown();
 */
import { createHash, randomUUID } from "node:crypto";

export interface HostPogNodeOptions {
  host: string;
  flushAt?: number;
  flushIntervalMs?: number;
  maxQueueSize?: number;
  maxRetries?: number;
  requestTimeoutMs?: number;
  fetch?: typeof fetch;
  onError?: (err: Error) => void;
}

export interface CaptureInput {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
  timestamp?: Date;
  uuid?: string;
}

interface Ev {
  uuid: string;
  event: string;
  distinct_id: string;
  timestamp: string;
  properties: Record<string, unknown>;
}

const VERSION = "0.1.0";
const SECRET_IN_TEXT = /(bearer\s+[a-z0-9._-]+|(api[_-]?key|token|password|secret)=\S+)/gi;

/** Stable grouping key for an exception: type + top in-app frames, without line/col numbers or absolute paths. */
export function exceptionFingerprint(err: Error): string {
  const frames = (err.stack ?? "")
    .split("\n")
    .slice(1)
    .filter((l) => !l.includes("node_modules") && !l.includes("node:"))
    .slice(0, 5)
    .map((l) => l.trim().replace(/:\d+:\d+\)?$/, "").replace(/\(?\/.*\//, ""));
  return createHash("sha256").update(`${err.name}|${frames.join("|")}`).digest("hex").slice(0, 16);
}

export class HostPogNode {
  private queue: Ev[] = [];
  private timer: NodeJS.Timeout;
  private inflight: Promise<void> | null = null;
  private readonly o: Required<Omit<HostPogNodeOptions, "onError" | "fetch">> & Pick<HostPogNodeOptions, "onError" | "fetch">;

  constructor(
    private readonly apiKey: string,
    opts: HostPogNodeOptions,
  ) {
    if (!apiKey.startsWith("hp_pk_")) throw new Error("HostPog: expected a project key starting with hp_pk_");
    this.o = {
      host: opts.host.replace(/\/$/, ""),
      flushAt: opts.flushAt ?? 20,
      flushIntervalMs: opts.flushIntervalMs ?? 10_000,
      maxQueueSize: opts.maxQueueSize ?? 10_000,
      maxRetries: opts.maxRetries ?? 3,
      requestTimeoutMs: opts.requestTimeoutMs ?? 10_000,
      fetch: opts.fetch,
      onError: opts.onError,
    };
    this.timer = setInterval(() => void this.flush(), this.o.flushIntervalMs);
    this.timer.unref?.();
  }

  capture(input: CaptureInput): void {
    if (!input.distinctId || !input.event) return;
    this.queue.push({
      uuid: input.uuid ?? randomUUID(),
      event: input.event,
      distinct_id: input.distinctId,
      timestamp: (input.timestamp ?? new Date()).toISOString(),
      properties: { $lib: "hostpog-node", $lib_version: VERSION, ...input.properties },
    });
    if (this.queue.length > this.o.maxQueueSize) this.queue.splice(0, this.queue.length - this.o.maxQueueSize);
    if (this.queue.length >= this.o.flushAt) void this.flush();
  }

  identify(input: { distinctId: string; anonymousId?: string; properties?: Record<string, unknown> }): void {
    this.capture({
      distinctId: input.distinctId,
      event: "$identify",
      properties: { ...(input.anonymousId ? { $anon_distinct_id: input.anonymousId } : {}), $set: input.properties ?? {} },
    });
  }

  /** Records a $exception event. Messages are scrubbed of obvious secrets; stacks are trimmed. */
  captureException(err: unknown, distinctId: string, properties: Record<string, unknown> = {}): void {
    const e = err instanceof Error ? err : new Error(String(err));
    this.capture({
      distinctId,
      event: "$exception",
      properties: {
        $exception_type: e.name,
        $exception_message: e.message.replace(SECRET_IN_TEXT, "[redacted]").slice(0, 1000),
        $exception_stack: (e.stack ?? "").replace(SECRET_IN_TEXT, "[redacted]").split("\n").slice(0, 20).join("\n"),
        $exception_fingerprint: exceptionFingerprint(e),
        ...properties,
      },
    });
  }

  async flush(): Promise<void> {
    if (this.inflight) await this.inflight;
    if (!this.queue.length) return;
    const batch = this.queue.splice(0, 100);
    this.inflight = this.sendWithRetry(batch).finally(() => (this.inflight = null));
    await this.inflight;
    if (this.queue.length) await this.flush();
  }

  private async sendWithRetry(batch: Ev[]) {
    const f = this.o.fetch ?? fetch;
    for (let attempt = 0; attempt <= this.o.maxRetries; attempt++) {
      try {
        const res = await f(`${this.o.host}/v1/batch`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
          body: JSON.stringify({ batch, sent_at: new Date().toISOString() }),
          signal: AbortSignal.timeout(this.o.requestTimeoutMs),
        });
        if (res.ok) return;
        if (res.status !== 429 && res.status < 500) {
          this.o.onError?.(new Error(`HostPog rejected batch (${res.status})`));
          return;
        }
      } catch (e) {
        if (attempt === this.o.maxRetries) this.o.onError?.(e as Error);
      }
      await new Promise((r) => setTimeout(r, Math.min(30_000, 500 * 2 ** attempt) * (0.5 + Math.random() / 2)));
    }
    // keep events for the next flush rather than dropping them
    this.queue.unshift(...batch);
  }

  async shutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.flush();
  }
}

export default HostPogNode;
