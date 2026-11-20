"use client";
import type { Envelope, PersonsResult } from "@hostpog/contracts";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
import { QueryState } from "@/components/analytics-controls";
import { useProject } from "@/components/project-context";
import { Provenance } from "@/components/provenance";
import { Badge, Button, Input, PageHeader, Section, Segmented, Table, Td, Th } from "@/components/ui";
import { apiGet, type ApiError } from "@/lib/api";
import { fmtTime, personLabel } from "@/lib/format";

export default function Users() {
  const p = useProject();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [identified, setIdentified] = useState<"all" | "true" | "false">("all");
  const [cursor, setCursor] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setCursor(null), [debounced, identified, p.sourceId]);
  const qs = new URLSearchParams({ sourceId: p.sourceId ?? "", limit: "50", ...(debounced ? { search: debounced } : {}), ...(identified !== "all" ? { identified } : {}), ...(cursor ? { cursor } : {}) });
  const q = useQuery<Envelope<PersonsResult>, ApiError>({
    queryKey: ["persons", p.projectId, qs.toString()],
    queryFn: () => apiGet(`/api/v1/projects/${p.projectId}/persons?${qs}`),
    enabled: Boolean(p.sourceId),
  });
  const rows = q.data?.result.rows ?? [];
  return (
    <div className="mx-auto max-w-[1280px]">
      <PageHeader title="Users" description="Everyone who has used your product." />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input aria-label="Search users" className="w-[280px]" placeholder="Search by email, name or distinct ID" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Segmented
          label="Identification"
          value={identified}
          onChange={setIdentified}
          options={[
            { value: "all", label: "All" },
            { value: "true", label: "Identified" },
            { value: "false", label: "Anonymous" },
          ]}
        />
      </div>
      {p.source?.kind === "posthog" && q.data && !rows.length && !debounced && (
        <p className="mb-3 rounded-md border border-line bg-panel px-3 py-2 text-[13px] text-ink-2">
          No identified people yet. Call <code className="font-mono">identify()</code> in posthog-js to create profiles.
        </p>
      )}
      <Section>
        <QueryState q={q} empty={!rows.length}>
          <Table>
            <thead>
              <tr>
                <Th>Person</Th>
                <Th>Type</Th>
                <Th className="hidden md:table-cell">Distinct IDs</Th>
                <Th>First seen</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-panel-2">
                  <Td className="max-w-[280px] truncate">
                    <Link className="font-medium hover:underline" href={p.href(`users/${encodeURIComponent(r.id)}`)}>
                      {personLabel(r)}
                    </Link>
                  </Td>
                  <Td>{r.isIdentified ? <Badge tone="brand">identified</Badge> : <Badge>anonymous</Badge>}</Td>
                  <Td className="hidden max-w-[320px] truncate font-mono text-[12px] text-ink-2 md:table-cell">{r.distinctIds.slice(0, 3).join(", ")}{r.distinctIds.length > 3 ? ` +${r.distinctIds.length - 3}` : ""}</Td>
                  <Td className="whitespace-nowrap text-ink-2">{fmtTime(r.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="flex justify-end gap-2 px-4 py-2">
            {cursor && (
              <Button size="sm" onClick={() => setCursor(null)}>
                First page
              </Button>
            )}
            {q.data?.result.nextCursor && (
              <Button size="sm" onClick={() => setCursor(q.data!.result.nextCursor)}>
                Next page
              </Button>
            )}
          </div>
          <Provenance env={q.data} />
        </QueryState>
      </Section>
    </div>
  );
}
