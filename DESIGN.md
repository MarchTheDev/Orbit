# Orbit — Orbital Focus

The design system for Orbit's interface. It is a dark, artwork-led observatory:
the selected game is the body being observed, the library is the field around
it, and telemetry is read in a calm column.

## The world

- Deep space, not cyberpunk. Near-black indigo surfaces, a faint star field, one
  enormous orbital arc crossing the background. Nothing glows without a reason.
- Artwork is the light source. The selected game's art warms the stage behind it;
  chrome stays neutral so covers keep their own colours.
- Warm at the point of action. A single solar-gold accent carries Play, Save and
  selection. Ion cyan is the second accent, used for secondary data and charts.
- Precision over decoration. Hairline rules, tabular numerals, 1 px orbital lines.
  No gradients on text, no glass everywhere, no floating bubble cards.

## Color

The default theme (id `nebula`, displayed as *Orbital*):

| Token | Value | Use |
| --- | --- | --- |
| `--c-bg` | `#07090f` | Window |
| `--c-panel` | `#0c1119` | Panels, header, drawer |
| `--c-panel2` | `#121a26` | Raised rows, inputs, tiles |
| `--c-border` | `#1e2938` | Hairlines, frames |
| `--c-text` | `#eef2f7` | Primary text |
| `--c-muted` | `#8b98ab` | Labels, secondary text |
| `--c-accent` | `#e9a23b` | Play, selection, focus, active tab |
| `--c-accent2` | `#63c9d6` | Secondary data, charts, gallery |
| `--c-on-accent` | `#160f04` | Text on a filled accent |

Rules:

- Every built-in and custom theme must keep working. Never hard-code gold in a
  component; use `var(--c-accent)` and `color-mix`.
- Tints are `color-mix(in srgb, var(--c-accent) N%, transparent)`. No new raw
  hex values in components except semantic success/danger.
- Backgrounds use one star field and at most two radial washes. Linux disables
  the star field and all backdrop blur.
- Text contrast: body text on `--c-panel` must stay ≥ 4.5:1; muted labels ≥ 3:1.

## Type

- Family: the player's chosen local stack (`--font-sans`). No web fonts.
- Display: 2.6–4.4 rem, weight 800, tracking −0.03em, line-height 0.95.
- Section title: 1.25–1.5 rem, weight 700, tracking −0.01em.
- Kicker / label: 10–11 px, weight 600, uppercase, tracking 0.2em, muted or accent.
- Body: 13–14 px, line-height 1.55.
- Numbers: `font-variant-numeric: tabular-nums` in telemetry and lists.

## Space and shape

- 4 px base unit. Page gutter 32 px on desktop, 20 px on small windows.
- Column gap 24 px; panel padding 20–24 px.
- Radii: panels and covers 16 px, controls 10 px, pills only for status chips.
  Nothing uses 24 px+ bubbles except dialogs (20 px).
- Borders are 1 px `--c-border`. Elevation is a border plus a soft shadow, not a
  glowing halo.

## Layout

### Shell

64 px header, full width, bottom hairline, background = `--c-bg` at 96% with
blur only where the platform allows it. Left: mark + ORBIT wordmark, then two
places: **Library** and **Statistics**. Right: command palette, TV, sound,
settings. Active entry gets a gold 2 px underline; no sliding pill.

Statistics is a place, not a tab strip: below the header, a second sticky bar
holds Sessions, Journal, Backlog, Saves and Storage as underline tabs, in the
order the player arranged in Settings. The library's toolbar keeps only what
belongs to the library, so neither bar ever fills up.

Ctrl K opens the command palette over any page: pages, actions and games in one
field, arrow keys and Enter.

### Library — Orbital Focus (default)

Two columns with a third only on very wide screens:

1. **Bodies rail** (280–320 px): scrollable, grouped by state — *In orbit*
   (playing), *Next up* (backlog/unplayed), *Archived* (completed/dropped).
   Rows are 48 × 64 covers with title and playtime. Selection is a gold left
   marker plus `--c-panel2`.
2. **Stage** (flexible): the selected game. Blurred/darkened wide art, two thin
   elliptical orbit lines, portrait cover, kicker, display title, meta line,
   summary, primary Play + Details, completion rail, and a strip of factual
   telemetry under it.
3. **Telemetry** (300–340 px, 2xl and up only): one panel with grouped rows —
   status, rating, playtime, last played, longest, completion estimates, disk,
   launcher and genres as chips. Below 2xl the stage strip and Details carry the
   same facts, keeping the library calm.

Below 1536 px: rail + stage. Below 1024 px: stage first, the rail moves beneath
it as a scrollable list. Below 768 px: single column.

The existing Grid and List views remain available from the toolbar. Focus is the
new default for first-time users; a saved choice wins.

### Game detail drawer

480 px sheet, opaque `--c-panel`, 20 px radius, backdrop art tint at the top,
tabs as an underline row. Same information and actions as today.

### TV mode

Keep the couch-first structure. Match the accent and type; do not add chrome.

## Components

- **Primary action**: filled `--c-accent`, `--c-on-accent` text, 10 px radius,
  weight 650. One per surface.
- **Secondary action**: transparent, 1 px border, text colour.
- **Quiet action**: text + icon, muted until hover.
- **Chips**: 1 px border, transparent fill; active = accent tint + accent text.
- **Cover**: 3:4, 12 px radius, 1 px white 8% inner edge, shadow. Hover lifts 2 px
  and brightens; no scale beyond 1.02.
- **Telemetry row**: label left (muted, 12 px), value right (text, 13 px,
  tabular), hairline between groups, not between every row.
- **Focus ring**: 2 px `--c-accent` outline, offset 2 px. Never removed.

## Motion

- Durations 160–320 ms, `cubic-bezier(.22,1,.36,1)`.
- One slow orbit rotation (60 s) on the stage ring; stops when the window is
  idle, when detail is open, and for `prefers-reduced-motion`.
- Page change: 12 px rise + fade, 260 ms. Drawer: 300 ms slide.
- No bouncing, no spring overshoot, no looping glow.

## Bans

- Purple/pink AI gradients; glass on every card; nested rounded cards; emoji as
  icons; italic serif headings; side-tab borders; centered hero text.
- Removing platform fallbacks or theme variables for the sake of a screenshot.
- Any change that makes a game harder to find, start, or correct.
