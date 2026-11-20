"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Cpu, Power, RefreshCw, Trash2 } from "lucide-react";
import { ConnectAI, rankModels } from "@/components/connect-ai";
import { RowMenu } from "@/components/row-menu";
import { useProject } from "@/components/project-context";
import { Badge, Button, ErrorBox, Field, Input, PageHeader, Section, Select } from "@/components/ui";
import { apiGet, apiSend } from "@/lib/api";
import { fmtRelative } from "@/lib/format";

interface Provider {
  id: string;
  provider: string;
  label: string;
  model: string;
  baseUrl: string | null;
  keyHint: string | null;
  monthlyTokenBudget: number;
  allowRawEvents: boolean;
  enabled: boolean;
  lastTestedAt: string | null;
  lastTestResult: string | null;
}
interface Catalog {
  id: string;
  label: string;
  defaultBaseUrl: string | null;
  keyHint: string;
  dataNote: string;
}

function AddProvider({ catalog, onDone }: { catalog: Catalog[]; onDone: () => void }) {
  const p = useProject();
  const list = useId();
  const [provider, setProvider] = useState("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [label, setLabel] = useState("");
  const [budget, setBudget] = useState(2_000_000);
  const [models, setModels] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const info = catalog.find((c) => c.id === provider);
  return (
    <form
      className="grid gap-4 p-4 md:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy("save");
        setErr(null);
        try {
          await apiSend(`/api/v1/workspaces/${p.workspaceId}/ai-providers`, "POST", {
            provider,
            label: label || `${info?.label} · ${model}`,
            model,
            ...(apiKey ? { apiKey } : {}),
            ...(baseUrl ? { baseUrl } : {}),
            monthlyTokenBudget: budget,
          });
          setApiKey("");
          onDone();
        } catch (e2) {
          setErr((e2 as Error).message);
        } finally {
          setBusy(null);
        }
      }}
    >
      <Field label="Provider">
        {(id) => (
          <Select id={id} value={provider} onChange={(e) => setProvider(e.target.value)} className="w-full">
            {catalog.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="API key" hint={`${info?.keyHint ?? ""} · encrypted at rest, never shown again`}>
        {(id) => <Input id={id} type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />}
      </Field>
      {(provider === "openai_compatible" || provider === "openrouter") && (
        <Field label="Endpoint URL" hint={provider === "openai_compatible" ? "Private/local hosts (e.g. Ollama) must be approved by the operator: HOSTPOG_AI_ALLOWED_PRIVATE_HOSTS." : "Optional override."}>
          {(id) => <Input id={id} placeholder={info?.defaultBaseUrl ?? "https://…/v1"} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />}
        </Field>
      )}
      <Field label="Model" hint="Type a model id, or load the list your key can use.">
        {(id) => (
          <div className="flex gap-2">
            <Input id={id} list={list} value={model} onChange={(e) => setModel(e.target.value)} placeholder="model id" />
            <datalist id={list}>
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <Button
              type="button"
              size="sm"
              loading={busy === "models"}
              disabled={provider !== "openai_compatible" && !apiKey}
              onClick={async () => {
                setBusy("models");
                setErr(null);
                try {
                  const r = await apiSend<{ models: string[] }>(`/api/v1/workspaces/${p.workspaceId}/ai-models`, "POST", { provider, apiKey: apiKey || undefined, baseUrl: baseUrl || undefined });
                  setModels(r.models);
                  if (!model && r.models[0]) setModel(r.models[0]);
                } catch (e2) {
                  setErr((e2 as Error).message);
                } finally {
                  setBusy(null);
                }
              }}
            >
              Load models
            </Button>
          </div>
        )}
      </Field>
      <Field label="Monthly token budget" hint="Investigations stop when this is reached.">
        {(id) => <Input id={id} type="number" min={1000} step={1000} value={budget} onChange={(e) => setBudget(Number(e.target.value))} />}
      </Field>
      <Field label="Label (optional)">{(id) => <Input id={id} value={label} onChange={(e) => setLabel(e.target.value)} />}</Field>
      <div className="md:col-span-2">
        <p className="mb-3 text-[12px] text-ink-3">{info?.dataNote}</p>
        <Button type="submit" variant="primary" loading={busy === "save"} disabled={!model || (provider !== "openai_compatible" && !apiKey)}>
          Save provider
        </Button>
      </div>
      {err && (
        <div className="md:col-span-2">
          <ErrorBox error={err} />
        </div>
      )}
    </form>
  );
}

/** One connected model. Visible button only when something needs fixing (failing → test again, off → turn on); the rest is in ⋯. */
function ProviderRow({ x, onChange }: { x: Provider; onChange: () => Promise<unknown> | void }) {
  const p = useProject();
  const admin = p.can("admin");
  const url = `/api/v1/workspaces/${p.workspaceId}/ai-providers/${x.id}`;
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pick, setPick] = useState(false);
  const [model, setModel] = useState(x.model);
  const failing = Boolean(x.lastTestResult && !x.lastTestResult.startsWith("ok"));
  const models = useQuery({
    queryKey: ["ai-models", p.workspaceId, x.id],
    queryFn: () => apiSend<{ models: string[] }>(`/api/v1/workspaces/${p.workspaceId}/ai-models`, "POST", { providerId: x.id }),
    enabled: pick,
    staleTime: 5 * 60_000,
  });
  const ranked = models.data ? rankModels(x.provider === "openai_compatible" ? "ollama" : x.provider, models.data.models) : [];
  const run = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name);
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(null);
      await onChange();
    }
  };
  const test = () => void run("test", () => apiSend(url, "POST", {}));
  const openPicker = () => {
    setModel(x.model);
    setPick(true);
  };
  const toggle = () => void run("toggle", () => apiSend(url, "PATCH", { enabled: !x.enabled }));
  return (
    <li className="space-y-3 px-5 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 text-[13px]">
          <p className="flex items-center gap-2 font-medium">
            {x.label} {!x.enabled && <Badge>off</Badge>}
            {failing && <Badge tone="neg">failing</Badge>}
          </p>
          <p className="text-[12px] text-ink-3">
            {x.model}
            {x.keyHint ? ` · key ${x.keyHint}` : ""} · {(x.monthlyTokenBudget / 1_000_000).toLocaleString()}M tokens/month
          </p>
          {busy === "model" || busy === "test" ? (
            <p className="text-[12px] text-ink-3">Testing {busy === "model" ? model : x.model}…</p>
          ) : failing ? (
            <p className="text-[12px] text-neg">
              Last check {fmtRelative(x.lastTestedAt)}: {x.lastTestResult}
            </p>
          ) : x.lastTestResult ? (
            <p className="text-[12px] text-pos">Working · checked {fmtRelative(x.lastTestedAt)}</p>
          ) : null}
          {actionError && <p className="text-[12px] text-neg">{actionError}</p>}
        </div>
        {admin && (
          <div className="flex items-center gap-1.5">
            {failing && x.enabled && (
              <Button size="sm" loading={busy === "test"} onClick={test}>
                <RefreshCw size={13} /> Test again
              </Button>
            )}
            {failing && x.enabled && (
              <Button size="sm" onClick={() => openPicker()}>
                Change model
              </Button>
            )}
            {!x.enabled && (
              <Button size="sm" loading={busy === "toggle"} onClick={toggle}>
                Turn on
              </Button>
            )}
            <RowMenu
              items={[
                { label: "Test connection", icon: <RefreshCw size={14} />, onSelect: test, hidden: failing || !x.enabled },
                { label: "Change model", icon: <Cpu size={14} />, onSelect: () => openPicker(), hidden: failing && x.enabled },
                { label: "Turn off", icon: <Power size={14} />, onSelect: toggle, hidden: !x.enabled },
                {
                  label: "Remove",
                  icon: <Trash2 size={14} />,
                  danger: true,
                  onSelect: () => {
                    if (confirm("Remove this model and delete its stored key? This can't be undone.")) void run("remove", () => apiSend(url, "DELETE"));
                  },
                },
              ]}
            />
          </div>
        )}
      </div>
      {pick && (
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="Model" value={model} onChange={(e) => setModel(e.target.value)} className="min-w-[240px]" disabled={models.isLoading}>
            {[...new Set([model, ...ranked])].map((m) => (
              <option key={m} value={m}>
                {m}
                {m === ranked[0] ? " (recommended)" : ""}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            variant="primary"
            loading={busy === "model"}
            disabled={model === x.model}
            onClick={() =>
              void run("model", async () => {
                await apiSend(url, "PATCH", { model });
                setPick(false);
                await apiSend(url, "POST", {});
              })
            }
          >
            Save &amp; test
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPick(false)}>
            Cancel
          </Button>
          {models.isLoading && <span className="text-[12px] text-ink-3">Loading models…</span>}
          {models.error && <span className="text-[12px] text-neg">Couldn&apos;t load models: {(models.error as Error).message}</span>}
        </div>
      )}
      <label className="flex items-center gap-2 text-[12px] text-ink-2">
        <input
          type="checkbox"
          checked={x.allowRawEvents}
          disabled={!admin}
          onChange={(e) => void run("raw", () => apiSend(url, "PATCH", { allowRawEvents: e.target.checked }))}
        />
        Share redacted event details with the model (off: aggregates only)
      </label>
    </li>
  );
}

export default function AiSettings() {
  const p = useProject();
  const qc = useQueryClient();
  const key = ["ai-providers", p.workspaceId];
  const q = useQuery({ queryKey: key, queryFn: () => apiGet<{ providers: Provider[]; catalog: Catalog[] }>(`/api/v1/workspaces/${p.workspaceId}/ai-providers`) });
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const providers = q.data?.providers ?? [];
  const [showAdd, setShowAdd] = useState(false);
  const [justConnected, setJustConnected] = useState(false);
  return (
    <div className="mx-auto max-w-[1000px]">
      <PageHeader title="AI providers" description="Connect a model to ask questions about your data. You bring the key; your provider bills you directly." />
      <div className="space-y-5">
        {p.can("admin") && q.data && (!providers.length || showAdd || justConnected) && (
          <Section title={justConnected ? "Model connected" : providers.length ? "Add another model" : "Connect a model"}>
            <div className="px-5 pb-5 pt-1">
              <ConnectAI
                onConnected={() => {
                  setJustConnected(true);
                  setShowAdd(false);
                  void refresh();
                }}
              />
            </div>
          </Section>
        )}
        {providers.length > 0 && (
        <Section
          title="Connected models"
          actions={
            p.can("admin") && !showAdd && !justConnected ? (
              <Button size="sm" onClick={() => setShowAdd(true)}>
                Add another
              </Button>
            ) : undefined
          }
        >
          <ul className="divide-y divide-line">
            {providers.map((x) => (
              <ProviderRow key={x.id} x={x} onChange={refresh} />
            ))}
          </ul>
        </Section>
        )}
        {p.can("admin") && q.data && (
          <details className="group rounded-xl border border-line bg-panel shadow-card">
            <summary className="cursor-pointer select-none px-5 py-3.5 text-[13px] font-medium text-ink-2 hover:text-ink">Other providers — OpenRouter or a custom endpoint</summary>
            <div className="border-t border-line">
              <AddProvider catalog={q.data.catalog} onDone={refresh} />
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
