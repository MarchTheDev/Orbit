import { readFileSync } from 'node:fs';
import { launcherOn } from '../src/data/launchers.ts';

let failures = 0;
function check(name, okay) {
  console.log(`  ${okay ? 'ok   ' : 'FAIL '}${name}`);
  if (!okay) failures += 1;
}

console.log('OS-specific Add Game library choices');
check('Windows excludes Linux-only Heroic and Lutris libraries', !launcherOn('Lutris', 'windows') && !launcherOn('Heroic Games Library', 'windows'));
check('Linux excludes Windows-only libraries', !launcherOn('Epic Games', 'linux') && !launcherOn('Xbox', 'linux') && !launcherOn('EA app', 'linux'));
check('Steam remains available on both desktops', launcherOn('Steam', 'windows') && launcherOn('Steam', 'linux'));
const addGame = readFileSync(new URL('../src/components/modals/AddGameModal.tsx', import.meta.url), 'utf8');
const plan = readFileSync(new URL('../src/components/detail/PlanDialog.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
check('the Add Game picker filters its launcher rows by the current desktop OS', addGame.includes('LAUNCHERS.filter((launcher) => launcherOn(launcher.id, desktopOs()))'));
check('drive scanning is a library card in the same picker rather than a separate header button', addGame.includes('Game libraries') && addGame.includes('Drive or folder') && addGame.includes('<HardDrive') && !addGame.includes('Scan a drive or folder</button>'));
check('planning uses one platform-agnostic search with no platform selector', plan.includes('Search all games') && !plan.includes('setPlatform') && !plan.includes('<select'));
check('the planning search also consults HowLongToBeat for console-only titles', plan.includes('fetchHltb(text)') && plan.includes('data.gameName') && plan.includes("platform: 'Other'"));
check('keyless Wikidata matches are ranked into the same results list as Steam games', plan.includes('searchWikidataGames(text)') && plan.includes('wikidataRows') && plan.includes('displayResults.map') && plan.includes('Wikidata ·'));
check('search spinner and keyboard hints reflect both blended result sources', plan.includes('(looking || wikidataLooking)') && plan.includes('!looking && !wikidataLooking && displayResults.length > 0') && plan.includes('adds the selected game to your Backlog'));
check('Wikidata lookup errors do not ask for an API key', plan.includes('wikidataError') && plan.includes('public game catalogue is temporarily unavailable') && !plan.includes('Check the API key'));
const settings = readFileSync(new URL('../src/components/SettingsView.tsx', import.meta.url), 'utf8');
check('game search needs no user-provided TheGamesDB API key', !settings.includes('TheGamesDB') && !settings.includes('thegamesdb-key'));
check('manual planning remains available when a store has no match', plan.includes('without a catalogue match'));
check('adding from a library picker closes the Add Game form only after a selection is saved', app.includes('closeAddTabAfterLibraryImport();') && app.includes('addTabImport.current = true;'));

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
