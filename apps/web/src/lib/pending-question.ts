"use client";
import { useEffect, useState } from "react";

/**
 * A question typed on the landing page, carried through sign-up and onboarding until
 * the user either asks it or dismisses it. Stored on this device only.
 */
const KEY = "hostpog:pending-question";

export function savePendingQuestion(q: string | null | undefined) {
  const v = q?.trim().slice(0, 500);
  if (!v) return;
  try {
    localStorage.setItem(KEY, v);
  } catch {}
}

export function readPendingQuestion(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearPendingQuestion() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}

export function usePendingQuestion(): [string | null, () => void] {
  const [q, setQ] = useState<string | null>(null);
  useEffect(() => setQ(readPendingQuestion()), []);
  return [
    q,
    () => {
      clearPendingQuestion();
      setQ(null);
    },
  ];
}
