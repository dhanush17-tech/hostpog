"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useProject } from "@/components/project-context";
import { Button, ErrorBox, Field, Input, PageHeader, Section } from "@/components/ui";
import { apiSend } from "@/lib/api";

export default function ProjectSettings() {
  const p = useProject();
  const router = useRouter();
  const [name, setName] = useState(p.projectName);
  const [tz, setTz] = useState(p.timezone);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["UTC"];
  return (
    <div className="mx-auto max-w-[760px] space-y-5">
      <PageHeader title="Project" description="Name, timezone and data." />
      <Section>
        <form
          className="space-y-4 p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setErr(null);
            try {
              await apiSend(`/api/v1/projects/${p.projectId}`, "PATCH", { name, timezone: tz });
              setMsg("Saved.");
              router.refresh();
            } catch (e2) {
              setErr((e2 as Error).message);
            }
          }}
        >
          <Field label="Name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} disabled={!p.can("admin")} />}</Field>
          <Field label="Timezone">
            {(id) => (
              <>
                <Input id={id} list="tz-list" value={tz} onChange={(e) => setTz(e.target.value)} disabled={!p.can("admin")} />
                <datalist id="tz-list">
                  {zones.map((z) => (
                    <option key={z} value={z} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
          {p.can("admin") && (
            <Button type="submit" variant="primary">
              Save
            </Button>
          )}
          {msg && <span className="ml-2 text-[12px] text-pos">{msg}</span>}
        </form>
      </Section>
      {p.can("owner") && (
        <Section title="Danger zone">
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 text-[13px]">
            <p className="text-ink-2">Remove this project and everything HostPog stores for it. Connected PostHog accounts are not modified.</p>
            <Button
              variant="danger"
              onClick={async () => {
                if (!confirm(`Delete project “${p.projectName}”?`)) return;
                try {
                  await apiSend(`/api/v1/projects/${p.projectId}`, "DELETE");
                  router.push("/app");
                } catch (e) {
                  setErr((e as Error).message);
                }
              }}
            >
              Delete project
            </Button>
          </div>
        </Section>
      )}
      {err && <ErrorBox error={err} />}
    </div>
  );
}
