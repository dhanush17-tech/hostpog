"use client";

import { useEffect } from "react";

// Counts visits to the marketing site and docs with HostPog itself, through posthog-js and HostPog's
// PostHog-compatible endpoint. Off unless both env vars are set (they are for the hosted site only;
// self-hosted installs never send anything from here).
const KEY = process.env.NEXT_PUBLIC_SITE_ANALYTICS_KEY;
const HOST = process.env.NEXT_PUBLIC_SITE_ANALYTICS_HOST;

export function SiteAnalytics() {
  useEffect(() => {
    if (!KEY || !HOST) return;
    let cancelled = false;
    void import("posthog-js").then(({ default: posthog }) => {
      if (cancelled || posthog.__loaded) return;
      posthog.init(KEY, {
        api_host: `${HOST.replace(/\/$/, "")}/ph`,
        capture_pageview: "history_change",
        capture_pageleave: true,
        autocapture: { dom_event_allowlist: ["click"], element_allowlist: ["a", "button"] },
        person_profiles: "identified_only",
        disable_session_recording: true,
        disable_surveys: true,
        respect_dnt: true,
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
