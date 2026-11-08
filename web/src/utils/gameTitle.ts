/** Common folders that hold executables rather than identifying the game. */
const BINARY_FOLDERS = new Set([
  'bin',
  'binaries',
  'win32',
  'win64',
  'x64',
  'x86',
  'x86_64',
  'shipping',
  'release',
  'debug',
  'development',
]);

const LIBRARY_FOLDERS = new Set([
  'games',
  'steamapps',
  'steamlibrary',
  'common',
  'gog games',
  'epic games',
  'xboxgames',
  'program files',
  'program files (x86)',
  'applications',
  'apps',
  'library',
]);

function partsForExecutable(path: string): { parts: string[]; directories: string[] } {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  const directories = parts.slice(0, -1);
  while (directories.length > 0 && BINARY_FOLDERS.has(directories[directories.length - 1].toLowerCase())) {
    directories.pop();
  }
  return { parts, directories };
}

function cleanTitle(candidate: string): string {
  const withoutVersion = candidate
    .replace(/[\s._-]+v(?:ersion)?[\s_-]*\d+(?:[._-]\d+)*(?:.*)$/i, '')
    .replace(/[\s._-]+\d+(?:[._-]\d+)+(?:.*)$/i, '');
  // Install folders often append a repack/release label that is not part of
  // the store title (for example `Red-Dead-Redemption-2-Anker`). Strip only
  // known trailing distribution tags; do not discard arbitrary last words.
  const withoutPackager = withoutVersion.replace(
    /[\s._-]+(?:anker|fitgirl|dodi|repack(?:ed)?|steamrip|elamigos|onlinefix|codex|rune|tenoke)$/i,
    '',
  );
  return withoutPackager.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Guess a game's display name from an executable path.
 *
 * The parent folder is usually a better clue than `SomeLauncher.exe`, so walk
 * up past common binary/build directories before falling back to the filename.
 */
export function gameTitleFromExecutable(path: string): string {
  const { parts, directories } = partsForExecutable(path);
  const file = parts[parts.length - 1] ?? path;
  const folder = directories[directories.length - 1];
  const fallback = file.replace(/\.[a-z0-9]{1,8}$/i, '');
  const candidate = folder && !LIBRARY_FOLDERS.has(folder.toLowerCase()) ? folder : fallback;
  return cleanTitle(candidate) || cleanTitle(fallback);
}

/** Guess from a dropped path that has no executable to inspect. */
export function gameTitleFromPath(path: string): string {
  const name = path.split(/[\\/]+/).filter(Boolean).pop() ?? path;
  return cleanTitle(name.replace(/\.[a-z0-9]{1,8}$/i, ''));
}

/**
 * Group a scanned executable under its likely install folder. This works for
 * both a selected game/library folder and a whole-drive scan, including the
 * usual Steam/Epic/GOG container layouts.
 */
export function gameFolderFromScan(executable: string, scanRoot: string): string {
  const separator = scanRoot.includes('\\') || executable.includes('\\') ? '\\' : '/';
  const trimmedRoot = scanRoot.replace(/[\\/]+$/, '') || (scanRoot.startsWith('/') ? '/' : '');
  const root = trimmedRoot || scanRoot;
  const rootLower = root.toLowerCase().replace(/[\\/]+$/, '');
  const relative = executable.toLowerCase().startsWith(rootLower)
    ? executable.slice(root.length).replace(/^[\\/]+/, '')
    : executable.split(/[\\/]+/).slice(-2).join(separator);
  const directories = relative.split(/[\\/]+/).filter(Boolean).slice(0, -1);
  if (directories.length === 0) return root;

  const first = directories[0].toLowerCase();
  if (BINARY_FOLDERS.has(first)) return root;

  const scanContainers = new Set([
    'games', 'steamapps', 'steamlibrary', 'common', 'gog games',
    'epic games', 'xboxgames', 'applications', 'apps', 'library',
  ]);
  const marker = directories.findIndex((part) => scanContainers.has(part.toLowerCase()));
  let gameIndex = marker;
  if (marker >= 0) {
    gameIndex = marker + 1;
    while (gameIndex < directories.length && scanContainers.has(directories[gameIndex].toLowerCase())) gameIndex += 1;
    if (gameIndex >= directories.length) gameIndex = marker;
  } else if (first === 'program files' || first === 'program files (x86)') {
    gameIndex = directories.length > 1 ? 1 : 0;
  } else {
    gameIndex = 0;
  }

  return `${root.replace(/[\\/]+$/, '')}${separator}${directories.slice(0, gameIndex + 1).join(separator)}`;
}

/** The install root containing the program, or an empty string if unknown. */
export function gameFolderFromExecutable(path: string): string {
  const { directories } = partsForExecutable(path);
  if (directories.length === 0) return '';
  const last = directories[directories.length - 1].toLowerCase();
  if (LIBRARY_FOLDERS.has(last)) return '';

  const separator = path.includes('\\') ? '\\' : '/';
  const prefix = path.startsWith('\\\\') ? '\\\\' : path.startsWith('/') ? '/' : '';
  return `${prefix}${directories.join(separator)}`;
}
