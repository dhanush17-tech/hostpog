# Upstream audit

| Repository | Commit | License | Use |
|---|---|---|---|
| https://github.com/PostHog/posthog-foss | `86eaa161aaa0e1d3233971a0ef85e5cb4ad4138d` (2026-11-18) | MIT (© 2020-2026 PostHog Inc.) | Reference only |
| https://github.com/PostHog/posthog | not inspected | mixed (MIT + `ee/` proprietary) | not used |

## Paths inspected (sparse checkout)

- `posthog/api/rest_router.py` — route registration (`event_definitions` on `projects_router` with `project_id`; `query` on projects; `session_recordings`)
- `posthog/api/query.py` — `scope_object = "query"`, read actions include `create`
- `posthog/api/event_definition.py`, `posthog/api/person.py` — scope objects
- `posthog/permissions.py`, `posthog/exceptions.py` — missing-scope error text
- `posthog/hogql/functions/**` — function availability and mapping (`toDateTime`, `windowFunnel`, …)
- `posthog/hogql/database/schema/persons.py` — `persons` fields
- `posthog/schema.py` — `HogQLQuery` (`values`) and `HogQLQueryResponse` fields

## Reuse decisions

- **No code copied.** HostPog is a new implementation. The metric compiler, providers, UI and SDKs are original.
- Event property naming conventions (`$pageview`, `$current_url`, `$pathname`, `$session_id`, `$identify`, `$anon_distinct_id`, `$set`, `$set_once`) are followed for interoperability; they are names, not code.
- No PostHog logos, mascot, marketing copy or assets are used. The HostPog mark is original (`apps/web/src/components/brand.tsx`).
- No undocumented private endpoints are called. `/api/users/@me/` is used defensively (its failure is tolerated).

## Branding / trademark note

"HostPog" is deliberately close to "PostHog". Trademark clearance has **not** been done. Footer and docs state
non-affiliation. Recommend clearance before any public launch; the name is isolated to copy, metadata and package
names so it can be changed.
