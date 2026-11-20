"use client";
import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type Mode = "light" | "dark" | "system";

/** Inline, dependency-free script that applies the stored theme before paint. */
export const themeScript = `(function(){try{var m=localStorage.getItem('hostpog-theme')||'system';var d=m==='dark'||(m==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d)}catch(e){}})()`;

function apply(mode: Mode) {
  const dark = mode === "dark" || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("system");
  useEffect(() => {
    setMode((localStorage.getItem("hostpog-theme") as Mode) ?? "system");
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => apply((localStorage.getItem("hostpog-theme") as Mode) ?? "system");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const next: Record<Mode, Mode> = { system: "light", light: "dark", dark: "system" };
  const Icon = mode === "light" ? Sun : mode === "dark" ? Moon : Monitor;
  return (
    <button
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-panel-2 hover:text-ink"
      aria-label={`Theme: ${mode}. Switch to ${next[mode]}`}
      title={`Theme: ${mode}`}
      onClick={() => {
        const m = next[mode];
        localStorage.setItem("hostpog-theme", m);
        setMode(m);
        apply(m);
      }}
    >
      <Icon size={16} />
    </button>
  );
}
