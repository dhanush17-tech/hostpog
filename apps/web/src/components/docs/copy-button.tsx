"use client";
import { Check, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Copies `text`; confirms in place for 2 s. Falls back to selecting nothing silently is avoided — errors are shown. */
export function CopyButton({ text, label = "Copy", className, icon }: { text: string; label?: string; className?: string; icon?: ReactNode }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setState("copied");
        } catch {
          setState("failed");
        }
        setTimeout(() => setState("idle"), 2000);
      }}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-panel px-3 text-[13px] font-medium text-ink shadow-card transition hover:bg-panel-2",
        className,
      )}
      aria-live="polite"
    >
      {state === "copied" ? <Check size={14} className="text-pos" aria-hidden /> : (icon ?? <Copy size={14} aria-hidden />)}
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed — select the text instead" : label}
    </button>
  );
}

/** Code block with a copy button in the corner. */
export function CopyBlock({ code }: { code: string }) {
  return (
    <div className="relative mt-3">
      <pre className="!mt-0 pr-24">
        <code>{code}</code>
      </pre>
      <CopyButton text={code} className="absolute right-2 top-2 h-7 px-2 text-[12px]" />
    </div>
  );
}
