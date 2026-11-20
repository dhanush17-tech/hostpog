/**
 * Tinybird backend for the event store.
 *
 * Implements the four calls HostPog makes on a ClickHouse client (query, insert, command, ping) over Tinybird's HTTP
 * APIs, so NativeProvider, ingest and migration code run unchanged. Selected with HOSTPOG_EVENTS_BACKEND=tinybird.
 *
 *   query   → POST /v0/sql            (params bound client-side as escaped literals)
 *   insert  → POST /v0/events         (NDJSON, wait=true so the caller knows rows are committed)
 *   command → ALTER TABLE x DELETE    → POST /v1/datasources/x/delete; CREATE … is a no-op (schema ships via `tinybird deploy`)
 *   ping    → SELECT 1
 */

type Params = Record<string, unknown> | undefined;
type QueryArgs = { query: string; query_params?: Params; format?: string; abort_signal?: AbortSignal; clickhouse_settings?: Record<string, unknown> };
type InsertArgs = { table: string; values: Record<string, unknown>[]; format?: string };
type CommandArgs = { query: string; query_params?: Params; clickhouse_settings?: Record<string, unknown> };

const MAX_BODY = 9 * 1024 * 1024; // free plan accepts 10 MB per request

function quote(s: string): string {
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function literal(value: unknown, type: string): string {
  const t = type.trim();
  const arr = /^Array\((.+)\)$/.exec(t);
  if (arr) {
    if (!Array.isArray(value)) throw new Error(`Expected an array for ${t}`);
    return `[${value.map((v) => literal(v, arr[1]!)).join(", ")}]`;
  }
  if (/^(U?Int\d+|Float\d+)$/.test(t)) {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error(`Expected a number for ${t}`);
    return String(n);
  }
  if (t === "String") return quote(String(value));
  return `CAST(${quote(String(value))} AS ${t})`;
}

/** Replace ClickHouse `{name:Type}` placeholders with typed, escaped literals. */
export function bindParams(sql: string, params: Params): string {
  if (!params) return sql;
  return sql.replace(/\{([A-Za-z_][A-Za-z0-9_]*):([^{}]+)\}/g, (m, name: string, type: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? literal(params[name], type) : m,
  );
}

/** Top-level UInt64 columns HostPog sends as digit strings. */
const UINT64_COLUMNS = new Set(["version"]);

/** JSON for one row, with top-level UInt64 columns as bare numbers (written textually: no 2^53 precision loss). */
export function toTinybirdJson(row: Record<string, unknown>): string {
  const parts = Object.entries(row).map(([k, v]) => {
    const raw = UINT64_COLUMNS.has(k) && typeof v === "string" && /^\d{1,20}$/.test(v) ? v : JSON.stringify(v);
    return `${JSON.stringify(k)}:${raw}`;
  });
  return `{${parts.join(",")}}`;
}

export class TinybirdClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  private async call(path: string, init: RequestInit & { signal?: AbortSignal }) {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, ...(init.headers ?? {}) },
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* plain-text error */
    }
    if (!res.ok) {
      const msg = (body as { error?: string } | null)?.error ?? text.slice(0, 300);
      throw new Error(`Tinybird ${res.status}: ${msg}`);
    }
    return body;
  }

  async query({ query, query_params, format = "JSONEachRow", abort_signal }: QueryArgs) {
    const q = `${bindParams(query, query_params).trim().replace(/;$/, "")}\nFORMAT JSON`;
    const body = (await this.call("/v0/sql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q }),
      signal: abort_signal,
    })) as { meta: { name: string }[]; data: Record<string, unknown>[] };
    const names = body.meta.map((m) => m.name);
    const out = format === "JSONCompactEachRowWithNames" ? [names, ...body.data.map((r) => names.map((n) => r[n]))] : body.data;
    return { json: async () => out };
  }

  async insert({ table, values }: InsertArgs) {
    let chunk: string[] = [];
    let size = 0;
    const flush = async () => {
      if (!chunk.length) return;
      const r = (await this.call(`/v0/events?name=${encodeURIComponent(table)}&wait=true`, {
        method: "POST",
        headers: { "Content-Type": "application/x-ndjson" },
        body: chunk.join("\n"),
      })) as { successful_rows?: number; quarantined_rows?: number } | null;
      if (r?.quarantined_rows) throw new Error(`Tinybird rejected ${r.quarantined_rows} row(s) for ${table} (see the ${table}_quarantine data source)`);
      chunk = [];
      size = 0;
    };
    for (const v of values) {
      // HostPog sends UInt64 columns (e.g. version) as digit strings, which ClickHouse accepts but Tinybird's Events
      // API rejects. Emit them as bare JSON numbers (textually, so values above 2^53 keep full precision).
      const line = toTinybirdJson(v);
      if (size + line.length + 1 > MAX_BODY) await flush();
      chunk.push(line);
      size += line.length + 1;
    }
    await flush();
  }

  async command({ query, query_params }: CommandArgs) {
    const sql = bindParams(query, query_params).trim();
    const del = /^ALTER\s+TABLE\s+([A-Za-z0-9_]+)\s+DELETE\s+WHERE\s+([\s\S]+)$/i.exec(sql);
    if (del) {
      await this.call(`/v1/datasources/${del[1]}/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ delete_condition: del[2]! }).toString(),
      });
      return;
    }
    // Schema is managed by `tinybird deploy` (lib/tinybird.ts), not runtime DDL.
    if (/^(CREATE|DROP)\s/i.test(sql)) return;
    throw new Error(`Unsupported command on Tinybird: ${sql.slice(0, 60)}`);
  }

  async ping() {
    await this.query({ query: "SELECT 1 AS ok" });
    return { success: true };
  }

  async close() {}
}
