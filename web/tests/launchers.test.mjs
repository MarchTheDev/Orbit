/** Every launcher in the list carries its real brand mark, and only scannable ones offer a scan. */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { siHeroicgameslauncher } from 'simple-icons';
import { LAUNCHERS, canScan, pathPromptFor } from '../src/data/launchers.ts';
import { LauncherIcon } from '../src/components/ui/LauncherIcon.tsx';

let failures = 0;

function check(name, ok, detail = '') {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
  }
}

/** The `d` attribute of the single path a launcher's icon draws. */
function pathOf(launcher) {
  const html = renderToStaticMarkup(createElement(LauncherIcon, { launcher }));
  const match = html.match(/d="([^"]*)"/);
  return match ? match[1] : '';
}

const ids = LAUNCHERS.map((launcher) => launcher.id);

console.log('the launcher list');
check(
  'carries Heroic Games Library',
  ids.includes('Heroic Games Library'),
  ids.join(', '),
);
check('carries Amazon Luna', ids.includes('Amazon Luna'), ids.join(', '));
check(
  'still carries every launcher it had before',
  ['Steam', 'Epic Games', 'Ubisoft Connect', 'GOG Galaxy', 'EA app', 'Xbox'].every((id) =>
    ids.includes(id),
  ),
  ids.join(', '),
);
check('gives each one a colour', LAUNCHERS.every((launcher) => /^#[0-9a-f]{6}$/i.test(launcher.color)));

console.log('their icons');
const drawn = new Map();
for (const launcher of LAUNCHERS) {
  const path = pathOf(launcher.id);
  drawn.set(launcher.id, path);
  check(`${launcher.id} draws something`, path.length > 100, `path length ${path.length}`);
}
check(
  'Heroic uses the official mark from simple-icons rather than a stand-in',
  drawn.get('Heroic Games Library') === siHeroicgameslauncher.path,
);
check(
  'no two launchers share a mark',
  new Set(drawn.values()).size === drawn.size,
  [...drawn.entries()].map(([id, path]) => `${id}:${path.slice(0, 8)}`).join(' '),
);

console.log('what can actually be scanned');
check(
  'Amazon Luna is scannable, because the Amazon Games client does install locally',
  canScan(LAUNCHERS.find((launcher) => launcher.id === 'Amazon Luna')),
);
check(
  'Heroic is scannable, so it needs no note',
  canScan(LAUNCHERS.find((launcher) => launcher.id === 'Heroic Games Library')),
);
check(
  'every launcher on the list is scannable',
  LAUNCHERS.every((launcher) => canScan(launcher)),
  LAUNCHERS.filter((launcher) => !canScan(launcher))
    .map((launcher) => launcher.id)
    .join(', '),
);
check(
  'a launcher that says it cannot be scanned still is not offered as one',
  !canScan({ scannable: false }) && canScan({}) && canScan({ scannable: true }),
);

console.log('which launchers can be pointed at a folder');
check(
  'Heroic asks where its config folder is',
  pathPromptFor('Heroic Games Library')?.includes('Heroic') === true,
  String(pathPromptFor('Heroic Games Library')),
);
check(
  'Amazon Luna asks where Nile keeps its files, because that is what is read',
  pathPromptFor('Amazon Luna')?.includes('Nile') === true,
  String(pathPromptFor('Amazon Luna')),
);
check(
  'Xbox asks where the XboxGames folder is',
  pathPromptFor('Xbox')?.includes('XboxGames') === true,
  String(pathPromptFor('Xbox')),
);
check(
  'Epic does not offer one: its manifests sit in ProgramData, which Windows fixes',
  pathPromptFor('Epic Games') === undefined,
);
check(
  'the registry launchers do not offer one, because there is no folder to name',
  ['Ubisoft Connect', 'GOG Galaxy', 'EA app'].every((id) => pathPromptFor(id) === undefined),
);
check(
  'every prompt offered is a question',
  LAUNCHERS.filter((launcher) => launcher.pathPrompt).every((launcher) =>
    launcher.pathPrompt.trim().endsWith('?'),
  ),
);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
