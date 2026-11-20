"use client";
import type { TrendResult } from "@hostpog/contracts";
import {
  ArrowUp,
  FlaskConical,
  MessageSquareText,
  RotateCcw,
  Sparkles,
  ToggleRight,
  Workflow,
  X,
} from "lucide-react";
import Link from "next/link";
import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { TrendView } from "./insight-views";
import { useProject } from "./project-context";
import { Button, cx, Kbd } from "./ui";
import { ApiError, apiSend } from "@/lib/api";

type Card =
  | { type: "trend"; title: string; result: TrendResult }
  | {
      type: "created";
      kind: "flag" | "experiment" | "survey" | "workflow";
      name: string;
      href: string;
      note?: string;
    };
type Msg = {
  role: "user" | "assistant";
  content: string;
  cards?: Card[];
  error?: boolean;
  needsProvider?: boolean;
};

const OPEN_EVENT = "hostpog:assistant";

/** Open the assistant from anywhere, optionally with a question typed in (or sent right away with `send`). */
export function openAssistant(prompt?: string, opts: { send?: boolean } = {}) {
  window.dispatchEvent(
    new CustomEvent(OPEN_EVENT, { detail: { prompt, send: opts.send } }),
  );
}

const SUGGESTIONS = [
  "How many signups did we get this week compared to last week?",
  "Where do people drop off between signup and activation?",
  "Create a flag for the new onboarding, rolled out to 20% of users",
  "Make a survey asking how disappointed people would be if they could no longer use the product",
];

const KIND_ICON = {
  flag: ToggleRight,
  experiment: FlaskConical,
  survey: MessageSquareText,
  workflow: Workflow,
} as const;

function storageKey(projectId: string) {
  return `hostpog.assistant.${projectId}`;
}

export function Assistant() {
  const p = useProject();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  // conversation survives navigation and reloads within this tab
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey(p.projectId));
      setMsgs(raw ? (JSON.parse(raw) as Msg[]) : []);
    } catch {
      setMsgs([]);
    }
  }, [p.projectId]);
  useEffect(() => {
    try {
      sessionStorage.setItem(
        storageKey(p.projectId),
        JSON.stringify(msgs.slice(-30)),
      );
    } catch {
      /* storage unavailable */
    }
    scroller.current?.scrollTo({
      top: scroller.current.scrollHeight,
      behavior: "smooth",
    });
  }, [msgs, p.projectId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen((x) => !x);
      }
      if (e.key === "Escape") setOpen(false);
    };
    const onOpen = (e: Event) => {
      setOpen(true);
      const d = (e as CustomEvent<{ prompt?: string; send?: boolean }>).detail;
      if (d?.prompt && d.send) setQueued(d.prompt);
      else if (d?.prompt) setDraft(d.prompt);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);
  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 0);
  }, [open]);

  const send = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || busy) return;
      const history: Msg[] = [
        ...msgs.filter((m) => !m.error),
        { role: "user", content: q },
      ];
      setMsgs([...msgs, { role: "user", content: q }]);
      setDraft("");
      setBusy(true);
      try {
        const r = await apiSend<{ reply: string; cards: Card[] }>(
          `/api/v1/projects/${p.projectId}/assistant`,
          "POST",
          {
            messages: history
              .slice(-20)
              .map((m) => ({ role: m.role, content: m.content })),
            ...(p.sourceId ? { sourceId: p.sourceId } : {}),
          },
        );
        setMsgs((m) => [
          ...m,
          { role: "assistant", content: r.reply, cards: r.cards },
        ]);
      } catch (e) {
        const needsProvider =
          e instanceof ApiError && e.code === "no_ai_provider";
        setMsgs((m) => [
          ...m,
          {
            role: "assistant",
            content: (e as Error).message,
            error: true,
            needsProvider,
          },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [busy, msgs, p.projectId, p.sourceId],
  );

  // a question handed over from elsewhere (the home prompt box) is sent once the panel is ready
  useEffect(() => {
    if (queued && !busy) {
      setQueued(null);
      void send(queued);
    }
  }, [queued, busy, send]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((x) => !x)}
        aria-expanded={open}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 text-[13px] font-medium text-ink hover:bg-panel-2"
      >
        <Sparkles size={14} className="text-brand" aria-hidden />
        <span className="hidden sm:inline">Ask AI</span>
        <Kbd>⌘J</Kbd>
      </button>

      {open &&
        createPortal(
          <aside
            role="dialog"
            aria-label="AI assistant"
            className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-line bg-canvas shadow-2xl sm:w-[440px]"
          >
            <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-4">
              <Sparkles size={16} className="text-brand" aria-hidden />
              <p className="text-[14px] font-semibold">Assistant</p>
              <span className="truncate text-[12px] text-ink-3">
                {p.projectName}
              </span>
              <div className="ml-auto flex items-center gap-1">
                {msgs.length > 0 && (
                  <button
                    type="button"
                    aria-label="New conversation"
                    title="New conversation"
                    onClick={() => setMsgs([])}
                    className="inline-flex size-8 items-center justify-center rounded-lg text-ink-2 hover:bg-panel-2"
                  >
                    <RotateCcw size={15} />
                  </button>
                )}
                <button
                  type="button"
                  aria-label="Close assistant"
                  onClick={() => setOpen(false)}
                  className="inline-flex size-8 items-center justify-center rounded-lg text-ink-2 hover:bg-panel-2"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div
              ref={scroller}
              className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4"
            >
              {msgs.length === 0 && (
                <div className="space-y-3 pt-2">
                  <p className="text-[13px] text-ink-2">
                    Ask about your data, or have it set up a flag, experiment,
                    survey or workflow. Anything it creates starts switched off
                    for you to review.
                  </p>
                  <div className="space-y-1.5">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => send(s)}
                        className="block w-full rounded-lg border border-line px-3 py-2 text-left text-[13px] text-ink hover:bg-panel-2"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {msgs.map((m, i) =>
                m.role === "user" ? (
                  <div
                    key={i}
                    className="ml-8 rounded-xl bg-panel-2 px-3 py-2 text-[13px]"
                  >
                    {m.content}
                  </div>
                ) : (
                  <div
                    key={i}
                    className="space-y-2 text-[13px] leading-relaxed"
                  >
                    <div className={cx(m.error && "text-neg")}>
                      <Markdown text={m.content} />
                    </div>
                    {m.needsProvider && (
                      <Link
                        href={p.href("settings/ai")}
                        onClick={() => setOpen(false)}
                      >
                        <Button size="sm">Open AI settings</Button>
                      </Link>
                    )}
                    {m.cards?.map((c, j) =>
                      c.type === "created" ? (
                        <CreatedCard
                          key={j}
                          card={c}
                          onOpen={() => setOpen(false)}
                        />
                      ) : (
                        <div
                          key={j}
                          className="rounded-xl border border-line bg-panel p-3"
                        >
                          <p className="mb-1 truncate text-[12px] font-medium text-ink-2">
                            {c.title}
                          </p>
                          <TrendView result={c.result} height={160} />
                        </div>
                      ),
                    )}
                  </div>
                ),
              )}
              {busy && (
                <div
                  className="flex items-center gap-2 text-[13px] text-ink-3"
                  role="status"
                >
                  <span className="size-2 animate-pulse rounded-full bg-brand" />
                  Looking at your data…
                </div>
              )}
            </div>

            <form
              className="shrink-0 border-t border-line p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void send(draft);
              }}
            >
              <div className="flex items-end gap-2 rounded-xl border border-line bg-panel p-2 focus-within:border-brand">
                <textarea
                  ref={input}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send(draft);
                    }
                  }}
                  rows={Math.min(5, Math.max(1, draft.split("\n").length))}
                  placeholder="Ask anything about this project"
                  aria-label="Message"
                  className="min-h-[24px] flex-1 resize-none bg-transparent px-1 text-[13px] outline-none placeholder:text-ink-3 focus-visible:outline-none"
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={!draft.trim() || busy}
                  aria-label="Send"
                >
                  <ArrowUp size={14} />
                </Button>
              </div>
            </form>
          </aside>,
          document.body,
        )}
    </>
  );
}

function CreatedCard({
  card,
  onOpen,
}: {
  card: Extract<Card, { type: "created" }>;
  onOpen: () => void;
}) {
  const Icon = KIND_ICON[card.kind];
  return (
    <Link
      href={card.href}
      onClick={onOpen}
      className="flex items-center gap-3 rounded-xl border border-line bg-panel px-3 py-2.5 hover:bg-panel-2"
    >
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-deep">
        <Icon size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{card.name}</span>
        <span className="block text-[12px] capitalize text-ink-3">
          {card.kind}
          {card.note ? ` · ${card.note}` : ""}
        </span>
      </span>
      <span className="text-[12px] font-medium text-brand-deep">Review</span>
    </Link>
  );
}

/** Small, safe markdown subset for replies: paragraphs, bullet/numbered lists, **bold**, `code`. */
function Markdown({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-2">
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l))) {
          const ordered = /^\s*\d+\./.test(lines[0]!);
          const items = lines.map((l, j) => (
            <li key={j}>{inline(l.replace(/^\s*([-*]|\d+\.)\s+/, ""))}</li>
          ));
          return ordered ? (
            <ol key={i} className="list-decimal space-y-0.5 pl-5">
              {items}
            </ol>
          ) : (
            <ul key={i} className="list-disc space-y-0.5 pl-5">
              {items}
            </ul>
          );
        }
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(l.replace(/^#+\s*/, ""))}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function inline(s: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i} className="font-semibold">
        {part.slice(2, -2)}
      </strong>
    ) : part.startsWith("`") && part.endsWith("`") ? (
      <code key={i} className="rounded bg-panel-2 px-1 font-mono text-[12px]">
        {part.slice(1, -1)}
      </code>
    ) : (
      part
    ),
  );
}
