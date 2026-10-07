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
  'common',
  'program files',
  'program files (x86)',
  'applications',
  'apps',
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
  return withoutVersion.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
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
