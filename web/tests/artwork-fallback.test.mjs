import { readFileSync } from 'node:fs';

const artwork = readFileSync(new URL('../src/components/ui/ArtworkThumb.tsx', import.meta.url), 'utf8');
const steam = readFileSync(new URL('../src/components/SteamImportModal.tsx', import.meta.url), 'utf8');
let failures = 0;
function check(name, okay) {
  console.log(`  ${okay ? 'ok   ' : 'FAIL '}${name}`);
  if (!okay) failures += 1;
}

console.log('Steam library artwork fallbacks');
check('Steam import rows request a lazy catalogue fallback', steam.includes('<ArtworkThumb title={r.name} appId={r.appId} lookup />'));
check('missing Steam portraits try the wider header image first', artwork.includes('library_600x900.jpg') && artwork.includes('header.jpg'));
check('a demo with no library art falls back to title-based catalogue artwork', artwork.includes('fetchMetadata(title)') && artwork.includes('meta.coverUrl || meta.headerUrl'));
check('fallback state resets when a reused row changes game', artwork.includes('secondSteamArt.current = false') && artwork.includes('setFailed(false)'));

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
