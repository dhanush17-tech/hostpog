"use client";
import {
  Activity,
  ArrowRightLeft,
  BarChart3,
  Bot,
  BrainCircuit,
  CalendarDays,
  Check,
  ChevronsUpDown,
  Code2,
  Database,
  Filter,
  FlaskConical,
  Gauge,
  Globe,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  ListTree,
  LogOut,
  Menu,
  MessageSquareText,
  Monitor,
  Moon,
  MousePointerClick,
  PlugZap,
  Plus,
  Repeat,
  ScrollText,
  Search,
  Settings2,
  Sparkles,
  Sun,
  ToggleRight,
  TrendingUp,
  Users,
  Video,
  Workflow,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { RANGES } from "@/lib/format";
import { Mark } from "./brand";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./primitives/dropdown-menu";
import { TooltipProvider } from "./primitives/tooltip";
import { Assistant, openAssistant } from "./assistant";
import { showSetupGuide } from "./setup-guide";
import { useProject, type SourceInfo } from "./project-context";
import { cx, Kbd } from "./ui";

interface NavItem {
  path: string;
  label: string;
  icon: typeof Activity;
}
const NAV: { group: string | null; items: NavItem[] }[] = [
  {
    group: null,
    items: [
      { path: "overview", label: "Overview", icon: Gauge },
      { path: "investigations", label: "Investigations", icon: Sparkles },
      { path: "dashboards", label: "Dashboards", icon: LayoutDashboard },
    ],
  },
  {
    group: "Product analytics",
    items: [
      { path: "trends", label: "Trends", icon: TrendingUp },
      { path: "funnels", label: "Funnels", icon: Filter },
      { path: "retention", label: "Retention", icon: Repeat },
      { path: "web", label: "Web analytics", icon: Globe },
      { path: "llm", label: "LLM analytics", icon: BrainCircuit },
    ],
  },
  {
    group: "Ship",
    items: [
      { path: "flags", label: "Feature flags", icon: ToggleRight },
      { path: "experiments", label: "Experiments", icon: FlaskConical },
      { path: "surveys", label: "Surveys", icon: MessageSquareText },
      { path: "workflows", label: "Workflows", icon: Workflow },
    ],
  },
  {
    group: "Data",
    items: [
      { path: "events", label: "Events", icon: ListTree },
      { path: "users", label: "People", icon: Users },
      { path: "sessions", label: "Sessions", icon: Video },
      { path: "logs", label: "Logs", icon: ScrollText },
    ],
  },
  {
    group: "Configure",
    items: [
      { path: "settings/integrations", label: "Integrations", icon: PlugZap },
      { path: "settings/sdk", label: "SDK & keys", icon: Code2 },
      { path: "settings/ai", label: "AI providers", icon: Bot },
      { path: "migrate", label: "Migrate from PostHog", icon: ArrowRightLeft },
      { path: "settings/team", label: "Team", icon: KeyRound },
      { path: "settings/usage", label: "Usage", icon: Database },
      { path: "settings/project", label: "Project settings", icon: Settings2 },
    ],
  },
];

const ALL_ITEMS = NAV.flatMap((g) => g.items);

/** Human label for a data source, without internal qualifiers. */
export function sourceName(s: Pick<SourceInfo, "kind" | "label">) {
  if (s.kind === "demo") return "Sample data";
  return s.label.replace(/\s*\((synthetic|demo)\)\s*/i, "").trim();
}

const SOURCE_DOT: Record<SourceInfo["kind"], string> = {
  posthog: "bg-[#1d4aff]",
  native: "bg-brand",
  imported: "bg-[var(--chart-3)]",
  demo: "bg-[var(--chart-2)]",
};

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
}

function ProjectSwitcher({
  workspaces,
}: {
  workspaces: {
    id: string;
    name: string;
    projects: { id: string; name: string }[];
  }[];
}) {
  const p = useProject();
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left outline-none hover:bg-panel-2 data-[state=open]:bg-panel-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-ink text-[12px] font-semibold text-canvas">
          {initials(p.projectName)}
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[13px] font-semibold">
            {p.projectName}
          </span>
          <span className="block truncate text-[11px] text-ink-3">
            {p.workspaceName}
          </span>
        </span>
        <ChevronsUpDown size={14} className="shrink-0 text-ink-3" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[232px]">
        {workspaces.map((w) => (
          <div key={w.id}>
            <DropdownMenuLabel>{w.name}</DropdownMenuLabel>
            {w.projects.map((pr) => (
              <DropdownMenuItem
                key={pr.id}
                onSelect={() => router.push(`/app/p/${pr.id}/overview`)}
              >
                <span className="flex size-5 items-center justify-center rounded-md border border-line text-[10px] font-semibold">
                  {initials(pr.name)}
                </span>
                <span className="truncate">{pr.name}</span>
                {pr.id === p.projectId && (
                  <Check size={14} className="ml-auto" />
                )}
              </DropdownMenuItem>
            ))}
          </div>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push("/app/onboarding")}>
          <Plus size={14} /> New project
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ThemeItems() {
  const [mode, setMode] = useState<"light" | "dark" | "system">("system");
  useEffect(
    () =>
      setMode(
        (localStorage.getItem("hostpog-theme") as
          "light" | "dark" | "system") ?? "system",
      ),
    [],
  );
  const set = (m: "light" | "dark" | "system") => {
    localStorage.setItem("hostpog-theme", m);
    setMode(m);
    const dark =
      m === "dark" ||
      (m === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  };
  return (
    <div className="flex items-center justify-between px-2 py-1.5 text-[13px]">
      <span>Theme</span>
      <div className="inline-flex rounded-md bg-panel-2 p-0.5">
        {(
          [
            ["light", Sun],
            ["dark", Moon],
            ["system", Monitor],
          ] as const
        ).map(([m, I]) => (
          <button
            key={m}
            aria-label={`${m} theme`}
            onClick={() => set(m)}
            className={cx(
              "flex size-6 items-center justify-center rounded",
              mode === m
                ? "bg-panel text-ink shadow-card"
                : "text-ink-3 hover:text-ink",
            )}
          >
            <I size={13} />
          </button>
        ))}
      </div>
    </div>
  );
}

function UserMenu({ user }: { user: { name: string; email: string } }) {
  const p = useProject();
  const router = useRouter();
  const signOut = async () => {
    await fetch("/api/auth/sign-out", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    router.push("/login");
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left outline-none hover:bg-panel-2 data-[state=open]:bg-panel-2"
        aria-label="Account menu"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#ffb07a] to-[#f26a12] text-[12px] font-semibold text-white">
          {initials(user.name)}
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[13px] font-medium">
            {user.name}
          </span>
          <span className="block truncate text-[11px] text-ink-3">
            {user.email}
          </span>
        </span>
        <ChevronsUpDown size={14} className="shrink-0 text-ink-3" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-[232px]">
        <DropdownMenuLabel className="text-[12px] font-normal">
          {user.email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => router.push(p.href("settings/project"))}
        >
          <Settings2 size={14} /> Settings
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => router.push(p.href("settings/team"))}>
          <Users size={14} /> Team
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            showSetupGuide(p.projectId);
            router.push(p.href("overview"));
            router.refresh();
          }}
        >
          <ListChecks size={14} /> Setup guide
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <ThemeItems />
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut}>
          <LogOut size={14} /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Sidebar({
  workspaces,
  user,
  onNavigate,
  onSearch,
}: {
  workspaces: Parameters<typeof ProjectSwitcher>[0]["workspaces"];
  user: { name: string; email: string };
  onNavigate?: () => void;
  onSearch: () => void;
}) {
  const p = useProject();
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2 px-4">
        <Link
          href={p.href("overview")}
          className="inline-flex items-center gap-2"
          aria-label="HostPog home"
          onClick={onNavigate}
        >
          <Mark size={22} />
          <span className="text-[15px] font-semibold tracking-tight">
            hostpog
          </span>
        </Link>
      </div>
      <div className="px-2.5">
        <ProjectSwitcher workspaces={workspaces} />
        <button
          onClick={onSearch}
          className="mt-2 flex h-8 w-full items-center gap-2 rounded-lg border border-line bg-panel px-2.5 text-[13px] text-ink-3 shadow-card hover:text-ink"
        >
          <Search size={14} aria-hidden /> Search
          <span className="ml-auto">
            <Kbd>⌘K</Kbd>
          </span>
        </button>
      </div>
      <nav
        aria-label="Product"
        className="mt-3 flex-1 space-y-5 overflow-y-auto px-2.5 pb-4"
      >
        {NAV.map((g) => (
          <div key={g.group ?? "top"}>
            {g.group && (
              <p className="mb-1 px-2 text-[11px] font-medium text-ink-3">
                {g.group}
              </p>
            )}
            <ul className="space-y-0.5">
              {g.items.map((it) => {
                const active = pathname.startsWith(
                  `/app/p/${p.projectId}/${it.path}`,
                );
                const Icon = it.icon;
                return (
                  <li key={it.path}>
                    <Link
                      href={p.href(it.path)}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cx(
                        "flex h-8 items-center gap-2.5 rounded-lg px-2 text-[13px] transition-colors",
                        active
                          ? "bg-panel font-medium text-ink shadow-card ring-1 ring-line"
                          : "text-ink-2 hover:bg-panel-2 hover:text-ink",
                      )}
                    >
                      <Icon
                        size={16}
                        aria-hidden
                        className={active ? "text-brand" : "text-ink-3"}
                      />
                      {it.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-line p-2.5">
        <UserMenu user={user} />
      </div>
    </div>
  );
}

function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const p = useProject();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const items = useMemo(
    () =>
      NAV.flatMap((g) =>
        g.items.map((it) => ({ ...it, group: g.group ?? "Navigate" })),
      )
        .concat([
          {
            path: "#assistant",
            label: "Ask AI",
            icon: Sparkles,
            group: "Actions",
          },
          {
            path: "flags/new",
            label: "New feature flag",
            icon: ToggleRight,
            group: "Actions",
          },
          {
            path: "surveys/new",
            label: "New survey",
            icon: MessageSquareText,
            group: "Actions",
          },
          {
            path: "investigations?new=1",
            label: "New investigation",
            icon: Sparkles,
            group: "Actions",
          },
          {
            path: "settings/integrations",
            label: "Connect a data source",
            icon: PlugZap,
            group: "Actions",
          },
        ])
        .filter((it) =>
          `${it.group} ${it.label}`.toLowerCase().includes(q.toLowerCase()),
        ),
    [q],
  );
  useEffect(() => {
    if (open) {
      setQ("");
      setI(0);
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]);
  if (!open) return null;
  const go = (path: string) => {
    onClose();
    if (path === "#assistant") return openAssistant();
    router.push(`/app/p/${p.projectId}/${path}`);
  };
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[14vh] backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-line bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Search size={16} className="text-ink-3" aria-hidden />
          <input
            ref={input}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setI(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown")
                setI((x) => Math.min(x + 1, items.length - 1));
              if (e.key === "ArrowUp") setI((x) => Math.max(x - 1, 0));
              if (e.key === "Enter" && items[i]) go(items[i].path);
            }}
            placeholder="Search pages and actions…"
            aria-label="Search commands"
            className="h-12 flex-1 bg-transparent text-[14px] outline-none"
          />
          <Kbd>esc</Kbd>
        </div>
        <ul role="listbox" className="max-h-80 overflow-auto p-1.5">
          {items.map((it, idx) => (
            <li
              key={it.path + it.label}
              role="option"
              aria-selected={idx === i}
            >
              <button
                onMouseEnter={() => setI(idx)}
                onClick={() => go(it.path)}
                className={cx(
                  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px]",
                  idx === i && "bg-panel-2",
                )}
              >
                <it.icon size={16} className="text-ink-3" aria-hidden />
                {it.label}
                <span className="ml-auto text-[11px] text-ink-3">
                  {it.group}
                </span>
              </button>
            </li>
          ))}
          {!items.length && (
            <li className="px-3 py-3 text-[13px] text-ink-3">No matches</li>
          )}
        </ul>
      </div>
    </div>
  );
}

function SourcePicker() {
  const p = useProject();
  if (!p.sources.length || !p.source) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex h-8 max-w-[220px] items-center gap-2 rounded-lg border border-line bg-panel px-2.5 text-[13px] shadow-card outline-none hover:bg-panel-2"
        aria-label="Data source"
      >
        <span
          className={cx(
            "size-2 shrink-0 rounded-full",
            p.source.status === "error" ? "bg-neg" : SOURCE_DOT[p.source.kind],
          )}
          aria-hidden
        />
        <span className="truncate">{sourceName(p.source)}</span>
        <ChevronsUpDown size={13} className="shrink-0 text-ink-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[240px]">
        <DropdownMenuLabel>Data source</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={p.sourceId ?? ""}
          onValueChange={p.setSourceId}
        >
          {p.sources.map((s) => (
            <DropdownMenuRadioItem key={s.id} value={s.id}>
              <span className="truncate">{sourceName(s)}</span>
              {s.status === "error" && (
                <span className="ml-auto text-[11px] text-neg">error</span>
              )}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={p.href("settings/integrations")}>
            <Plus size={14} /> Add source
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RangePicker() {
  const p = useProject();
  const label = RANGES.find((r) => r.value === p.range)?.label ?? p.range;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex h-8 items-center gap-2 rounded-lg border border-line bg-panel px-2.5 text-[13px] shadow-card outline-none hover:bg-panel-2"
        aria-label="Date range"
      >
        <CalendarDays size={14} className="text-ink-3" aria-hidden />
        <span className="whitespace-nowrap">{label}</span>
        <ChevronsUpDown size={13} className="text-ink-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[180px]">
        <DropdownMenuRadioGroup value={p.range} onValueChange={p.setRange}>
          {RANGES.map((r) => (
            <DropdownMenuRadioItem key={r.value} value={r.value}>
              {r.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const UserCtx = createContext<{ name: string; email: string } | null>(null);
/** The signed-in user, inside the app shell. */
export function useCurrentUser() {
  return useContext(UserCtx);
}

export function Shell({
  children,
  workspaces,
  user,
}: {
  children: ReactNode;
  workspaces: {
    id: string;
    name: string;
    projects: { id: string; name: string }[];
  }[];
  user: { name: string; email: string };
}) {
  const p = useProject();
  const pathname = usePathname();
  const [palette, setPalette] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((x) => !x);
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  const current = ALL_ITEMS.find((it) =>
    pathname.startsWith(`/app/p/${p.projectId}/${it.path}`),
  );

  return (
    <UserCtx.Provider value={user}>
      <TooltipProvider>
        <div className="min-h-screen bg-canvas">
          <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] border-r border-line bg-canvas md:block">
            <Sidebar
              workspaces={workspaces}
              user={user}
              onSearch={() => setPalette(true)}
            />
          </aside>
          {mobileNav && (
            <div
              className="fixed inset-0 z-50 md:hidden"
              role="dialog"
              aria-modal="true"
              aria-label="Navigation"
            >
              <button
                className="absolute inset-0 bg-black/40"
                aria-label="Close navigation"
                onClick={() => setMobileNav(false)}
              />
              <div className="relative h-full w-[272px] border-r border-line bg-canvas shadow-2xl">
                <button
                  aria-label="Close navigation"
                  className="absolute right-2 top-3 z-10 inline-flex size-8 items-center justify-center rounded-lg hover:bg-panel-2"
                  onClick={() => setMobileNav(false)}
                >
                  <X size={18} />
                </button>
                <Sidebar
                  workspaces={workspaces}
                  user={user}
                  onNavigate={() => setMobileNav(false)}
                  onSearch={() => {
                    setMobileNav(false);
                    setPalette(true);
                  }}
                />
              </div>
            </div>
          )}
          <div className="md:pl-[248px]">
            <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-canvas/85 px-3 backdrop-blur-md md:px-6">
              <button
                className="inline-flex size-8 items-center justify-center rounded-lg hover:bg-panel-2 md:hidden"
                aria-label="Open navigation"
                onClick={() => setMobileNav(true)}
              >
                <Menu size={18} />
              </button>
              <nav
                aria-label="Breadcrumb"
                className="hidden min-w-0 items-center gap-1.5 text-[13px] sm:flex"
              >
                <span className="truncate text-ink-3">{p.projectName}</span>
                {current && (
                  <>
                    <span className="text-line-strong">/</span>
                    <span className="truncate font-medium">
                      {current.label}
                    </span>
                  </>
                )}
              </nav>
              <div className="ml-auto flex items-center gap-2">
                <Assistant />
                <span className="hidden sm:inline-flex">
                  <SourcePicker />
                </span>
                <RangePicker />
              </div>
            </header>
            <main id="main" className="min-w-0 px-4 py-6 md:px-8 md:py-8">
              {children}
            </main>
          </div>
          <CommandPalette open={palette} onClose={() => setPalette(false)} />
        </div>
      </TooltipProvider>
    </UserCtx.Provider>
  );
}

export { BarChart3, MousePointerClick };
