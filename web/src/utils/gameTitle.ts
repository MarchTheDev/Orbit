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

const GENERIC_PROGRAM_NAMES = new Set([
  'game', 'launcher', 'start', 'startgame', 'play', 'client', 'bootstrap',
  'setup', 'install', 'uninstall', 'crashreporter', 'crashhandler',
  'unitycrashhandler', 'redprelauncher', 'easyanticheat', 'unins000',
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
  const separated = candidate
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2');
  const withoutVersion = separated
    .replace(/[\s._-]+v(?:ersion)?[\s_-]*\d+(?:[._-]\d+)*(?:.*)$/i, '')
    .replace(/[\s._-]+\d+(?:[._-]\d+)+(?:.*)$/i, '');
  // Install folders often append release/client labels that are not part of
  // the store title. Keep this list conservative so meaningful subtitles such
  // as "Director's Cut" and "Remastered" remain intact.
  const withoutPackager = withoutVersion.replace(
    /[\s._-]+(?:anker(?:\s*games)?|fitgirl|dodi|repack(?:ed)?|steamrip|elamigos|onlinefix|codex|rune|tenoke|gog|steam|epic|portable|installer|installation|backup|download|win64|win32|x64|x86)$/i,
    '',
  );
  return withoutPackager.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function titleWords(value: string): string[] {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function executableTitle(path: string): string {
  const filename = path.split(/[\\/]+/).filter(Boolean).pop() ?? path;
  const stem = filename.replace(/\.[a-z0-9]{1,8}$/i, '')
    .replace(/(?:[\s._-]+(?:win64|win32|x64|x86|shipping|development|release|debug|client|launcher))+$/i, '');
  return cleanTitle(stem
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2'));
}

/**
 * Folder labels are often more descriptive than executable names, but a folder
 * may have a trailing build/client label that makes catalogue matching fail.
 * If the executable name is a clear prefix of the folder title, prefer that
 * shorter, recognizable title. Generic names like `Game.exe` are ignored.
 */
function preferRecognizableTitle(folder: string, executable: string): string {
  if (!folder) return executable;
  if (!executable) return folder;
  const exeKey = executable.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!exeKey || GENERIC_PROGRAM_NAMES.has(exeKey)) return folder;
  const folderWords = titleWords(folder);
  const comparableFolder = ['the', 'a', 'an'].includes(folderWords[0]) ? folderWords.slice(1) : folderWords;
  const exeWords = titleWords(executable);
  if (exeWords.length < 2 || comparableFolder.length <= exeWords.length) return folder;
  const isPrefix = exeWords.every((word, index) => comparableFolder[index] === word);
  return isPrefix ? executable : folder;
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
  const fallback = cleanTitle(executableTitle(path) || file.replace(/\.[a-z0-9]{1,8}$/i, ''));
  const candidate = folder && !LIBRARY_FOLDERS.has(folder.toLowerCase()) ? cleanTitle(folder) : fallback;
  return preferRecognizableTitle(candidate, fallback) || candidate || fallback;
}

/** Guess from a dropped path that has no executable to inspect. */
export function gameTitleFromPath(path: string): string {
  const name = path.split(/[\\/]+/).filter(Boolean).pop() ?? path;
  return cleanTitle(name.replace(/\.[a-z0-9]{1,8}$/i, ''));
}

/** Guess a scanned candidate's title, using its executable to trim noisy folder tails. */
export function gameTitleFromScannedProgram(executable: string, gameFolder: string): string {
  const folder = gameTitleFromPath(gameFolder);
  return preferRecognizableTitle(folder, executableTitle(executable)) || folder || gameTitleFromExecutable(executable);
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
