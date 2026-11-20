"use client";
import { ArrowUp, AtSign, ChevronDown, KeyRound, Mic, Paperclip, Slash, SlidersHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const PROMPTS = [
  "Why did signups drop last Tuesday?",
  "Which browser has the worst checkout conversion?",
  "Show weekly retention for users who invited a teammate",
  "What changed after the 2.4 release?",
  "Top referrers for the pricing page this month",
];

/** Hero prompt box. Typing animation for the placeholder; submitting sends you to sign-up with the question. */
export function AskBox() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [shown, setShown] = useState("");
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(PROMPTS[0]!);
      return;
    }
    let p = 0;
    let i = 0;
    let deleting = false;
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      const full = PROMPTS[p]!;
      if (!deleting) {
        i++;
        setShown(full.slice(0, i));
        if (i === full.length) {
          deleting = true;
          t = setTimeout(tick, 1800);
          return;
        }
        t = setTimeout(tick, 38 + Math.random() * 40);
      } else {
        i -= 2;
        setShown(full.slice(0, Math.max(0, i)));
        if (i <= 0) {
          deleting = false;
          p = (p + 1) % PROMPTS.length;
          t = setTimeout(tick, 350);
          return;
        }
        t = setTimeout(tick, 18);
      }
    };
    t = setTimeout(tick, 600);
    return () => clearTimeout(t);
  }, []);

  const submit = () => router.push(`/signup${value.trim() ? `?q=${encodeURIComponent(value.trim())}` : ""}`);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="mx-auto w-full max-w-[736px] rounded-[22px] border border-white/60 bg-white/75 p-3 text-left shadow-[0_24px_60px_-24px_rgb(30_60_90/0.45)] backdrop-blur-xl"
    >
      <label htmlFor="hero-ask" className="sr-only">
        Ask a question about your product
      </label>
      <div className="relative min-h-[64px] px-2 pt-1.5">
        <textarea
          id="hero-ask"
          rows={2}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          className="peer absolute inset-0 resize-none bg-transparent px-2 pt-1.5 text-[16px] leading-6 text-zinc-900 outline-none"
        />
        {!value && (
          <p aria-hidden className="pointer-events-none text-[16px] leading-6 text-zinc-500">
            {shown}
            <span className="typing-caret ml-px inline-block h-[18px] w-px translate-y-[3px] bg-zinc-400" />
          </p>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="flex items-center rounded-xl border border-zinc-200/80 bg-white/70 p-0.5 text-zinc-500">
          {[Paperclip, AtSign, Slash].map((I, i) => (
            <span key={i} className="flex size-7 items-center justify-center rounded-lg" aria-hidden>
              <I size={15} />
            </span>
          ))}
        </div>
        <span className="hidden h-8 items-center gap-1.5 rounded-xl border border-zinc-200/80 bg-white/70 px-2.5 text-[13px] text-zinc-600 sm:inline-flex" aria-hidden>
          <SlidersHorizontal size={14} /> Tools <ChevronDown size={14} className="text-zinc-400" />
        </span>
        <span className="ml-auto hidden items-center gap-1.5 text-[13px] text-zinc-500 sm:inline-flex" aria-hidden>
          <KeyRound size={14} /> Your AI key
        </span>
        <span className="flex size-8 items-center justify-center rounded-xl bg-zinc-100 text-zinc-500" aria-hidden>
          <Mic size={15} />
        </span>
        <button type="submit" aria-label="Ask" className="flex size-8 items-center justify-center rounded-xl bg-gradient-to-b from-[#ff9a52] to-[#f26a12] text-white shadow-[0_4px_12px_-4px_rgb(242_106_18/0.7)] transition hover:brightness-105">
          <ArrowUp size={16} />
        </button>
      </div>
    </form>
  );
}
