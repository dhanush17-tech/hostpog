"use client";
import type { Envelope } from "@hostpog/contracts";
import { Clock, Code2, Info } from "lucide-react";
import { Fragment, useState } from "react";
import { fmtRelative } from "@/lib/format";
import { Tooltip } from "./primitives/tooltip";
import { Drawer } from "./ui";

const KIND_LABEL = { posthog: "PostHog", native: "Native", imported: "Imported", demo: "Sample data" } as const;

/** Freshness line under each insight; full provenance (source, window, query) lives in the drawer. */
export function Provenance({ env, extra }: { env: Envelope<unknown> | undefined; extra?: string }) {
  const [open, setOpen] = useState(false);
  if (!env) return null;
  const range = env.range ? `${env.range.from.slice(0, 16).replace("T", " ")} → ${env.range.to.slice(0, 16).replace("T", " ")} UTC` : null;
  const fresh = env.cached ? `Updated ${fmtRelative(env.dataAsOf ?? env.computedAt)}` : `Updated ${fmtRelative(env.computedAt)}`;
  const notes = [...(env.approximation ? [env.approximation] : []), ...env.warnings];
  return (
    <div className="flex items-center gap-3 border-t border-line px-5 py-2 text-[11px] text-ink-3">
      <span className="inline-flex items-center gap-1.5">
        <Clock size={12} aria-hidden />
        {fresh}
      </span>
      {extra && <span>{extra}</span>}
      {notes.length > 0 && (
        <Tooltip content={<ul className="space-y-1">{notes.map((n) => <li key={n}>{n}</li>)}</ul>}>
          <button className="inline-flex items-center gap-1 hover:text-ink" aria-label="Notes about this result">
            <Info size={12} aria-hidden /> {env.approximation ? "Approximate" : "Note"}
          </button>
        </Tooltip>
      )}
      <button className="ml-auto inline-flex items-center gap-1 hover:text-ink" onClick={() => setOpen(true)}>
        <Code2 size={12} aria-hidden /> View query
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title="How this was computed">
        <div className="space-y-4 text-[13px]">
          <dl className="grid grid-cols-[120px_1fr] gap-y-1">
            <dt className="text-ink-3">Source</dt>
            <dd>
              {KIND_LABEL[env.source.kind]} · {env.source.label}
              {env.source.externalProjectId ? ` (project ${env.source.externalProjectId}, ${env.source.region})` : ""}
            </dd>
            <dt className="text-ink-3">Window</dt>
            <dd>{range ?? "n/a"}</dd>
            <dt className="text-ink-3">Timezone</dt>
            <dd>{env.timezone}</dd>
            <dt className="text-ink-3">Fingerprint</dt>
            <dd className="font-mono text-[12px]">{env.fingerprint}</dd>
            <dt className="text-ink-3">Computed</dt>
            <dd>
              {fmtRelative(env.computedAt)} · {env.durationMs} ms{env.cached ? " · cached" : ""}
            </dd>
            {notes.map((n) => (
              <Fragment key={n}>
                <dt className="text-ink-3">Note</dt>
                <dd>{n}</dd>
              </Fragment>
            ))}
          </dl>
          {env.queries.map((q, i) => (
            <div key={i}>
              <p className="mb-1 text-[12px] font-medium text-ink-2">
                Query {i + 1} · {q.dialect}
              </p>
              <pre className="overflow-auto rounded-md border border-line bg-panel-2 p-3 font-mono text-[12px] leading-5">{q.text}</pre>
              <pre className="mt-1 overflow-auto rounded-md border border-line bg-panel-2 p-2 font-mono text-[11px] text-ink-2">{JSON.stringify(q.params, null, 2)}</pre>
            </div>
          ))}
        </div>
      </Drawer>
    </div>
  );
}
