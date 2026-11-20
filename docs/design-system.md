# Design system

Source of truth: the DevLabs website repository (`devlabs/website`, read-only; it had uncommitted changes and was not
modified). Tokens were taken from `src/styles/global.css` and `tailwind.config.mjs`.

## Token mapping

| HostPog token | Light | Dark | DevLabs origin |
|---|---|---|---|
| `--canvas` | `#fbf6f3` | `#0e0e0f` | `--paper: 251 246 243` / `--surface-base: 8 8 9` |
| `--panel` | `#fffdfb` | `#151516` | `--surface-elevated` / `--card` |
| `--ink` | `#0a0a0a` | `#f2f2f2` | `--ink: 5 5 5` / `--foreground 0 0% 96%` |
| `--ink-2` | `#5c5c5c` | `#a8a8ad` | `--muted-foreground 0 0% 38%` / `68%` |
| `--line` | `#e6e0da` | `#2a2a2d` | `--border 30 10% 88%` / `0 0% 22%` (darkened for density) |
| `--brand` | `#ff7417` | `#ff7417` | `--brand: 255 116 23` (`--primary 24 100% 55%`) |
| `--brand-deep` | `#bf4f08` | `#ff8a3d` | `--brand-deep: 191 79 8` |
| radius | 6–8 px | | `--radius: 0.5rem` |

### Accessibility adjustments (deliberate deviations)

- White text on DevLabs orange `#ff7417` is ~2.6:1 (fails WCAG AA). Light-mode primary buttons use `--brand-deep`
  (`#bf4f08`, ~5:1 with white). Dark mode uses orange with near-black text.
- Orange is an accent (primary actions, active nav icon, chart series 1, focus ring) — not a surface colour.
- Semantic green/red only for genuinely positive/negative deltas.

## Typography

DevLabs uses **PP Gatwick** and **The Seasons**, both commercial fonts whose licences do not allow redistribution in
an MIT repository. HostPog uses the system UI stack and system monospace (no remote font loading). The wordmark is
set in monospace. If DevLabs holds a licence that permits it, fonts can be added under `apps/web/public/fonts`.

## Rules applied

- 4/8 px spacing, 13–14 px app text, 12 px labels, 24 px page titles, 44–64 px marketing headline, tabular numbers.
- 224 px sidebar, 56 px top bar, 1 px borders, shadows only on overlays (drawer, palette, menus).
- DevLabs glass/blur/gradient components (`dashboard-shell-card`, radial gradients) were intentionally **not** adopted
  for the product UI, per the brief.
- No illustrations, fake logos, stars or testimonials. The landing screenshot is a real capture of the demo dataset.

## Screenshots (captured by `e2e/screenshots.spec.ts`, demo data)

`docs/screenshots/`: `landing-desktop`, `landing-mobile`, `onboarding-desktop`, `overview-desktop`,
`overview-mobile-dark`, `nav-mobile-dark`, `funnel-breakdown-desktop`, `web-desktop`, `events-desktop`.
The test asserts no horizontal overflow at 375 px for the app and landing page.

Not yet checked: 768 and 1920 widths, automated contrast audit (axe), screen-reader pass.
