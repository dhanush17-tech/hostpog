/**
 * SSRF defence for operator- or user-configured AI endpoints.
 *  - URL normalisation, no credentials in URL, http(s) only
 *  - HTTPS required except for operator-approved private hosts
 *  - DNS resolution checked at CONNECT time (custom lookup on an undici Agent),
 *    so DNS rebinding cannot swap in a private address after validation
 *  - redirects disabled
 * Private/loopback/link-local/metadata ranges are blocked unless the hostname is
 * listed in HOSTPOG_AI_ALLOWED_PRIVATE_HOSTS (self-host operators, e.g. Ollama).
 */
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { isIP } from "node:net";
import { Agent } from "undici";

export class EndpointPolicyError extends Error {}

export function allowedPrivateHosts(): Set<string> {
  return new Set(
    (process.env.HOSTPOG_AI_ALLOWED_PRIVATE_HOSTS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const v = ip.toLowerCase();
  if (v === "::1" || v === "::") return true;
  if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
  return v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("ff");
}

export function normalizeEndpoint(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new EndpointPolicyError("endpoint is not a valid URL");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new EndpointPolicyError("endpoint must be http(s)");
  if (u.username || u.password) throw new EndpointPolicyError("credentials in endpoint URL are not allowed");
  u.hash = "";
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const privateOk = allowedPrivateHosts().has(host);
  if (u.protocol === "http:" && !privateOk) throw new EndpointPolicyError("endpoint must use HTTPS (or be an operator-approved private host)");
  if (isIP(host) && isPrivateAddress(host) && !privateOk) throw new EndpointPolicyError("endpoint resolves to a private address");
  if (/^(localhost|metadata\.google\.internal)$/.test(host) && !privateOk) throw new EndpointPolicyError("endpoint host is not allowed");
  return u;
}

/** undici dispatcher whose DNS lookup enforces the private-address policy at connect time. */
export function guardedDispatcher(hostname: string): Agent {
  const privateOk = allowedPrivateHosts().has(hostname.toLowerCase());
  return new Agent({
    connect: {
      lookup(host, options, cb) {
        dnsLookup(host, { ...options, all: true }, (err, addresses) => {
          if (err) return cb(err, [] as unknown as string, 0);
          const list = (Array.isArray(addresses) ? addresses : [{ address: addresses as unknown as string, family: 4 }]) as LookupAddress[];
          const bad = list.find((a) => isPrivateAddress(a.address));
          if (bad && !privateOk) return cb(new EndpointPolicyError(`blocked private address for ${host}`), [] as unknown as string, 0);
          // undici requests all addresses
          return (cb as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
        });
      },
    },
  });
}

/** fetch wrapper for model providers: policy-checked URL, guarded DNS, no redirects. */
export function guardedFetch(endpoint: URL): typeof fetch {
  const dispatcher = guardedDispatcher(endpoint.hostname);
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const target = new URL(input instanceof Request ? input.url : String(input));
    if (target.origin !== endpoint.origin) throw new EndpointPolicyError(`request to ${target.origin} is outside the configured endpoint`);
    return fetch(input, { ...init, redirect: "error", dispatcher } as RequestInit);
  }) as typeof fetch;
}
