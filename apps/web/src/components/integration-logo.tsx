"use client";
import { Plug } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Partner logo slot. Drop the partner's official logo file at /public/integrations/<id>.png
 * (following that partner's brand guidelines); until then a neutral tile is shown.
 */
export function IntegrationLogo({ id, name, size = 40 }: { id: string; name: string; size?: number }) {
  const src = `/integrations/${id}.png`;
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const img = new Image();
    img.onload = () => setOk(true);
    img.src = src;
  }, [src]);
  return (
    <span className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-panel" style={{ width: size, height: size }}>
      {ok ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={`${name} logo`} style={{ width: size * 0.7, height: size * 0.7, objectFit: "contain" }} />
      ) : (
        <Plug size={size * 0.45} className="text-ink-2" role="img" aria-label={name} />
      )}
    </span>
  );
}
