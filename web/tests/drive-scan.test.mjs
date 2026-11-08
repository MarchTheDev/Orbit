import { readFileSync } from 'node:fs';
import { driveScanDepth } from '../src/utils/driveScan.ts';

const scanner = readFileSync(new URL('../src-tauri/src/launch.rs', import.meta.url), 'utf8');

let failures = 0;
function check(name, okay) {
  console.log(`  ${okay ? 'ok   ' : 'FAIL '}${name}`);
  if (!okay) failures += 1;
}

console.log('drive scan depth');
check('Windows volume roots get a deeper scan', driveScanDepth('C:\\') === 6 && driveScanDepth('d:') === 6);
check('Linux filesystem roots get a deeper scan', driveScanDepth('/') === 6 && driveScanDepth('///') === 6);
check('a selected game folder stays shallow', driveScanDepth('D:\\Games') === 3 && driveScanDepth('/home/player/Games') === 3);
check('Linux scans accept executable-bit binaries and scripts without an extension list', scanner.includes('PermissionsExt') && scanner.includes('permissions().mode() & 0o111'));
check('whole-volume scans skip system directories but not game folders named bin', scanner.includes('is_system_root_child(root, depth, &path)') && scanner.includes('"usr"') && scanner.includes('"windows"'));

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
