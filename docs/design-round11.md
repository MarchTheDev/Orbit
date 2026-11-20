# Round eleven — the spec sheet

The design work of round eleven, written down as something a designer can open
beside the app rather than as a picture of it alone. Every block below exists in
the code already; this file is the reasoning and the exact numbers, so the same
decisions can be re-drawn in Figma — or argued with — without reading CSS.

The five surfaces are: **the Stardeck sheet**, **the game hero plate**, **the
page head without a plate**, **an icon in tint**, and **a Settings result that
lands on its own row**.

---

## 1 · Where a plate belongs

A plate is a backing for type that has a picture behind it. It is not a card, and
it is not a way to make a heading look important.

| Case | Plate? | Why |
| --- | --- | --- |
| Page title (`Library`, `Settings`) | **no** | Large type, nothing behind it but the app's own room. |
| A section's lead sentence | **no** | Sits on the page, inside a panel or under a hairline. |
| The game page's title, year, studio, buttons | **yes** | Over the game's own artwork, dimmed but not flattened. |
| Stardeck's sheet, Library header, empty state | **yes** | Over another game's blurred cover. |
| Settings section heading | **yes** | The room can be lit by a game; the heading is the one thing that must not be lost. |

The two plate recipes:

```
on the app's room      background: color-mix(in srgb, #06050e 52%, transparent)
                       backdrop-filter: blur(16px) saturate(1.15)
                       box-shadow: inset 0 1px 0 #ffffff12
                       radius 18px, padding 14px 18px 16px

on Stardeck's room     background: #06050eb8
                       backdrop-filter: blur(14px) saturate(1.2)
                       radius 16px, padding 10px 16px
```

Linux drops the blur and raises the alpha (`.orbit-linux`), because a
`backdrop-filter` there costs a compositing pass per frame.

---

## 2 · Stardeck

The screen is one row of covers over the selected game's own cover, blurred
almost out of recognition. No bar, two floating pills, a sheet down the left.

- **Room.** `filter: blur(62px) saturate(1.34) brightness(1.18)` over the cover,
  a 15 % multiply dim, and a vignette that clears the middle:
  `radial-gradient(120% 90% at 50% 34%, transparent 40%, #05040d86)`.
  Round ten dimmed this to 1.02 brightness and 34 % multiply; the room read as
  unlit. The covers are the brightest thing on screen again.
- **No reflection.** The mirrored cover under each cover is gone. It moved with
  the selection overlay, so the arrow keys dragged a broken second cover around.
- **Sheet.** `width: min(31rem, 38vw)`, radius 26px, `padding: 24px`,
  `gap: 18px`, cover `clamp(11rem, 32dvh, 19rem)`, title
  `clamp(1.7rem, 3.4dvh + .5vw, 2.6rem)`, facts 14 px, figures 17 px,
  Play `height: 54px / font 16px`, icon buttons 54 × 54. No description block:
  the sheet answers *what is this, and do I want it*, and a paragraph is neither.

---

## 3 · An icon is a tint

Nothing in the interface is a filled or gradient icon any more. The recipe:

```
background:    color-mix(in srgb, var(--c-accent) 9%,  transparent)
border-color:  color-mix(in srgb, var(--c-accent) 20%, transparent)
color:         color-mix(in srgb, var(--c-accent) 70%, var(--c-muted))
```

Full accent is reserved for a primary action (Play) and an on-state
(`aria-pressed`, the favourite star). Round ten shipped the launcher and release
marks at 14 % with a 40 % border and a 70/30 colour — close enough to a fill to
read as one.

---

## 4 · The game editor is tighter

It was `max-w-6xl` because the modal was, not because the page had six columns
of content. Now:

- dialog **54rem** wide (`panelClassName="orbit-modaledit"` on a bare `Modal`);
- artwork header `clamp(8rem, 18vh, 10.5rem)`, cover column 7rem;
- page body `grid-template-columns: repeat(auto-fit, minmax(22rem, 1fr))`, so a
  short page fills its width in two columns instead of stacking down one.

---

## 5 · A Settings search is a destination

```
type "volume"          → rail: Sound → "Volume"
press that result      → card switches, page scrolls to #set-volume,
                          the row flashes an accent ring for 2.4 s
```

- Every findable control carries an id derived from its own label
  (`anchorFor('Volume')` → `set-volume`), and every index entry is held to it by
  a check, so an entry cannot outlive the control it names.
- `scrollSettingsSectionToTop(target, 'smooth', { always: true })` for a row, so
  the one-row case is not swallowed by the "already at the top" shortcut.
- Three entries that described the Library's own view menu — cover size, order,
  hover tint — were removed. A search result that points at a page with no such
  control is worse than no result.

---

## Drawing it in Figma

The connection here can read a file, comment on it, and export frames, but it
cannot create a file or a frame. So this sheet is the handover: give the agent a
Figma file URL and it can post these five blocks as pinned comments against an
existing file, or export the frames it already holds for comparison.

Frames worth drawing, in this order:

1. **Stardeck, 1920 × 1080** — seven covers, centre one at 1.0, neighbours at
   .8, room at 62 px blur, sheet at 31rem on the left.
2. **Stardeck sheet, 496 × 640** — cover, kicker, title, facts, four figures,
   Play + star + settings + details.
3. **Game page hero, 1440 × 420** — 210 px cover, plate at 52 % over the art.
4. **Page head, 1440 × 120** — title and two readings, no box of any kind.
5. **Icon set, 48 × 48 each** — 9 % tint, 20 % border, one accent mark.
