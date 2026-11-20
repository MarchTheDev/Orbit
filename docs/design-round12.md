# Round 12 — Stardeck and the game editor

This is the implementation brief for the Round 12 UI changes. The user asked to keep the six editor pages and chose a written design sheet because there was no Figma file to work in.

## Stardeck

- **Browsing:** the carousel moves as one shelf with a shorter, softer ease (`440ms`, `cubic-bezier(.2,.78,.25,1)`). The focused poster itself does not get a squared outline/frame. Controller and keyboard focus remains in the DOM; other action buttons retain their focus ring.
- **Game sheet:** remove the corner favourite star, the status kicker (`Finished`, `In progress`, etc.), and the main-story percentage bar. Favourite remains an explicit action button; the sheet can still show played time and estimated hours remaining.
- **Escape menu:** left-hand slide-in, sized for controller use. Reset-to-defaults, Back-to-desktop, and Quit Orbit actions are removed from the menu: actions here must not take Stardeck away. Menu buttons use solid/translucent surfaces; accent tint is confined to the icon tile. Existing Add game, Game settings, and Orbit settings actions mount their dialogs over Stardeck instead of leaving the mode.
- **Reduced motion:** existing reduced-motion and low-renderer overrides remain in effect.

## Game editor

- Preserve the existing six-page organization (Game, Launch, Extra, Tools, Wine/Proton, Saves) while moving the page rail to a vertical left navigation on wide windows and a compact horizontal scroller on narrow windows.
- The dialog grows to a maximum width of 64rem; the cover/backdrop header spans the editor, while each page's panels remain responsive.
- Genre is a select with a curated list, a no-genre choice, and a custom-genre entry. Existing custom values are retained as selectable values until changed.
- Alternative launches remain named profiles. Programs, scripts, and web pages can be configured as companions; explanatory paragraphs have been removed from the launch page so labels and controls carry the workflow.
- Artwork controls retain separate portrait and wide slots; a local image can be selected for the wide background as well as a searched result.

## Library backdrop and artwork lookup

- Keep the adaptive backdrop behind the whole viewport in both Observatory and Grid. The shade remains translucent from top to bottom instead of painting the page's base colour over the lower half.
- If a Steam CDN denies `HEAD` but serves the file, retry artwork existence with a one-byte ranged `GET` before treating it as missing.
- DuckDuckGo image token parsing accepts the quoted and unquoted token forms and alphanumeric token characters. A unit test covers both forms.
- Existing source priority is preserved: Steam, SteamGridDB when configured, and web search results are offered as artwork choices rather than silently applied.

## Validation

- TypeScript: `npx tsc --noEmit -p tsconfig.json`
- Tests: `npm test`
- Production bundle: `npx vite build`
- Rust toolchain is not installed in this workspace; backend edits have source-level unit coverage but must be compiled by CI.
