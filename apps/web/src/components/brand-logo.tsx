"use client";
import { useState } from "react";

/**
 * Third-party logo from /public/integrations/<id>.png (falls back to .svg).
 * Renders nothing until the file exists, so missing logos never show a broken image.
 */
/** Black-on-transparent marks that need inverting on dark surfaces. */
const MONO = new Set(["openai", "ollama"]);

export function BrandLogo({ id, size = 18, className }: { id: string; size?: number; className?: string }) {
  const [src, setSrc] = useState(`/integrations/${id}.png`);
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      aria-hidden
      className={[className, MONO.has(id) ? "dark:invert dark:opacity-90" : ""].filter(Boolean).join(" ")}
      style={{ height: size, width: "auto", maxWidth: size * 4 }}
      onError={() => (src.endsWith(".png") ? setSrc(`/integrations/${id}.svg`) : setHidden(true))}
    />
  );
}
