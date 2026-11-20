"use client";
import { Link2, Trash2, UserMinus } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CopyButton } from "@/components/docs/copy-button";
import { useProject } from "@/components/project-context";
import { RowMenu } from "@/components/row-menu";
import { Badge, Button, ErrorBox, Input, PageHeader, Section, Select, Table, Td, Th } from "@/components/ui";
import { apiGet, apiSend } from "@/lib/api";

const ROLES = ["viewer", "member", "admin", "owner"] as const;
const ROLE_HINT: Record<string, string> = {
  viewer: "sees everything, changes nothing",
  member: "builds charts, flags, surveys, asks AI",
  admin: "also manages data sources, AI keys and people",
};

interface Member {
  userId: string;
  name: string;
  email: string;
  role: string;
}
interface Invite {
  id: string;
  email: string | null;
  role: string;
  expiresAt: string;
  uses: number;
  open: boolean;
}
function expiresIn(iso: string) {
  const h = Math.max(0, (new Date(iso).getTime() - Date.now()) / 3_600_000);
  return h >= 24 ? `${Math.round(h / 24)} d` : `${Math.max(1, Math.round(h))} h`;
}

type Created = { added: true; email: string } | { added: false; url: string; invite: Invite };

export default function Team() {
  const p = useProject();
  const qc = useQueryClient();
  const base = `/api/v1/workspaces/${p.workspaceId}`;
  const admin = p.can("admin");
  const members = useQuery({ queryKey: ["members", p.workspaceId], queryFn: () => apiGet<{ members: Member[] }>(`${base}/members`) });
  const invites = useQuery({ queryKey: ["invites", p.workspaceId], queryFn: () => apiGet<{ invites: Invite[] }>(`${base}/invites`), enabled: admin });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["members", p.workspaceId] }), qc.invalidateQueries({ queryKey: ["invites", p.workspaceId] })]);
  const run = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const invite = async (withEmail: boolean) => {
    setBusy(true);
    setCreated(null);
    await run(async () => {
      const r = await apiSend<Created>(`${base}/invites`, "POST", { email: withEmail ? email.trim() : "", role });
      setCreated(r);
      if (withEmail) setEmail("");
    });
    setBusy(false);
  };
  const pending = invites.data?.invites ?? [];

  return (
    <div className="mx-auto max-w-[900px] space-y-5">
      <PageHeader title="Team" description={`Everyone in ${p.workspaceName} shares its projects, data sources, dashboards and AI setup. Teammates don't set anything up.`} />
      {err && <ErrorBox error={err} />}

      {admin && (
        <Section title="Invite teammates">
          <div className="space-y-4 p-4 pt-1">
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void invite(true);
              }}
            >
              <Input aria-label="Teammate email" type="email" placeholder="teammate@company.com" className="w-[280px]" value={email} onChange={(e) => setEmail(e.target.value)} />
              <Select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)}>
                {ROLES.filter((r) => r !== "owner" && (r !== "admin" || p.can("owner"))).map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
              <Button type="submit" variant="primary" loading={busy} disabled={!email.trim()}>
                Invite
              </Button>
              <span className="text-[12px] text-ink-3">{ROLE_HINT[role]}</span>
            </form>
            <p className="text-[13px] text-ink-2">
              Or{" "}
              <button type="button" className="font-medium text-ink underline underline-offset-2" onClick={() => void invite(false)} disabled={busy}>
                create a link anyone on your team can use
              </button>{" "}
              to join as {role}. It works for 7 days; post it in your team chat.
            </p>

            {created &&
              (created.added ? (
                <p className="rounded-lg bg-panel-2 px-3 py-2 text-[13px]">
                  <span className="font-medium">{created.email}</span> already had a HostPog account and is now a member.
                </p>
              ) : (
                <div className="rounded-xl border border-line bg-panel-2 p-3">
                  <p className="text-[13px] font-medium">
                    {created.invite.email ? `Send this link to ${created.invite.email}` : "Team invite link"} <span className="font-normal text-ink-3">· shown once, works for 7 days</span>
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-panel px-2.5 py-1.5 font-mono text-[12px]">{created.url}</code>
                    <CopyButton text={created.url} label="Copy link" />
                  </div>
                  <p className="mt-2 text-[12px] text-ink-3">
                    {created.invite.email ? "Only that email can use it, once." : "Anyone with the link joins this workspace as " + created.invite.role + ". Revoke it below when you're done."}
                  </p>
                </div>
              ))}
          </div>
        </Section>
      )}

      <Section title={`Members${members.data ? ` (${members.data.members.length})` : ""}`}>
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Role</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {(members.data?.members ?? []).map((m) => (
              <tr key={m.userId}>
                <Td>{m.name}</Td>
                <Td className="text-ink-2">{m.email}</Td>
                <Td>
                  {p.can("owner") && m.role !== "owner" ? (
                    <Select aria-label={`Role for ${m.email}`} value={m.role} onChange={(e) => run(() => apiSend(`${base}/members`, "PATCH", { userId: m.userId, role: e.target.value }))}>
                      {ROLES.map((r) => (
                        <option key={r}>{r}</option>
                      ))}
                    </Select>
                  ) : (
                    m.role
                  )}
                </Td>
                <Td className="text-right">
                  {admin && m.role !== "owner" && (
                    <RowMenu
                      label={`Actions for ${m.email}`}
                      items={[
                        {
                          label: "Remove from workspace",
                          icon: <UserMinus size={14} />,
                          danger: true,
                          onSelect: () => void (confirm(`Remove ${m.email} from the workspace?`) && run(() => apiSend(`${base}/members?userId=${m.userId}`, "DELETE"))),
                        },
                      ]}
                    />
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Section>

      {admin && pending.length > 0 && (
        <Section title="Pending invites">
          <ul className="divide-y divide-line">
            {pending.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-5 py-3 text-[13px]">
                <Link2 size={15} className="shrink-0 text-ink-3" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{i.email ?? "Team link"}</span> <Badge>{i.role}</Badge>
                  <span className="block text-[12px] text-ink-3">
                    Expires in {expiresIn(i.expiresAt)}
                    {i.open ? ` · used ${i.uses} ${i.uses === 1 ? "time" : "times"}` : ""}
                  </span>
                </span>
                <RowMenu
                  label={`Actions for invite ${i.email ?? "link"}`}
                  items={[{ label: "Revoke", icon: <Trash2 size={14} />, danger: true, onSelect: () => void run(() => apiSend(`${base}/invites?id=${i.id}`, "DELETE")) }]}
                />
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
