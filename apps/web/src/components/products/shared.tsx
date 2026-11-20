"use client";
import { Plus, X } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { CopyButton } from "@/components/docs/copy-button";
import { useProject } from "@/components/project-context";
import { Badge, Button, cx, Input, Segmented, Select } from "@/components/ui";

export const INGEST_URL = process.env.NEXT_PUBLIC_HOSTPOG_INGEST_URL ?? "http://localhost:3001";

/** The key an app should use: the HostPog project key (works with posthog-js via /ph, too). */
export function useProjectKey(): string | null {
  const p = useProject();
  return p.sources.find((s) => s.kind === "native")?.ingestionKeys[0]?.publicKey ?? null;
}

export type Sdk = "posthog" | "hostpog" | "node" | "python";

/**
 * "How do I use this in my app?" card. Shows code for posthog-js (pointed at HostPog) or the HostPog SDK, with the
 * project's real key filled in. `code` receives the key and the init line and returns the feature-specific lines.
 */
export function SetupCode({
  title = "Use it in your app",
  sdks = ["posthog", "hostpog"],
  code,
  note,
  labels: labelOverrides,
}: {
  title?: string;
  sdks?: Sdk[];
  labels?: Partial<Record<Sdk, string>>;
  code: (sdk: Sdk, ctx: { key: string; host: string; init: string }) => string;
  note?: ReactNode;
}) {
  const p = useProject();
  const key = useProjectKey();
  const [sdk, setSdk] = useState<Sdk>(sdks[0]!);
  if (!key) {
    return (
      <div className="rounded-xl border border-dashed border-line-strong p-4 text-[13px] text-ink-2">
        <p className="font-medium text-ink">{title}</p>
        <p className="mt-1">Your app needs a HostPog project key first. It works with posthog-js too.</p>
        <Link href={p.href("settings/sdk")} className="mt-3 inline-block">
          <Button size="sm">Create a project key</Button>
        </Link>
      </div>
    );
  }
  const init =
    sdk === "posthog"
      ? `import posthog from "posthog-js";\n\nposthog.init("${key}", { api_host: "${INGEST_URL}/ph" });`
      : sdk === "hostpog"
        ? `import hostpog from "@hostpog/js";\n\nhostpog.init("${key}", { host: "${INGEST_URL}" });`
        : sdk === "node"
          ? `import { HostPogNode } from "@hostpog/node";\n\nconst hostpog = new HostPogNode("${key}", { host: "${INGEST_URL}" });`
          : `# pip install posthog\nfrom posthog import Posthog\n\nposthog = Posthog("${key}", host="${INGEST_URL}/ph")`;
  const text = code(sdk, { key, host: INGEST_URL, init });
  const labels: Record<Sdk, string> = { posthog: "posthog-js", hostpog: "HostPog SDK", node: "Node", python: "Python", ...labelOverrides };
  return (
    <div className="rounded-xl border border-line bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <p className="text-[13px] font-medium">{title}</p>
        <div className="flex items-center gap-2">
          {sdks.length > 1 && <Segmented label="SDK" value={sdk} onChange={setSdk} options={sdks.map((s) => ({ value: s, label: labels[s] }))} />}
          <CopyButton text={text} label="Copy" />
        </div>
      </div>
      <pre className="overflow-x-auto px-4 py-3 font-mono text-[12px] leading-5 text-ink-2">{text}</pre>
      {note && <p className="border-t border-line px-4 py-2.5 text-[12px] text-ink-3">{note}</p>}
    </div>
  );
}

export interface Condition {
  property: string;
  operator: "eq" | "neq" | "contains" | "not_contains" | "is_set" | "is_not_set" | "gt" | "lt" | "in";
  value?: string | number | string[];
}

const OPS: { value: Condition["operator"]; label: string; needsValue: boolean }[] = [
  { value: "eq", label: "is", needsValue: true },
  { value: "neq", label: "is not", needsValue: true },
  { value: "contains", label: "contains", needsValue: true },
  { value: "not_contains", label: "doesn't contain", needsValue: true },
  { value: "in", label: "is one of", needsValue: true },
  { value: "gt", label: "greater than", needsValue: true },
  { value: "lt", label: "less than", needsValue: true },
  { value: "is_set", label: "is set", needsValue: false },
  { value: "is_not_set", label: "is not set", needsValue: false },
];

/** Rows of "property operator value" (all must match). `ops` limits the operators offered. */
export function ConditionEditor({
  conditions,
  onChange,
  placeholder = "plan",
  ops,
  addLabel = "Add condition",
  disabled,
}: {
  conditions: Condition[];
  onChange: (c: Condition[]) => void;
  placeholder?: string;
  ops?: Condition["operator"][];
  addLabel?: string;
  disabled?: boolean;
}) {
  const options = ops ? OPS.filter((o) => ops.includes(o.value)) : OPS;
  const set = (i: number, patch: Partial<Condition>) => onChange(conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <div className="space-y-2">
      {conditions.map((c, i) => {
        const op = options.find((o) => o.value === c.operator) ?? options[0]!;
        return (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <span className="w-10 text-right text-[12px] text-ink-3">{i === 0 ? "where" : "and"}</span>
            <Input aria-label="Property" placeholder={placeholder} value={c.property} disabled={disabled} onChange={(e) => set(i, { property: e.target.value })} className="w-[200px]" />
            <Select aria-label="Operator" value={c.operator} disabled={disabled} onChange={(e) => set(i, { operator: e.target.value as Condition["operator"] })}>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            {op.needsValue && (
              <Input
                aria-label="Value"
                placeholder={c.operator === "in" ? "a, b, c" : "value"}
                value={Array.isArray(c.value) ? c.value.join(", ") : String(c.value ?? "")}
                disabled={disabled}
                onChange={(e) => set(i, { value: c.operator === "in" ? e.target.value.split(",").map((s) => s.trim()) : c.operator === "gt" || c.operator === "lt" ? Number(e.target.value) || e.target.value : e.target.value })}
                className="w-[180px]"
              />
            )}
            {!disabled && (
              <button aria-label="Remove condition" onClick={() => onChange(conditions.filter((_, j) => j !== i))} className="rounded p-1 text-ink-3 hover:bg-panel-2 hover:text-ink">
                <X size={14} />
              </button>
            )}
          </div>
        );
      })}
      {!disabled && (
        <Button size="sm" variant="ghost" onClick={() => onChange([...conditions, { property: "", operator: options[0]!.value, value: "" }])}>
          <Plus size={13} /> {addLabel}
        </Button>
      )}
    </div>
  );
}

export function cleanConditions(c: Condition[]): Condition[] {
  return c.filter((x) => x.property.trim()).map((x) => ({ ...x, property: x.property.trim() }));
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "pos" | "neg" }) {
  return (
    <div className="rounded-xl border border-line bg-panel px-4 py-3">
      <p className="text-[12px] text-ink-3">{label}</p>
      <p className={cx("mt-1 text-[22px] font-semibold tabular-nums tracking-tight", tone === "pos" && "text-pos", tone === "neg" && "text-neg")}>{value}</p>
      {hint && <p className="mt-0.5 text-[12px] text-ink-3">{hint}</p>}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone = status === "running" || status === "active" || status === "on" || status === "delivered" ? "pos" : status === "stopped" || status === "off" ? "neutral" : status === "failed" ? "neg" : "warn";
  return <Badge tone={tone}>{status}</Badge>;
}

export const pct = (x: number | null | undefined, d = 1) => (x === null || x === undefined || !Number.isFinite(x) ? "–" : `${(x * 100).toFixed(d)}%`);
