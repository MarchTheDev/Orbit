import type { Game, Settings } from '../types';

const d = (daysAgo: number) => new Date(Date.now() - daysAgo * 864e5).toISOString();

/** Used when Orbit is opened in a browser, where there is no real library. */
export const SAMPLE_GAMES: Game[] = [
  {
    id: 'g9', title: 'Silksong', launch: { kind: 'none' },
    exePath: null, installDir: null, drive: '',
    sizeBytes: 0, sizeGb: 0,
    status: 'backlog', favorite: false, manualPlaySecs: 0, playSecs: 0 * 60, lastPlayed: null, addedAt: d(12),
    // Written down before it is owned: it lives on the Backlog page only.
    notes: '', hue: 275, coverPath: null, planned: true, sessionCount: 0, longestSecs: 0, running: false, companions: [],
    meta: { summary: '', genres: [], developer: 'Team Cherry', releaseYear: null, rating: null },
  },
  {
    id: 'g1', title: 'Elden Ring', launch: { kind: 'none' },
    exePath: 'C:\\Games\\ELDEN RING\\eldenring.exe', installDir: 'C:\\Games\\ELDEN RING', drive: 'C:',
    sizeBytes: 49.2e9, sizeGb: 49.2,
    status: 'playing', favorite: true, manualPlaySecs: 0, playSecs: 4380 * 60, lastPlayed: d(1), addedAt: d(120),
    notes: 'Build: Strength/Faith. Next: Mohg.', hue: 40, coverPath: null, sessionCount: 31, longestSecs: 14400, running: false, companions: [],
    meta: { summary: 'An action RPG set in the Lands Between, created by FromSoftware with world-building by George R. R. Martin.', genres: ['RPG', 'Adventure'], developer: 'FromSoftware', releaseYear: 2022, rating: 94 },
    hltb: { main: 59, mainExtra: 101, completionist: 134, source: 'hltb' },
  },
  {
    id: 'g2', title: 'Hollow Knight', launch: { kind: 'none' },
    exePath: 'D:\\Games\\Hollow Knight\\hollow_knight.exe', installDir: 'D:\\Games\\Hollow Knight', drive: 'D:',
    sizeBytes: 9.1e9, sizeGb: 9.1,
    status: 'completed', favorite: true, manualPlaySecs: 0, playSecs: 2460 * 60, lastPlayed: d(40), addedAt: d(300),
    notes: '112% done!', hue: 210, coverPath: null, sessionCount: 18, longestSecs: 9000, running: false, companions: [],
    meta: { summary: 'A challenging 2D action-adventure through a vast ruined kingdom of insects and heroes.', genres: ['Platform', 'Metroidvania'], developer: 'Team Cherry', releaseYear: 2017, rating: 90 },
    hltb: { main: 27, mainExtra: 42, completionist: 63, source: 'hltb' },
  },
  {
    id: 'g3', title: 'Cyberpunk 2077', launch: { kind: 'none' },
    exePath: 'C:\\Games\\Cyberpunk 2077\\bin\\x64\\Cyberpunk2077.exe', installDir: 'C:\\Games\\Cyberpunk 2077', drive: 'C:',
    sizeBytes: 70.4e9, sizeGb: 70.4,
    status: 'backlog', favorite: false, manualPlaySecs: 0, playSecs: 320 * 60, lastPlayed: d(70), addedAt: d(80),
    notes: '', hue: 320, coverPath: null, sessionCount: 4, longestSecs: 7200, running: false, companions: [],
    meta: { summary: 'An open-world action-adventure set in Night City, a megalopolis obsessed with power and body modification.', genres: ['RPG', 'Shooter'], developer: 'CD PROJEKT RED', releaseYear: 2020, rating: 86 },
    hltb: { main: 26, mainExtra: 64, completionist: 106, source: 'hltb' },
  },
  {
    id: 'g4', title: 'Hades', launch: { kind: 'none' },
    exePath: 'D:\\Games\\Hades\\x64\\Hades.exe', installDir: 'D:\\Games\\Hades', drive: 'D:',
    sizeBytes: 15e9, sizeGb: 15,
    status: 'playing', favorite: false, manualPlaySecs: 0, playSecs: 1210 * 60, lastPlayed: d(3), addedAt: d(60),
    notes: 'Try the spear aspect.', hue: 0, coverPath: null, sessionCount: 12, longestSecs: 5400, running: false, companions: [],
    meta: { summary: 'A god-like rogue-like dungeon crawler where you defy the god of the dead.', genres: ['Roguelike', 'Action'], developer: 'Supergiant Games', releaseYear: 2020, rating: 93 },
    hltb: { main: 23, mainExtra: 48, completionist: 95, source: 'hltb' },
  },
  {
    id: 'g5', title: 'Stardew Valley', launch: { kind: 'none' },
    exePath: 'C:\\Games\\Stardew Valley\\Stardew Valley.exe', installDir: 'C:\\Games\\Stardew Valley', drive: 'C:',
    sizeBytes: 0.6e9, sizeGb: 0.6,
    status: 'dropped', favorite: false, manualPlaySecs: 0, playSecs: 900 * 60, lastPlayed: d(200), addedAt: d(400),
    notes: '', hue: 110, coverPath: null, sessionCount: 9, longestSecs: 6000, running: false, companions: [],
    meta: { summary: 'Inherit your grandfather’s old farm plot and build a new life in Stardew Valley.', genres: ['Simulator', 'RPG'], developer: 'ConcernedApe', releaseYear: 2016, rating: 89 },
    hltb: { main: 53, mainExtra: 95, completionist: 167, source: 'hltb' },
  },
];

/** What Orbit assumes before anything has been saved. */
export const DEFAULT_SETTINGS: Settings = {
  theme: 'nebula',
  fontFamily: 'system',
  libraryFilterOrder: ['all', 'playing', 'completed', 'dropped', 'favorites', 'unplayed', 'hidden'],
  hiddenLibraryFilters: [],
  libraryFolders: [],
  steamOnLaunch: false,
  launcherScanOnLaunch: [],
  launchOnStartup: false,
  launchOnStartupBackground: false,
  openExeInOrbit: true,
  sortOrder: [],
  coverScale: 100,
  coverTint: true,
  tabOrder: [],
  logOrder: [],
  backlogOrder: [],
  window: {
    // Nothing happens to the window unless the player asks for it, which is the
    // only safe default: minimising or closing somebody's window on their behalf
    // is not something to do uninvited.
    onLaunch: 'nothing',
    onClose: 'nothing',
  },
  fetchMetadata: true,
  autoFetchMetadata: true,
};