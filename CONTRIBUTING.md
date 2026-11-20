# Contributing

Thanks for helping. Bug reports, fixes, docs and new features are all welcome.

## Get set up

Requirements: Node 22+, pnpm 10, Docker.

```bash
cp .env.example .env
echo "HOSTPOG_MASTER_KEY=$(openssl rand -base64 32)" >> .env
echo "BETTER_AUTH_SECRET=$(openssl rand -base64 32)" >> .env
pnpm install
pnpm infra:up
pnpm dev
```

## Before you open a pull request

- `pnpm typecheck`, `pnpm test`, `pnpm --filter @hostpog/web build`, and `pnpm test:e2e` for UI changes.
- Keep pull requests to one change. For anything large, open an issue first so we can agree on the approach.
- Look for issues labelled `good first issue` if you're new to the codebase.

## Ground rules

- Never claim PostHog behaviour that isn't recorded in `docs/posthog-contract.md` with a source.
- New analytics features go through the metric DSL (`packages/contracts`) and compiler: no raw SQL from the UI or the agent.
- Every chart shows where its numbers came from (the `Provenance` footer).
- Synthetic fixtures are labelled SYNTHETIC.
- Don't copy code or assets from PostHog's repositories; reference and attribute instead.
- Postgres schema changes: edit `packages/db/src/schema.ts`, then `pnpm --filter @hostpog/db generate`. ClickHouse: append a new entry to `CH_MIGRATIONS`.

By contributing you agree that your contribution is licensed under the MIT license and that you follow the
[code of conduct](CODE_OF_CONDUCT.md).
