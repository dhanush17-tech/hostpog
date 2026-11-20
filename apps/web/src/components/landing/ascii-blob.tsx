"use client";

import { useEffect, useRef } from "react";

// A slowly rotating, gently deforming 3D blob drawn as ASCII characters on a canvas.
// Brighter parts of the surface use denser glyphs; a faint dot field fills the rest.
// Pauses when off screen and renders a single still frame for reduced motion.

const RAMP = " ··•:#xX%@";
const CELL = 14; // px per character cell

export function AsciiBlob({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0;
    let h = 0;
    let raf = 0;
    let visible = true;
    let last = 0;
    const start = performance.now();

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = r.width;
      h = r.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `600 ${CELL - 2}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
    };

    const draw = (now: number) => {
      const t = (now - start) / 1000;
      ctx.clearRect(0, 0, w, h);
      const cols = Math.ceil(w / CELL);
      const rows = Math.ceil(h / CELL);
      const cx = w * 0.5;
      const cy = h * 0.52;
      const R = Math.min(w * 0.3, h * 0.85);
      const a = t * 0.35; // rotation about the vertical axis
      const b = Math.sin(t * 0.2) * 0.35; // slow tilt
      const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
      // light from the upper left, slightly in front
      const lx = -0.5, ly = -0.6, lz = 0.62;

      for (let j = 0; j < rows; j++) {
        const py = j * CELL + CELL / 2;
        for (let i = 0; i < cols; i++) {
          const px = i * CELL + CELL / 2;
          const x = (px - cx) / R;
          const y = (py - cy) / R;
          const d2 = x * x + y * y;
          let level = 0;
          let alpha = 0.18;

          if (d2 < 1.45) {
            // point on a unit sphere behind this cell (or the rim if outside)
            const z = Math.sqrt(Math.max(0, 1 - Math.min(d2, 1)));
            // rotate into the blob's frame
            const rx = x * ca + z * sa;
            const rz = -x * sa + z * ca;
            const ry = y * cb - rz * sb;
            const rz2 = y * sb + rz * cb;
            // soft deformation that drifts over time
            const disp =
              0.16 * Math.sin(2.4 * rx + t * 0.9) * Math.cos(2.1 * ry - t * 0.6) +
              0.09 * Math.sin(3.7 * rz2 + 1.7 * rx + t * 1.1);
            const radius = 1 + disp;
            const inside = Math.sqrt(d2) < radius;
            if (inside) {
              const len = Math.hypot(x, y, z) || 1;
              const nx = x / len, ny = y / len, nz = z / len;
              const diff = Math.max(0, nx * lx + ny * ly + nz * lz);
              const rim = Math.pow(1 - nz, 2) * 0.35;
              const shade = Math.min(1, 0.18 + diff * 0.85 + rim + disp * 0.6);
              level = Math.max(1, Math.round(shade * (RAMP.length - 1)));
              alpha = 0.22 + shade * 0.55;
            }
          }

          if (level === 0) {
            // faint background dot field, denser near the blob
            if ((i + j) % 2 === 1) continue;
            ctx.fillStyle = "rgba(255, 210, 90, 0.16)";
            ctx.fillText("·", px, py);
            continue;
          }
          ctx.fillStyle = `rgba(255, 214, 92, ${alpha.toFixed(3)})`;
          ctx.fillText(RAMP[level], px, py);
        }
      }
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || now - last < 1000 / 30) return;
      last = now;
      draw(now);
    };

    resize();
    draw(performance.now());
    const ro = new ResizeObserver(() => {
      resize();
      draw(performance.now());
    });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => {
      visible = e?.isIntersecting ?? true;
    });
    io.observe(canvas);
    if (!still) raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  return <canvas ref={ref} aria-hidden className={className} />;
}
