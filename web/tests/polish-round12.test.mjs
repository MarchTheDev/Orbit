import { readFileSync } from 'node:fs';
let failures = 0;
const check = (label, ok) => { if (ok) console.log(`  ok   ${label}`); else { failures++; console.log(`  FAIL ${label}`); } };
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const tv = read('../src/components/TvMode.tsx');
const app = read('../src/App.tsx');
const css = read('../src/index.css');
const edit = read('../src/components/detail/GameEditTab.tsx');
const launch = read('../src/components/detail/LaunchEditor.tsx');
const metadata = read('../src-tauri/src/metadata.rs');
const webart = read('../src-tauri/src/webart.rs');
const lib = read('../src-tauri/src/lib.rs');

check('Stardeck removes the selection frame and eases cover movement',
  css.includes(".orbit-deck-card.orbit-pad-focus .orbit-deck-frame") &&
  css.includes('.tv-root .orbit-deck-card:focus-visible .orbit-deck-frame') &&
  css.includes('outline: none; box-shadow: none;') &&
  css.includes('transition: transform .44s cubic-bezier'));
check('The game sheet has no top-corner star, status kicker, or progress percentage',
  !tv.includes('orbit-decksheet-star') && !tv.includes('orbit-decksheet-kicker') &&
  !tv.includes('orbit-decksheet-progress') && !tv.includes('{progress}%'));
check('The Stardeck hamburger opens a left menu with desktop mode and quit actions inside it',
  /\.orbit-deckmenu-wrap[^}]*justify-content: flex-start/.test(css) &&
  tv.includes('className="orbit-deck-hamburger"') &&
  tv.slice(tv.indexOf('function StardeckMenu'), tv.indexOf('function MenuButton')).includes('Desktop mode') &&
  tv.slice(tv.indexOf('function StardeckMenu'), tv.indexOf('function MenuButton')).includes('Quit Orbit') &&
  !tv.includes('aria-label="Return to desktop mode"') && !tv.includes('aria-label="Quit Orbit"') &&
  !tv.includes('Reset Stardeck to its defaults'));
check('Add game, game settings, and Orbit settings are mounted over Stardeck',
  app.includes('onOpenSettings={() => setStardeckSettingsOpen(true)}') &&
  app.includes('onAddGame={() => setShowAdd(true)}') &&
  app.includes('onEditGame={(game) => openGameEditor(game.id)}') &&
  app.includes('{editingGame && (') && app.includes('{showAdd && ('));
check('The game editor uses one column, keeps artwork in one place, and merges Extra into Launch',
  edit.includes("type Page = 'game' | 'launch' | 'tools' | 'wine' | 'saves'") &&
  edit.includes('Create custom…') && edit.includes('<select') && edit.includes('Custom genre') &&
  !edit.includes("page === 'extra'") && !edit.includes("page === 'artwork'") &&
  (edit.match(/<Panel title="Artwork">/g) ?? []).length === 0 &&
  css.includes('.orbit-settings-page { grid-template-columns: minmax(0, 1fr); gap: 14px; }') &&
  launch.includes("section === 'all' || section === 'launch' || section === 'extra'"));
check('Launch options separate named alternatives from companion programs and web pages',
  launch.includes('const addProfile') && launch.includes('const addAlongside') &&
  launch.includes('Web page') && launch.includes('Alternative launch'));
check('Background-following stays image-led across the full viewport, without an opaque bottom fade',
  css.includes('.orbit-adaptive-shade') &&
  /linear-gradient\(180deg, color-mix\(in srgb, var\(--c-bg\) 38%, transparent\)[^;]*transparent\)\)/s.test(css));
check('Artwork existence probes tolerate CDNs that reject HEAD but allow ranged GET',
  metadata.includes('header(reqwest::header::RANGE, "bytes=0-0")') &&
  metadata.includes('exists(client, &url).await.then'));
check('Metadata lookup respects Steam, SteamGridDB and web-artwork source switches',
  lib.includes('fn metadata_source_enabled') &&
    lib.includes('metadata_source_enabled(&settings, "steam")') &&
    lib.includes('metadata_source_enabled(&settings, "steamgriddb")') &&
    lib.includes('metadata_source_enabled(&settings, "web")') &&
    lib.includes('webart::covers(&name, 1)'));
check('Web-image search accepts quoted and unquoted DDG tokens and tests both shapes',
  webart.includes('trim_start_matches') && webart.includes('reads_quoted_and_unquoted_duckduckgo_tokens'));

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
console.log('polish round 12 checks');
