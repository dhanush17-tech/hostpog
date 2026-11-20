# Security

Please report vulnerabilities privately through [GitHub security advisories](https://github.com/dhanush17-tech/hostpog/security/advisories/new)
or by email to CONTACT_EMAIL. Do not open public issues for security reports. We aim to reply within 3 business days.

## Scope and design

See [docs/architecture.md](docs/architecture.md#threat-model-summary) for the threat model. Highlights:

- Credentials are encrypted with AES-256-GCM (`HOSTPOG_MASTER_KEY`), bound to their workspace, and never returned to
  browsers. Back up the master key separately from the database.
- PostHog access is read-only and uses the least scopes needed; disconnecting deletes the stored credential.
- Configurable outbound endpoints (self-hosted PostHog, AI providers) are restricted by operator allowlists and
  connect-time private-address checks.
- The AI agent has read-only, bounded tools and no shell, network or SQL access.

## Known limitations

- Rate limits and caches for the PostHog connector are per process.
- CSP allows `'unsafe-inline'` scripts because Next.js injects inline bootstrap scripts; nonce-based CSP is planned.
- No external security audit has been performed; no compliance certifications are claimed.
