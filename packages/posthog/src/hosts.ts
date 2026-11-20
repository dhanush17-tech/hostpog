/**
 * PostHog private API hosts. Public capture hosts (us.i.posthog.com, ...) are
 * different and are never used by HostPog's read-only connector.
 */
export const POSTHOG_HOSTS = {
  us: "https://us.posthog.com",
  eu: "https://eu.posthog.com",
} as const;

export type PostHogRegion = "us" | "eu" | "self_hosted";

/**
 * Self-hosted PostHog instances must be explicitly approved by the HostPog
 * operator (HOSTPOG_POSTHOG_ALLOWED_HOSTS, comma-separated origins). Hosted
 * users cannot point the server at arbitrary URLs (SSRF).
 */
export function resolvePostHogHost(region: PostHogRegion, selfHostedUrl?: string): string {
  if (region === "us" || region === "eu") return POSTHOG_HOSTS[region];
  if (!selfHostedUrl) throw new Error("self-hosted PostHog requires an instance URL");
  let u: URL;
  try {
    u = new URL(selfHostedUrl);
  } catch {
    throw new Error("invalid PostHog instance URL");
  }
  if (u.username || u.password) throw new Error("credentials in URL are not allowed");
  const origin = u.origin;
  const allowed = (process.env.HOSTPOG_POSTHOG_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);
  if (!allowed.includes(origin)) {
    throw new Error(
      `PostHog instance ${origin} is not approved by this HostPog operator. Add it to HOSTPOG_POSTHOG_ALLOWED_HOSTS.`,
    );
  }
  if (u.protocol !== "https:" && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname)) {
    throw new Error("self-hosted PostHog must use HTTPS");
  }
  return origin;
}

export function regionLabel(region: PostHogRegion): string {
  return region === "us" ? "US Cloud" : region === "eu" ? "EU Cloud" : "Self-hosted";
}
