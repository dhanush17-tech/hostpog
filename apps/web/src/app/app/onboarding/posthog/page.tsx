"use client";
import { ArrowLeftRight, ArrowRight, CheckCircle2, ExternalLink, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PendingQuestionBanner } from "@/components/pending-question";
import { Mark } from "@/components/brand";
import { IntegrationLogo } from "@/components/integration-logo";
import { Badge, Button, ErrorBox, Field, Input, Segmented, Spinner } from "@/components/ui";
import { ApiError, apiGet, apiSend } from "@/lib/api";
import { usePendingQuestion } from "@/lib/pending-question";
import type { SourceInfo } from "@/components/project-context";
import { fmtInt } from "@/lib/format";

type Region = "us" | "eu" | "self_hosted";
interface DiscoveredProject {
  id: string;
  name: string;
  organizationName: string | null;
  timezone: string;
}
interface Discovery {
  projects: DiscoveredProject[];
  needsManualProject: boolean;
  warnings: string[];
  user: { email: string | null } | null;
}
interface ConnectResult {
  source: { id: string; label: string; region: string };
  scopes: { scope: string; ok: boolean; detail: string }[];
  firstResult: { result: { events: number; uniqueUsers: number; newUsers: number | null }; durationMs: number } | null;
  firstError: string | null;
  alreadyConnected?: boolean;
  connectedAt?: string;
  timeToFirstResultMs: number;
}

const CONNECT_STAGES = ["Verifying your key", "Checking read permissions", "Loading your last 7 days"];

const SCOPES = [
  { scope: "query:read", why: "run bounded analytics queries (required)" },
  { scope: "event_definition:read", why: "event name autocomplete" },
  { scope: "project:read", why: "list your projects" },
  { scope: "user:read", why: "find your organizations" },
  { scope: "person:read", why: "user profiles (optional)" },
  { scope: "session_recording:read", why: "links to recordings (optional)" },
  { scope: "insight:read", why: "read saved insights (optional)" },
];

export default function ConnectPostHog() {
  const sp = useSearchParams();
  const router = useRouter();
  const projectId = sp.get("project") ?? "";
  const oauthCredential = sp.get("oauth_credential");
  const [region, setRegion] = useState<Region>((sp.get("region") as Region) ?? "us");
  const [host, setHost] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [oauth, setOauth] = useState<{ available: boolean; reason: string | null } | null>(null);
  const [disc, setDisc] = useState<Discovery | null>(null);
  const [selected, setSelected] = useState("");
  const [manualId, setManualId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(sp.get("oauth_error"));
  const [result, setResult] = useState<ConnectResult | null>(null);
  const [unresolved, setUnresolved] = useState(false);
  const [pendingQuestion] = usePendingQuestion();

  useEffect(() => {
    if (!projectId) return;
    apiGet<{ available: boolean; reason: string | null }>(`/api/v1/projects/${projectId}/posthog/oauth/start`).then(setOauth).catch(() => setOauth({ available: false, reason: null }));
    if (oauthCredential) {
      setBusy("discover");
      apiSend<Discovery>(`/api/v1/projects/${projectId}/posthog/oauth/complete`, "POST", { credentialId: oauthCredential, region })
        .then((d) => {
          setDisc(d);
          setSelected(d.projects[0]?.id ?? "");
        })
        .catch((e) => setError(e.message))
        .finally(() => setBusy(null));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, oauthCredential]);

  const keyPageUrl =
    region === "self_hosted" ? (host.trim() ? `${host.trim().replace(/\/$/, "")}/settings/user-api-keys` : null) : `https://${region}.posthog.com/settings/user-api-keys`;

  const regionBody = { region, ...(region === "self_hosted" ? { host } : {}) };

  const discover = async () => {
    setError(null);
    setBusy("discover");
    try {
      const d = await apiSend<Discovery>(`/api/v1/projects/${projectId}/posthog/discover`, "POST", { ...regionBody, apiKey: apiKey.trim() });
      setDisc(d);
      setSelected(d.projects[0]?.id ?? "");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const connect = async () => {
    setError(null);
    setUnresolved(false);
    setBusy("connect");
    const externalProjectId = (disc?.needsManualProject ? manualId : selected).trim();
    try {
      const r = oauthCredential
        ? await apiSend<ConnectResult>(`/api/v1/projects/${projectId}/posthog/oauth/complete`, "POST", { credentialId: oauthCredential, region, externalProjectId })
        : await apiSend<ConnectResult>(`/api/v1/projects/${projectId}/posthog/connect`, "POST", { ...regionBody, apiKey: apiKey.trim(), externalProjectId });
      setResult(r);
      setApiKey("");
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
      } else {
        // No response: the connection may or may not have been created. Check before offering a retry.
        const found = await reconcile(externalProjectId);
        if (found) setResult(found);
        else setUnresolved(true);
      }
    } finally {
      setBusy(null);
    }
  };

  const reconcile = async (externalProjectId: string): Promise<ConnectResult | null> => {
    try {
      const r = await apiGet<{ sources: SourceInfo[] }>(`/api/v1/projects/${projectId}/sources`);
      const s = r.sources.find((x) => x.kind === "posthog" && x.status !== "disconnected" && (x.config as { externalProjectId?: string }).externalProjectId === externalProjectId);
      if (!s) return null;
      return { source: { id: s.id, label: s.label, region: "" }, scopes: [], firstResult: null, firstError: null, alreadyConnected: true, connectedAt: s.createdAt, timeToFirstResultMs: 0 };
    } catch {
      return null;
    }
  };

  const startOauth = async () => {
    setBusy("oauth");
    try {
      const r = await apiSend<{ authorizeUrl: string }>(`/api/v1/projects/${projectId}/posthog/oauth/start`, "POST", regionBody);
      window.location.href = r.authorizeUrl;
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  if (result) {
    const at = new Date(result.connectedAt ?? Date.now()).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const overview = `/app/p/${projectId}/overview?source=${result.source.id}`;
    return (
      <div>
        <div className="flex items-start gap-3 rounded-xl border border-line bg-panel p-4 shadow-card">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--pos)_12%,transparent)] text-pos">
            <CheckCircle2 size={17} aria-hidden />
          </span>
          <div className="text-[13px]">
            <p className="font-medium text-ink">
              {result.alreadyConnected ? "Already connected" : "Connected"} to {result.source.label.replace(/^PostHog · /, "")} at {at}
            </p>
            <p className="mt-0.5 text-ink-3">
              Read-only — nothing in your PostHog account was changed. Nothing else is needed: charts query PostHog live when you open them. You can disconnect any time in Integrations.
            </p>
          </div>
        </div>
        <h1 className="mt-8 text-[28px] font-semibold tracking-[-0.02em]">Your last 7 days</h1>
        {result.firstResult ? (
          <div className="mt-5 grid grid-cols-3 gap-3">
            {[
              ["Events", result.firstResult.result.events],
              ["Unique users", result.firstResult.result.uniqueUsers],
              ["New users", result.firstResult.result.newUsers],
            ].map(([k, v]) => (
              <div key={k as string} className="rounded-xl border border-line bg-panel p-4 shadow-card">
                <p className="text-[12px] font-medium text-ink-2">{k}</p>
                <p className="tnum mt-1 text-[24px] font-semibold tracking-tight">{fmtInt(v as number | null)}</p>
              </div>
            ))}
          </div>
        ) : result.firstError ? (
          <div className="mt-5">
            <ErrorBox error={`The connection is saved, but the first query failed: ${result.firstError}. Open the overview to try again.`} />
          </div>
        ) : (
          <p className="mt-2 text-[14px] text-ink-3">Your numbers are on the overview.</p>
        )}
        {result.scopes.some((x) => !x.ok) && (
          <p className="mt-4 text-[12px] text-ink-3">
            Optional permissions not granted: {result.scopes.filter((x) => !x.ok).map((x) => x.scope).join(", ")}. Everything else works; add them in PostHog any time.
          </p>
        )}
        <div className="mt-8 flex flex-wrap gap-2">
          {pendingQuestion ? (
            <Button variant="primary" onClick={() => router.push(`/app/p/${projectId}/investigations?source=${result.source.id}`)}>
              Answer my question <ArrowRight size={14} />
            </Button>
          ) : (
            <Button variant="primary" onClick={() => router.push(overview)}>
              Go to my dashboard <ArrowRight size={14} />
            </Button>
          )}
          {pendingQuestion && <Button onClick={() => router.push(overview)}>Go to my dashboard</Button>}
          <Button variant="ghost" onClick={() => router.push(`/app/p/${projectId}/migrate?start=1`)}>
            Plan a move off PostHog
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Link href={`/app/onboarding?project=${projectId}`} className="text-[13px] text-ink-3 hover:text-ink">
        ← Back
      </Link>
      <div className="mt-6">
        <PendingQuestionBanner lead="Once you're connected, we'll answer:" />
      </div>
      <div className="mt-4 flex items-center gap-2">
        <IntegrationLogo id="posthog" name="PostHog" />
        <ArrowLeftRight size={16} className="text-ink-3" aria-hidden />
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-panel"><Mark size={22} /></span>
      </div>
      <h1 className="mt-4 text-[28px] font-semibold tracking-[-0.02em]">Connect to PostHog</h1>
      <p className="mt-1.5 text-[14px] text-ink-3">See your PostHog data here in about a minute. Read-only — nothing in your app or PostHog changes.</p>

      <div className="mt-8 space-y-6">
        <div>
          <p className="mb-2 text-[12px] font-medium text-ink-2">Where is your PostHog?</p>
          <Segmented
            label="PostHog region"
            value={region}
            onChange={setRegion}
            options={[
              { value: "us", label: "US Cloud" },
              { value: "eu", label: "EU Cloud" },
              { value: "self_hosted", label: "Self-hosted" },
            ]}
          />
          {region === "self_hosted" && (
            <div className="mt-3 max-w-md">
              <Field label="Instance URL" hint="Your hostpog admin needs to allow this URL first.">
                {(id) => <Input id={id} placeholder="https://posthog.example.com" value={host} onChange={(e) => setHost(e.target.value)} />}
              </Field>
            </div>
          )}
        </div>

        {!disc && !oauthCredential && (
          <>
            {oauth?.available && region !== "self_hosted" && (
              <div className="rounded-xl border border-line bg-panel p-5 shadow-card">
                <p className="text-[14px] font-medium">Authorize with PostHog</p>
                <p className="mt-1 text-[13px] text-ink-2">Approve read-only access on PostHog. We never see your password.</p>
                <Button className="mt-3" variant="primary" loading={busy === "oauth"} onClick={startOauth}>
                  Continue to PostHog <ExternalLink size={14} />
                </Button>
              </div>
            )}
            <div className="rounded-xl border border-line bg-panel p-5 shadow-card">
              <p className="text-[14px] font-medium">{oauth?.available ? "Or use a personal API key" : "Use a scoped personal API key"}</p>
              {!oauth?.available && oauth?.reason && <p className="mt-1 text-[12px] text-ink-3">OAuth is not available on this instance: {oauth.reason}</p>}
              <ol className="mt-3 list-decimal space-y-1 pl-5 text-[13px] text-ink-2">
                <li>
                  Open PostHog&apos;s API key page and click <strong>Create personal API key</strong>.
                  {keyPageUrl && (
                    <a href={keyPageUrl} target="_blank" rel="noopener noreferrer" className="mt-2 flex w-fit items-center gap-1.5 rounded-md border border-line bg-panel px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-panel-2">
                      <KeyRound size={14} /> Get API key <ExternalLink size={12} className="text-ink-3" />
                    </a>
                  )}
                </li>
                <li>
                  Limit it to the project you want and grant <strong>read</strong> access only:
                  <ul className="mt-1 space-y-0.5">
                    {SCOPES.map((s) => (
                      <li key={s.scope} className="text-[12px]">
                        <code className="font-mono">{s.scope}</code> — {s.why}
                      </li>
                    ))}
                  </ul>
                </li>
                <li>Paste it below. We only use it to run read-only queries; it&apos;s encrypted and never shown again.</li>
              </ol>
              <div className="mt-4 max-w-md">
                <Field label="Personal API key" hint="Starts with phx_. Never paste your PostHog password.">
                  {(id) => <Input id={id} type="password" autoComplete="off" spellCheck={false} placeholder="phx_…" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />}
                </Field>
              </div>
              <Button className="mt-3" variant="primary" disabled={!apiKey.trim() || !projectId} loading={busy === "discover"} onClick={discover}>
                Find my projects
              </Button>
            </div>
          </>
        )}

        {busy === "discover" && !disc && <Spinner label="Asking PostHog which projects this credential can read…" />}

        {disc && (
          <div className="rounded-xl border border-line bg-panel p-5 shadow-card">
            <p className="text-[14px] font-medium">Choose a PostHog project</p>
            {disc.warnings.map((w) => (
              <p key={w} className="mt-1 text-[12px] text-warn">
                {w}
              </p>
            ))}
            {disc.needsManualProject ? (
              <div className="mt-3 max-w-xs">
                <Field label="PostHog project ID" hint="This key cannot list projects. Find the numeric ID in your PostHog project settings.">
                  {(id) => <Input id={id} inputMode="numeric" value={manualId} onChange={(e) => setManualId(e.target.value.replace(/\D/g, ""))} />}
                </Field>
              </div>
            ) : (
              <fieldset className="mt-3 divide-y divide-line rounded-md border border-line">
                <legend className="sr-only">PostHog project</legend>
                {disc.projects.map((p) => (
                  <label key={p.id} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-panel-2">
                    <input type="radio" name="php" value={p.id} checked={selected === p.id} onChange={() => setSelected(p.id)} />
                    <span className="text-[13px] font-medium">{p.name}</span>
                    <span className="text-[12px] text-ink-3">
                      {p.organizationName} · id {p.id} · {p.timezone}
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
            <div className="mt-4 flex items-center gap-3">
              <Button variant="primary" loading={busy === "connect"} disabled={!(disc.needsManualProject ? manualId : selected)} onClick={connect}>
                <ShieldCheck size={14} /> Connect read-only
              </Button>
            </div>
            {busy === "connect" && (
              <div role="status" className="mt-4 rounded-lg bg-panel-2 px-3.5 py-3 text-[13px]">
                <ul className="space-y-1.5">
                  {CONNECT_STAGES.map((st) => (
                    <li key={st} className="flex items-center gap-2 text-ink-2">
                      <Loader2 size={13} className="animate-spin text-ink-3" aria-hidden /> {st}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[12px] text-ink-3">Usually takes under 10 seconds.</p>
              </div>
            )}
            {unresolved && (
              <div role="alert" className="mt-4 rounded-lg border border-line px-3.5 py-3 text-[13px]">
                <p className="font-medium">We lost the connection before PostHog answered.</p>
                <p className="mt-0.5 text-ink-3">We checked and nothing was connected yet, so it&apos;s safe to try again — it won&apos;t create a duplicate.</p>
                <Button size="sm" className="mt-2" onClick={connect}>
                  Try again
                </Button>
              </div>
            )}
          </div>
        )}

        {error && <ErrorBox error={error} />}
      </div>
    </div>
  );
}
