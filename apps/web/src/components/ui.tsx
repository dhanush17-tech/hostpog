"use client";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { forwardRef, useEffect, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";

import { cn } from "@/lib/utils";
import { buttonVariants } from "./primitives/button";

export function cx(...c: (string | false | null | undefined)[]) {
  return cn(...c);
}

type Variant = "primary" | "secondary" | "ghost" | "danger";
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; loading?: boolean }>(
  function Button({ variant = "secondary", size = "md", loading, className, children, disabled, ...rest }, ref) {
    const v = ({ primary: "default", secondary: "secondary", ghost: "ghost", danger: "destructive" } as const)[variant];
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cx(buttonVariants({ variant: v, size: size === "sm" ? "sm" : "default" }), className)}
        {...rest}
      >
        {loading && <Loader2 size={14} className="animate-spin" aria-hidden />}
        {children}
      </button>
    );
  },
);

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={cx("h-8 w-full rounded-lg border border-line bg-panel px-2.5 text-[13px] text-ink shadow-[0_1px_1px_rgb(0_0_0/0.03)] outline-none transition-colors placeholder:text-ink-3 focus:border-line-strong focus:ring-3 focus:ring-[color-mix(in_srgb,var(--focus)_18%,transparent)] focus-visible:outline-none", className)}
      {...rest}
    />
  );
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx("hp-select h-8 rounded-lg border border-line bg-panel pl-2.5 pr-7 text-[13px] text-ink shadow-[0_1px_1px_rgb(0_0_0/0.03)] hover:bg-panel-2", className)} {...rest}>
      {children}
    </select>
  );
}

export function Field({ label, hint, children, error }: { label: string; hint?: ReactNode; children: (id: string) => ReactNode; error?: string | null }) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-[12px] font-medium text-ink-2">
        {label}
      </label>
      {children(id)}
      {hint && <p className="text-[12px] text-ink-3">{hint}</p>}
      {error && <p className="text-[12px] text-neg">{error}</p>}
    </div>
  );
}

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "brand" | "pos" | "neg" | "warn"; className?: string }) {
  const t = {
    neutral: "border-line text-ink-2 bg-panel",
    brand: "border-transparent text-brand-deep bg-brand-soft",
    pos: "border-transparent text-pos bg-[color-mix(in_srgb,var(--pos)_10%,transparent)]",
    neg: "border-transparent text-neg bg-[color-mix(in_srgb,var(--neg)_10%,transparent)]",
    warn: "border-transparent text-warn bg-[color-mix(in_srgb,var(--warn)_12%,transparent)]",
  }[tone];
  return <span className={cx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4", t, className)}>{children}</span>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-panel-2 px-1 font-mono text-[11px] text-ink-3">{children}</kbd>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton", className)} aria-hidden />;
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[13px] text-ink-3" role="status">
      <Loader2 size={14} className="animate-spin" aria-hidden /> {label}
    </span>
  );
}

export function ErrorBox({ error, action }: { error: unknown; action?: ReactNode }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div role="alert" className="flex items-start gap-2 rounded-xl border border-line bg-panel px-3.5 py-3 text-[13px] shadow-card">
      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-neg" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-ink">{msg}</p>
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line-strong px-5 py-10 text-center">
      <p className="text-[14px] font-medium text-ink">{title}</p>
      {children && <div className="max-w-md text-[13px] text-ink-2">{children}</div>}
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">{title}</h1>
        {description && <div className="mt-1 text-[13px] text-ink-3">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Section({ title, actions, children, className }: { title?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("overflow-hidden rounded-xl border border-line bg-panel shadow-card", className)}>
      {(title || actions) && (
        <div className="flex min-h-12 items-center justify-between gap-2 px-5 pt-3.5 pb-1">
          {title && <h2 className="text-[14px] font-semibold tracking-tight text-ink">{title}</h2>}
          {actions}
        </div>
      )}
      <div>{children}</div>
    </section>
  );
}

export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" aria-label="Close" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-[560px] flex-col border-l border-line bg-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close panel">
            <X size={16} />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-5">{children}</div>
      </div>
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg bg-panel-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx("h-7 rounded-md px-2.5 text-[12px] transition-colors", value === o.value ? "bg-panel font-medium text-ink shadow-card" : "text-ink-3 hover:text-ink")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Safe JSON viewer: renders text only, never HTML from telemetry. */
export function JsonView({ value }: { value: unknown }) {
  return <pre className="overflow-auto whitespace-pre-wrap break-all rounded-lg border border-line bg-panel-2 p-3 font-mono text-[12px] leading-5 text-ink">{JSON.stringify(value, null, 2)}</pre>;
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className={cx("w-full border-collapse text-left text-[13px]", className)}>{children}</table>
    </div>
  );
}
export const Th = ({ children, className, ...rest }: { children?: ReactNode; className?: string } & React.ThHTMLAttributes<HTMLTableCellElement>) => (
  <th scope="col" className={cx("border-b border-line bg-panel-2/60 px-5 py-2 text-[12px] font-medium text-ink-3", className)} {...rest}>
    {children}
  </th>
);
export const Td = ({ children, className, ...rest }: { children?: ReactNode; className?: string } & React.TdHTMLAttributes<HTMLTableCellElement>) => (
  <td className={cx("border-b border-line px-5 py-2.5 align-top", className)} {...rest}>
    {children}
  </td>
);
