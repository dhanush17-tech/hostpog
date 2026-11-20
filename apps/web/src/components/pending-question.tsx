"use client";
import { MessageSquareText, X } from "lucide-react";
import { usePendingQuestion } from "@/lib/pending-question";

/** Reminds the user of the question they asked before signing up, with a way to drop it. */
export function PendingQuestionBanner({ lead }: { lead: string }) {
  const [q, dismiss] = usePendingQuestion();
  if (!q) return null;
  return (
    <div className="mb-8 flex items-start gap-3 rounded-xl border border-line bg-panel px-4 py-3 shadow-card">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-deep">
        <MessageSquareText size={15} aria-hidden />
      </span>
      <div className="min-w-0 flex-1 text-[13px]">
        <p className="text-ink-3">{lead}</p>
        <p className="mt-0.5 font-medium">“{q}”</p>
      </div>
      <button onClick={dismiss} aria-label="Forget this question" title="Forget this question" className="flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-3 hover:bg-panel-2 hover:text-ink">
        <X size={15} />
      </button>
    </div>
  );
}
