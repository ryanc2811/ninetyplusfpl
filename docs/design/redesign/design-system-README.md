NINETY+ is a transparent FPL prediction and decision-support app. It shows the model's numbers *and* its reasons, so the interface is quiet, precise and data-first, with one lime accent that marks what matters. This system rebuilds the original desktop dashboard **mobile-first**: most managers check their team on a phone, on the bus, an hour before the deadline.

## Mobile-first rules

These are the fixes over the previous UI. Follow them on every screen.

1. **Nothing below 12px.** The old UI used 6–9px text everywhere. `caption` (12px) is the floor; body is `body` (15px); inputs are `input` (16px) so iOS never zooms on focus.
2. **Every tap target is at least `tap-min` (44px).** Visual elements can be smaller; their hit area cannot. No 19×23px ▲▼ buttons — select a player, then act in a `BottomSheet`.
3. **No horizontal page scroll, ever.** Tables become `PlayerRow` lists under `bp-expanded` (900px). The only sideways scroller is the `FixtureTicker`.
4. **Navigation in the thumb zone.** `TabBar` sits at the bottom below 900px and becomes the ink rail at ≥900px. Pad the page bottom by `tab-bar` + `env(safe-area-inset-bottom)`.
5. **One number per row; details on demand.** Rows show the single key figure (xP). Probabilities, breakdowns and evidence open in a `BottomSheet` (dialog at ≥900px) instead of expanding inline.
6. **Primary action at the bottom.** On compact, a screen's `primary` Button is `block`, in a sticky footer above the tab bar or in the sheet footer.
7. **Size with ratios, not pixels.** The `Pitch` uses `aspect-ratio`; never fixed heights like 390px or 610px.
8. **Deadline is always visible.** The `TopBar` eyebrow carries `GW · deadline` on every breakpoint.

## Layout

- **Compact (< `bp-medium`, 600px):** single column, `space-4` gutters, StatCards two per row with `space-3` gaps, bottom TabBar, sheets for detail.
- **Medium (600–899px):** two-column card grids, `space-5` card padding, bottom TabBar.
- **Expanded (≥ `bp-expanded`, 900px):** `rail` (240px) on the left, `space-6` gutters, a main column plus a side column (e.g. Pitch + TransferCard), sheets become centred dialogs, lists may become tables.
- **Wide (≥ `bp-wide`):** three-column dashboards; content centred at `content-max`.
- Stack sections with `space-6`; cards inside a section with `space-3`.

## Content

- British English, sentence case everywhere except the mono `eyebrow` (uppercase). Money as `£10.4m`; points as `6.8 xP`; deltas signed (`+3.4`, `−4 pts` for hits).
- Speak to the manager as "you"; the model is "the model", never "AI magic". Be specific and honest about uncertainty: "Baseline model" badges stay until a trained model is live.
- Screen titles are short nouns: Home, Squad, Players, Chips, Leagues. Buttons are verbs: "Make transfer", "Apply Bench Boost".
- Real copy examples: "Palmer → Saka adds +3.4 xP over the next three gameweeks." · "Haaland is flagged 75% — consider a bench swap before Sat 11:00."
- No emoji.

## Colour

- Ground is `bg`; content sits on `surface` cards with a `border` hairline and `shadow-sm`. Recessed areas use `surface-2`, tracks `surface-3`.
- Text is `text`; secondary is `text-muted` (now ≥5.4:1 on every surface; the old muted grey failed). `text-disabled` is for placeholders only.
- `positive` (brand green) is for xP, gains, links and ghost buttons. `negative` for losses and errors, `warning` for estimates and doubts, each with a `-soft` background for pills. Always pair these with a word or icon.
- `accent` (lime) is a **fill**, never text on light grounds: the active tab pill, the captain armband, live dots, numbers on `ink`. Text on lime uses `on-accent`.
- `ink` is the inverted hero surface (SignalBanner, hero StatCard, the rail) in both themes; text on it is `on-ink` / `on-ink-muted`, highlights in `accent`.
- `action` / `on-action` drive the primary button: ink in light, lime in dark.
- Fixtures use `fdr-1`…`fdr-5` with matching `on-fdr-*`; the number is always printed.
- Both themes ship: `light` and `dark`. Follow the OS by default; the toggle sets `data-theme` on `<html>`.

## Type

- **Geist** (`sans`) for interface text; **Geist Mono** (`mono`) for `eyebrow`, `data` and `data-lg`; **Instrument Serif** (`serif`) for `display`, `title-1` and `stat` — the editorial voice used for big numbers and screen titles only. All three load from Google Fonts.
- Numbers are always tabular (`font-variant-numeric: tabular-nums`).
- One `display` per screen at most.

## Shape, depth, motion

- Radii: `radius-sm` on controls, `radius-md` on cards, `radius-lg` on the pitch and hero cards, `radius-sheet` on sheet tops, `radius-full` on pills.
- Depth is borders first; `shadow-sm` at rest, `shadow-md` only on hover (pointer devices) and floating bars, `shadow-sheet` for sheets.
- Motion: 120ms for presses, 220ms for state changes, 360ms with a sheet ease for sheets. Press feedback is `scale(.98)`; no hover lifts on touch (`@media (hover: hover)` only). Everything honours `prefers-reduced-motion`.

## States

- Focus: a solid 2px `focus` ring with 2px offset on every interactive element (≥5:1 on every surface, both themes).
- Selected: `positive-soft` background with an `accent` inset bar (rows), lime name plate (pitch).
- Disabled: 45% opacity and a reason nearby ("Over budget").
- Loading: `.np-skel` shimmer blocks shaped like the content; never a lone spinner.
- Empty: a sentence saying what's missing and one action to fix it.

## Iconography

- Use the `Icon` component: a 24px line set, 1.75px stroke, round caps, `currentColor`. It replaces the old Unicode glyphs (▦ ♛ ∿), which render inconsistently across phones.
- 20px in buttons and rows, 22px in the tab bar and icon buttons. Icons beside a label are decorative; standalone icons need a `label`.
- There is no drawn logo; the `Wordmark` component (Geist ExtraBold "NINETY" + a `+`) is the mark.
