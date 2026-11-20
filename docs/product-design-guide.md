# HostPog product & design guide

Read this before you change any screen. It records the product decisions, design decisions and rules that keep HostPog consistent. If a rule here conflicts with an older doc (e.g. `docs/design-system.md`), this file wins.

---

## 1. What HostPog is

- **One line:** product analytics you own, with an AI analyst built in. Positioned as the way to leave PostHog ("Say bye to PostHog 👋").
- **Who it's for:** small teams paying for PostHog who want their data and costs under control, and want answers ("why did signups drop?"), not just charts.
- **Hosted setup:** the web app runs on Vercel and Postgres runs on Railway. Everything has to fit Railway's $5 Hobby plan (Postgres alone is about $1–1.50/month). Users only do two things: **connect PostHog** and **bring their own AI key**.
- **Self-hosted** adds ClickHouse (native SDK ingest, imported history, sample data) and local models (Ollama).
- **License and tone:** MIT, no telemetry, no cloud-only features. Not affiliated with PostHog. Say that plainly, and never imply a partnership.

## 2. Product decisions (and why)

### Data and trust
- **PostHog is read-only.** HostPog never writes to the user's PostHog account. Disconnecting deletes only the credential HostPog stored, and we say so in the confirm dialog.
- **Connecting is idempotent.** Connecting the same PostHog project and host twice returns the existing source (`alreadyConnected`) rather than creating a duplicate.
- **Sample data is labelled "Sample data"** everywhere (source picker, Integrations), so nobody mistakes it for their real numbers.
- **AI gets aggregates by default.** Sharing redacted event details is an explicit per-model checkbox.
- **Every AI claim has to cite evidence.** The investigation report removes observations and hypotheses that don't reference a real evidence ID, and the Evidence panel shows the exact query behind each one.

### AI / BYOK
- **First-class providers:** Gemini, Claude and OpenAI as logo cards, each with a "Get a key" deep link to that provider's key page. OpenRouter and custom endpoints sit under "Other providers".
- **Paste any key:** we detect the provider from the key prefix, so users don't have to pick a provider first.
- **Check before saving:** validate the key by listing models, save, run a live test, then show a receipt (provider, model, budget) with a model dropdown.
- **Never hard-code model names.** `rankModels()` in `components/connect-ai.tsx` picks the newest stable model by tier and version. If the live test fails, we try the next two ranked models and tell the user which one we switched to. (`gemini-2.5-flash` being retired is why this exists.)
- **Default budget** is 2M tokens/month per model, and the user can change it.
- **Ollama** is auto-detected only on self-host, and only if `HOSTPOG_AI_ALLOWED_PRIVATE_HOSTS` allows localhost. If it doesn't, we show the exact env line with a copy button.
- **A failed run is fixed where it failed.** If the model is gone, we pre-select the recommended model and show "Run again". Picking a model also makes it the provider's default, so the same failure doesn't happen next time.
- **Investigations run in the background on Vercel:** `after()` plus `maxDuration = 300`.

### Onboarding and getting value
- **A question asked on the landing page survives signup:** stored in localStorage `hostpog:pending-question`, shown as a banner, and answered once a model is connected. The primary button after connecting is "Answer my question".
- **Setup guide on Overview:** a checklist (connect data, connect an AI model, ask a question, invite a teammate as optional). It can be hidden and brought back from the user menu ("Setup guide").
- **Connect PostHog shows its progress:** a list of stages while connecting, then a receipt of what was found. Anything that didn't reconcile is shown, not hidden.
- **First run with no model connected:** one focused setup page, not empty columns or a card inside a card.

### Migration off PostHog
- **Steps:** connect → copy history → point the app at HostPog → compare the numbers.
- **When numbers differ,** explain why in plain words (usually events that reached PostHog between the history copy and the cutover) and give a one-click **"Copy the missing events"**. It's deduplicated by event UUID and re-compares automatically when it finishes.
- **Checklist items tick from real results:** "Counts match" ticks when the compare comes back green.

### Navigation and scope
- **Roadmap items are not in the nav:** no disabled "coming soon" entries. The roadmap lives on `/oss`.
- **Self-host tab:** buttons that open the exact page where each key is created, plus a "Copy agent prompt" button. The SDK install tab also has "Copy prompt for your coding agent".

## 3. Design system

- **Stack:** Tailwind v4 with shadcn-style primitives (`components/primitives/*`: button, card, accordion, dropdown-menu, tooltip). Use `cn()` from `lib/utils`. App-level wrappers live in `components/ui.tsx` (Button, Badge, Section, PageHeader, Empty, ErrorBox, Field, Select, Input, Spinner).
- **Font:** Inter Variable (`@fontsource-variable/inter`), with tabular numbers for metrics.
- **Colors:** zinc neutrals plus one orange accent. Always use tokens, never hex values in components.

| Token | Light | Dark |
|---|---|---|
| canvas / panel / panel-2 | #fafafa / #fff / #f4f4f5 | #09090b / #111113 / #1c1c1f |
| ink / ink-2 / ink-3 | #09090b / #52525b / #71717a | #fafafa / #a1a1aa / #82828b |
| line / line-strong | #e4e4e7 / #d4d4d8 | #27272a / #3f3f46 |
| brand / brand-deep / brand-soft | #ff7417 / #c2410c / #fff4ec | #ff7417 / #ff8a3d / #2a1709 |
| pos / neg / warn | #15803d / #dc2626 / #b45309 | #4ade80 / #f87171 / #fbbf24 |

- **Orange is an accent only:** primary buttons, the active nav icon, chart series 1 and the focus ring. Never use it as a surface.
- **Green and red mean good and bad** (deltas, health). Don't use them for decoration.
- **Type scale:**
  - Page title: 22px semibold, tight tracking
  - Section title: 13–14px semibold
  - Body: 13px
  - Meta and labels: 12px in ink-3
  - Hero numbers: tabular figures
- **Layout:** 4/8px spacing, 1px borders, rounded-xl cards with a subtle shadow, 248px sidebar, 56px top bar. Content max widths: 920px (focused pages), 1000–1100px (settings), 1280–1440px (data pages).
- **Themes:** the app follows the system or user setting. **Marketing pages are always light**: the `.light` scope plus a dark variant that excludes `.light`. Test every app screen in both themes.
- **Logos:** use `<BrandLogo id=… />`, which loads `/public/integrations/<id>.png|svg`. Monochrome marks (OpenAI, Ollama) are in a `MONO` set and get `dark:invert` so they stay visible on dark backgrounds. Use real provider logos only, never made-up ones. ClickHouse is not shown in the logo strip.
- **Icons:** lucide-react, 13–16px, in ink-3 unless they're the active state.

## 4. Interaction rules (the important part)

1. **One visible action per state.** A row or object shows a button only for the action its current state needs:
   - failing → "Test again" / "Check again"
   - off → "Turn on"
   - model gone → model dropdown + "Run again"

   Healthy rows show no buttons.
2. **Everything else goes in the ⋯ menu.** Use `components/row-menu.tsx` (`<RowMenu items=[…]/>`). Destructive items take `danger: true`, which groups them at the bottom in red after a separator, and they still ask for confirmation. Hide items that don't apply (`hidden`) rather than disabling them, unless being disabled tells the user something.
3. **Never offer the same action twice on one screen.** If there's a pencil next to a field, "Edit" doesn't also go in ⋯. If the error panel already has "Run again", the menu doesn't. Before adding a control, check whether it already exists on the screen.
4. **Never show the same content twice.** Don't echo a value into a second form just to make it editable.
5. **Edit in place.** Put a pencil icon next to the value (question, dashboard name). Clicking it swaps the value for an input in the same spot, with focus. Enter (or ⌘↵ in a textarea) saves, Esc cancels, and Cancel is always visible.
6. **Every state tells the user what to do next.** Empty, error, success and "in progress" states each have one primary next action. A user should never be stuck wondering what to do next. After a connection, show a receipt and the next step ("Answer my question", "Go to my dashboard").
7. **Errors say what went wrong in plain English, with the fix next to it.** Show the raw provider or API error only when it adds information beyond the headline. Tell a wrong key (401/403) apart from "couldn't reach" (network).
8. **Creation is on demand.** A "+ New X" button opens an inline input; don't leave an empty input permanently in the header. Empty states carry the same button.
9. **Hide internal noise.** Hide counters, "never" timestamps, internal IDs and validation notes until they mean something to the user (errors > 0, a real time).
10. **Loading never shows broken text.** Show a spinner or skeleton, never half-filled sentences like "Runs on ." while data loads.
11. **Checklists and badges reflect real results.** Never tick something because a step was visited.
12. **Copy buttons** for anything users paste somewhere else (env lines, install commands, agent prompts). The button confirms with "Copied".

## 5. Copy rules

- **No AI slop.** No meta-commentary ("Real HostPog screenshot using the built-in synthetic demo dataset"), no hype ("supercharge", "unlock", "seamless"), no padded filler sentences.
- **Sentence case.** Specific verbs on buttons ("Copy the missing events", "Run again", "Replace API key"), never "Submit" or "OK".
- **Say what happens to the user's data** at the moment it matters (disconnect, delete, sharing with a model).
- **One sentence where one will do.** Descriptions under a page title are a single line.
- **Name things the way users do:** "AI model", "your PostHog", "sample data". Not "provider instance", "source kind" or "demo".

## 6. Engineering conventions

- **Where things live:**
  - App pages: `apps/web/src/app/app/p/[projectId]/…`
  - Marketing pages: `apps/web/src/app/(marketing)/…`
  - Shared UI: `apps/web/src/components/…`
- **Reuse before creating.** Use `RowMenu`, `ConnectAI`, `BrandLogo`, `CopyButton`, `SetupGuide`, `PageHeader`, `Section` and `Empty`. If you need a variant, extend the component rather than forking it.
- **Data fetching:** react-query keys follow `[resource, workspaceId|projectId, …]`, and you invalidate the same key after a mutation.
- **Roles:** gate controls with `p.can("member" | "admin" | "owner")`. Hide controls the user can't use rather than showing them disabled.
- **Before handing off a screen:**
  1. `npx tsc --noEmit` and the e2e selectors in `apps/web/e2e/*` still pass. When a label moves into ⋯, update the test to open "More actions" and then click the `menuitem`.
  2. Screenshot the screen from a **production build** (`next build && next start`) in light and dark at 1440px and 375px, with no horizontal overflow at 375px.
  3. Check the states: empty, loading, error, success, no permission.

## 7. Pre-ship checklist for any screen

- [ ] Is there only one visible action for this state, with the rest in ⋯?
- [ ] Is any action or content shown twice?
- [ ] Is it clear what the user does next in every state?
- [ ] Are errors plain English with the fix next to them?
- [ ] Are all colors tokens, and does it look right in both themes and at 375px?
- [ ] Is the copy free of filler, internal jargon and "demo"/"synthetic" wording?
- [ ] Do destructive actions confirm and say what happens to the data?
- [ ] Are the e2e tests updated?
